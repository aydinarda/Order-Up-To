/**
 * k6 Stress Test (limit finder) — SimpleNewsVendorGame
 *
 * Goal: push the REAL game until the server degrades or fails, without changing
 * the app's polling model. Same realistic backbone as game_full_session.js
 * (admin drives rounds, players poll + submit), but cranked up and ramped:
 *
 *   - players   : 300 players ramp in and play the real poll/submit loop.
 *   - churn     : new players join (and immediately abandon) at an increasing
 *                 rate. The in-memory players Map grows unbounded, and every
 *                 pending-phase join recomputes the O(N) leaderboard -> CPU + RAM.
 *   - abusers   : weird heavy traffic at an increasing rate — no-sleep game-state
 *                 hammering, repeated O(N) /leaderboard reads, huge order spam.
 *   - admin     : drives rounds and measures how long /end-round takes as load
 *                 climbs (the clearest "server is choking" signal).
 *
 * Thresholds are intentionally tight: they WILL cross as the server degrades —
 * that is the point. The workflow is informational and reports where it broke.
 *
 * Run: k6 run --env BASE_URL=... --env ADMIN_KEY=... k6/game_stress_test.js
 *   Quick local sanity: --env PLAYERS=40 --env ROUNDS=5 --env PLAY_WINDOW=3 --env SEG=8s
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";

const BASE = (__ENV.BASE_URL || "https://simplenewsvendorgame.onrender.com").replace(/\/$/, "");
const ADMIN_KEY = __ENV.ADMIN_KEY || "admin123";
const HDR = { headers: { "Content-Type": "application/json" } };

const N_PLAYERS = Number(__ENV.PLAYERS || 300);
const N_ROUNDS = Number(__ENV.ROUNDS || 20);
const PLAY_WINDOW = Number(__ENV.PLAY_WINDOW || 8); // seconds players get to submit per round
const SEG = __ENV.SEG || "60s"; // duration of one ramp segment

// 400/404/409/429 are expected under abuse; keep them out of http_req_failed (real failures = 5xx/timeout).
http.setResponseCallback(http.expectedStatuses(200, 400, 404, 409, 429));

// ── Custom metrics ──────────────────────────────────────────────────────────
const pollLatency = new Trend("poll_latency", true);
const submitLatency = new Trend("submit_latency", true);
const joinLatency = new Trend("join_latency", true);
const endRoundLatency = new Trend("end_round_latency", true); // admin-measured: key degradation signal
const gameErrors = new Counter("game_errors"); // 5xx / timeouts
const churnJoins = new Counter("churn_joins");
const submitRateLimited = new Counter("submit_rate_limited");

const DISTRIBUTIONS = [
  { type: "uniform", min: 80, max: 120 },
  { type: "normal", mean: 100, stdDev: 20 },
  { type: "uniform", min: 50, max: 150 },
  { type: "normal", mean: 120, stdDev: 10 },
  { type: "uniform", min: 0, max: 200 },
  { type: "normal", mean: 100, stdDev: 0 }
];

export const options = {
  scenarios: {
    // Admin drives the game the whole time.
    admin: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      maxDuration: "12m",
      startTime: "3s",
      exec: "driveGame",
      tags: { role: "admin" }
    },
    // 300 players ramp in and play the real loop.
    players: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: SEG, target: Math.round(N_PLAYERS / 3) },
        { duration: SEG, target: N_PLAYERS },
        { duration: SEG, target: N_PLAYERS },
        { duration: "20s", target: 0 }
      ],
      exec: "playerLoop",
      tags: { role: "player" }
    },
    // Churn: new players join + abandon at an increasing rate (grows the Map, O(N) leaderboard).
    churn: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 200,
      startTime: "15s",
      stages: [
        { duration: SEG, target: 5 },
        { duration: SEG, target: 30 },
        { duration: SEG, target: 0 }
      ],
      exec: "churnJoin",
      tags: { role: "churn" }
    },
    // Abusers: weird heavy traffic at an increasing rate.
    abusers: {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 400,
      startTime: "25s",
      stages: [
        { duration: SEG, target: 30 },
        { duration: SEG, target: 150 },
        { duration: SEG, target: 0 }
      ],
      exec: "abuser",
      tags: { role: "abuser" }
    }
  },
  thresholds: {
    // Intentionally tight — these cross as the server degrades (that's the signal).
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.05"],
    game_errors: ["count<100"],
    poll_latency: ["p(95)<3000"],
    end_round_latency: ["p(95)<5000"]
  }
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function post(path, body) {
  return http.post(`${BASE}${path}`, JSON.stringify(body), HDR);
}
function j(res) {
  try {
    return JSON.parse(res.body) || {};
  } catch {
    return {};
  }
}
function chooseOrder(distribution) {
  const d = distribution || {};
  let center = 100;
  if (d.type === "normal" && typeof d.mean === "number") center = d.mean;
  else if (typeof d.min === "number" && typeof d.max === "number") center = (d.min + d.max) / 2;
  return Math.max(1, Math.round(center + (Math.random() * 0.8 - 0.4) * center));
}

// ── Setup: create the game + N_PLAYERS base players ─────────────────────────
export function setup() {
  let alive = false;
  for (let i = 0; i < 8; i++) {
    if (http.get(`${BASE}/health`, HDR).status === 200) {
      alive = true;
      break;
    }
    sleep(5);
  }
  if (!alive) throw new Error("setup: backend /health did not respond");

  const admin = j(post("/start-game", { nickname: "admin_stress", adminKey: ADMIN_KEY, handsPerTur: N_ROUNDS }));
  if (!admin.gameId || !admin.adminToken) throw new Error("setup: could not create game");

  const players = [];
  for (let i = 0; i < N_PLAYERS; i++) {
    const d = j(post("/start-game", { nickname: `S${String(i + 1).padStart(4, "0")}`, gameId: admin.gameId }));
    if (d.playerId) players.push({ playerId: d.playerId });
    if ((i + 1) % 50 === 0) console.log(`setup: ${players.length}/${i + 1} players joined so far`);
  }
  // Tolerant: a stress test should still run even if some setup joins fail.
  if (players.length < N_PLAYERS / 2) {
    throw new Error(`setup: only ${players.length}/${N_PLAYERS} players joined`);
  }

  console.log(`setup: game ${admin.gameId.slice(0, 8)} ready, ${players.length} players, ${N_ROUNDS} rounds`);
  return { gameId: admin.gameId, adminToken: admin.adminToken, players };
}

// ── Admin: drive rounds, measure /end-round latency as load climbs ──────────
export function driveGame(data) {
  const { gameId, adminToken } = data;

  for (let r = 0; r < N_ROUNDS; r++) {
    post("/set-distribution", { gameId, adminToken, ...DISTRIBUTIONS[r % DISTRIBUTIONS.length] });
    const sr = post("/start-round", { gameId, adminToken });
    if (j(sr).roundPhase !== "active") gameErrors.add(1);

    sleep(PLAY_WINDOW);

    const t0 = Date.now();
    const er = post("/end-round", { gameId, adminToken });
    const ms = Date.now() - t0;
    endRoundLatency.add(ms);
    if (er.status >= 500) gameErrors.add(1);

    const d = j(er);
    console.log(`Round ${r + 1}/${N_ROUNDS} | demand=${d.realizedDemand} | end-round=${ms}ms | http=${er.status}`);
    if (d.finished) break;
  }
}

// ── Player: the real poll + submit loop ─────────────────────────────────────
export function playerLoop(data) {
  const player = data.players[(__VU - 1) % data.players.length];
  const stateUrl = `${BASE}/game-state?gameId=${data.gameId}&playerId=${player.playerId}`;

  const t0 = Date.now();
  const res = http.get(stateUrl, HDR);
  pollLatency.add(Date.now() - t0);
  if (res.status >= 500 || res.status === 0) gameErrors.add(1);

  const gs = j(res);
  check(gs, { "poll ok": (x) => typeof x.roundPhase === "string" || x.finished === true });

  if (gs.finished) {
    sleep(3);
    return;
  }

  if (gs.roundPhase === "active" && gs.player && !gs.player.submittedThisRound) {
    const s0 = Date.now();
    const r = post("/submit-order", { gameId: data.gameId, playerId: player.playerId, orderQuantity: chooseOrder(gs.distribution) });
    submitLatency.add(Date.now() - s0);
    if (r.status === 429) submitRateLimited.add(1);
    else if (r.status >= 500) gameErrors.add(1);
  }

  sleep(0.4 + Math.random() * 1.6);
}

// ── Churn: a transient player joins, peeks once, then abandons ──────────────
export function churnJoin(data) {
  const name = `churn_${Date.now()}_${__VU}_${Math.floor(Math.random() * 1e6)}`;
  const t0 = Date.now();
  const r = post("/start-game", { nickname: name, gameId: data.gameId });
  joinLatency.add(Date.now() - t0);

  if (r.status === 200) churnJoins.add(1);
  else if (r.status >= 500) gameErrors.add(1);

  const d = j(r);
  if (d.playerId) {
    const peek = http.get(`${BASE}/game-state?gameId=${data.gameId}&playerId=${d.playerId}`, HDR);
    if (peek.status >= 500) gameErrors.add(1);
  }
  // No further activity -> the player is abandoned (still occupies the Map).
}

// ── Abuser: weird heavy traffic; arrival-rate executor controls the pace ────
export function abuser(data) {
  const roll = Math.random();
  let res;

  if (roll < 0.4) {
    // Hammer the heaviest read (game-state) for a random player.
    const p = data.players[Math.floor(Math.random() * data.players.length)];
    res = http.get(`${BASE}/game-state?gameId=${data.gameId}&playerId=${p.playerId}`, HDR);
  } else if (roll < 0.7) {
    // Hammer the O(N) leaderboard (grows with churn).
    res = http.get(`${BASE}/leaderboard?gameId=${data.gameId}`, HDR);
  } else if (roll < 0.9) {
    // Huge / odd order spam (validated + rate-limited, but still load).
    const p = data.players[Math.floor(Math.random() * data.players.length)];
    res = post("/submit-order", { gameId: data.gameId, playerId: p.playerId, orderQuantity: Math.floor(Math.random() * 1e9) + 1 });
    if (j(res).error === undefined && res.status === 429) submitRateLimited.add(1);
  } else {
    res = http.get(`${BASE}/health`, HDR);
  }

  if (res && (res.status >= 500 || res.status === 0)) gameErrors.add(1);
}

// ── Teardown: close any open round (safety) ─────────────────────────────────
export function teardown(data) {
  post("/end-round", { gameId: data.gameId, adminToken: data.adminToken });
}
