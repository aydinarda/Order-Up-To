/**
 * k6 Full Session Load Test — SimpleNewsVendorGame
 *
 * Realistic, classroom-paced scenario with a mid-game restart:
 *   - 1 admin + 100 players in a single game, a full 30-round game played end to end.
 *   - The admin (1 VU) drives the rounds sequentially: each round sets a DIFFERENT
 *     distribution, starts the round, gives players a ~1 minute window to decide and
 *     submit, then ends it. A short review gap follows before the next round.
 *   - RESTART: after round RESTART_AT_ROUND (default 2) the admin calls /restart-game,
 *     which mints a BRAND-NEW gameId (same adminToken + same player roster) and resets
 *     everyone to round 1. The admin then replays the WHOLE 30-round game on the new id.
 *     Players have no WebSocket here, so when their cached gameId goes stale they get a
 *     400 and rediscover the active game via /health (activeGameId) — exactly the swap
 *     the real WebSocket-push client does on a `game_restarted` event.
 *   - EXTENSION: if a game's configured hands run out before 30 rounds, the admin calls
 *     /one-more-hand to reopen it and keeps going (a safe fallback regardless of the cap).
 *   - The players (100 VUs) behave like real users: they refresh /game-state at a
 *     RELAXED cadence (the real client is WebSocket-push driven, not a 1s poller),
 *     submit one order while a round is active, and occasionally browse the leaderboard.
 *     ~25% are "active" users who keep hitting endpoints throughout the waits.
 *
 * The long windows let you JOIN the same game in a browser and watch for latency while
 * the load runs. Point both at the same backend:
 *   k6:      k6 run --env BASE_URL=http://localhost:4000 --env ADMIN_KEY=admin123 k6/game_full_session.js
 *   browser: http://localhost:5173  (joins the active game the load test created)
 *
 * Tune the pacing:  --env ROUND_WINDOW=60  --env REVIEW_GAP=8  --env RESTART_AT_ROUND=2
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";

const BASE = (__ENV.BASE_URL || "https://simplenewsvendorgame.onrender.com").replace(/\/$/, "");
const ADMIN_KEY = __ENV.ADMIN_KEY || "admin123";
const HDR = { headers: { "Content-Type": "application/json" } };

const N_PLAYERS = 100;
const N_ROUNDS = 30; // full game length (replayed after the mid-game restart)
const RESTART_AT_ROUND = Number(__ENV.RESTART_AT_ROUND || 2); // restart fires after this round, then the full game replays
const ROUND_WINDOW = Number(__ENV.ROUND_WINDOW || 25); // seconds a round stays active (~1 min to decide + submit)
const REVIEW_GAP = Number(__ENV.REVIEW_GAP || 3); // seconds between rounds (players review results/leaderboard)
// Total rounds driven = a few warm-up rounds before the restart + the full replayed game.
const TOTAL_ROUNDS = RESTART_AT_ROUND + N_ROUNDS;
const SESSION_SECONDS = TOTAL_ROUNDS * (ROUND_WINDOW + REVIEW_GAP) + 90; // whole game + restart + buffer
const DURATION = __ENV.DURATION || `${SESSION_SECONDS}s`; // players scenario; must cover the whole game

// 400/409/429 are expected responses (re-submit, rate-limit); keep them out of http_req_failed.
http.setResponseCallback(http.expectedStatuses(200, 400, 409, 429));

// ── Custom metrics ──────────────────────────────────────────────────────────
const pollLatency = new Trend("poll_latency", true);
const submitLatency = new Trend("submit_latency", true);
const gameErrors = new Counter("game_errors"); // 5xx only
const submitAccepted = new Counter("submit_accepted");
const submitDuplicateRejected = new Counter("submit_duplicate_rejected");
const submitRateLimited = new Counter("submit_rate_limited");
const roundsDriven = new Counter("rounds_driven");
const restartsDriven = new Counter("restarts_driven"); // restarts the admin performed
const restartsFollowed = new Counter("restarts_followed"); // players that rediscovered the new game id

// Varied distributions; the 30 rounds cycle through these 12 (to observe their behavior).
const DISTRIBUTIONS = [
  { type: "uniform", min: 80, max: 120 },
  { type: "uniform", min: 50, max: 150 },
  { type: "normal", mean: 100, stdDev: 10 },
  { type: "normal", mean: 100, stdDev: 30 },
  { type: "uniform", min: 90, max: 110 },
  { type: "normal", mean: 120, stdDev: 5 },
  { type: "uniform", min: 0, max: 200 },
  { type: "normal", mean: 80, stdDev: 20 },
  { type: "normal", mean: 100, stdDev: 0 }, // deterministic
  { type: "uniform", min: 100, max: 140 },
  { type: "normal", mean: 150, stdDev: 25 },
  { type: "uniform", min: 70, max: 130 }
];

export const options = {
  scenarios: {
    // The admin drives the game (starts/ends rounds, changes distributions, restarts).
    admin: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      maxDuration: `${SESSION_SECONDS + 60}s`,
      startTime: "2s", // small head start so players are already polling
      exec: "driveGame",
      tags: { role: "admin" }
    },
    // 100 players refresh + submit at a realistic, relaxed cadence.
    players: {
      executor: "constant-vus",
      vus: N_PLAYERS,
      duration: DURATION, // covers the whole game; players idle cheaply once it finishes
      exec: "playerLoop",
      tags: { role: "player" }
    }
  },
  thresholds: {
    submit_latency: ["p(95)<8000"],
    poll_latency: ["p(95)<5000"],
    game_errors: ["count<50"], // 5xx only
    http_req_failed: ["rate<0.05"]
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
function describe(d) {
  return d.type === "normal" ? `normal(μ=${d.mean},σ=${d.stdDev})` : `uniform[${d.min},${d.max}]`;
}

// Crude newsvendor: order around the distribution center with +/-40% noise.
function chooseOrder(distribution) {
  const d = distribution || {};
  let center = 100;
  if (d.type === "normal" && typeof d.mean === "number") center = d.mean;
  else if (typeof d.min === "number" && typeof d.max === "number") center = (d.min + d.max) / 2;
  const noise = (Math.random() * 0.8 - 0.4) * center;
  return Math.max(1, Math.round(center + noise));
}

// Drive a single round end to end. `state` carries the live gameId/adminToken (which the
// restart swaps) plus a running count so we can extend past the game's configured hands.
function driveOneRound(state, roundNo, total, dist) {
  // Once a game instance has used up its configured hands, /one-more-hand reopens it so we
  // can keep driving rounds toward the full 30.
  if (state.roundsThisGame >= state.configuredHands) {
    const omh = post("/one-more-hand", { gameId: state.gameId, adminToken: state.adminToken });
    check(omh, { "one-more-hand 200": (x) => x.status === 200 });
  }

  const sd = post("/set-distribution", { gameId: state.gameId, adminToken: state.adminToken, ...dist });
  check(sd, { "set-distribution 200": (x) => x.status === 200 });

  // Occasionally change prices too (variety).
  if (roundNo % 4 === 1) {
    post("/set-prices", {
      gameId: state.gameId,
      adminToken: state.adminToken,
      wholesaleCost: 10,
      retailPrice: 35 + (roundNo % 3) * 5,
      salvagePrice: 5
    });
  }

  const sr = post("/start-round", { gameId: state.gameId, adminToken: state.adminToken });
  if (j(sr).roundPhase !== "active") gameErrors.add(1);

  // ~1 minute window: players think, submit, and browse while traffic keeps flowing.
  sleep(ROUND_WINDOW);

  const er = j(post("/end-round", { gameId: state.gameId, adminToken: state.adminToken }));
  state.roundsThisGame += 1;
  roundsDriven.add(1);
  console.log(`Round ${roundNo}/${total} | ${describe(dist)} | demand=${er.realizedDemand} | finished=${er.finished}`);
}

// ── Setup: create the game + 100 players ────────────────────────────────────
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

  const admin = j(post("/start-game", { nickname: "admin_load", adminKey: ADMIN_KEY, handsPerTur: N_ROUNDS }));
  if (!admin.gameId || !admin.adminToken) throw new Error("setup: could not create game");
  // The server may clamp handsPerTur; totalRounds echoes the value it actually used.
  const configuredHands = admin.totalRounds || N_ROUNDS;

  const players = [];
  for (let i = 0; i < N_PLAYERS; i++) {
    const d = j(post("/start-game", { nickname: `L${String(i + 1).padStart(3, "0")}`, gameId: admin.gameId }));
    if (d.playerId) players.push({ playerId: d.playerId });
  }
  if (players.length < N_PLAYERS) throw new Error(`setup: only ${players.length}/${N_PLAYERS} players joined`);

  const extendNote = configuredHands < N_ROUNDS ? ` (extended to ${N_ROUNDS} via one-more-hand)` : "";
  console.log(
    `setup: game ${admin.gameId.slice(0, 8)} ready, ${players.length} players, ` +
      `${configuredHands} hands/game${extendNote}, ` +
      `restart after round ${RESTART_AT_ROUND}, ${ROUND_WINDOW}s window + ${REVIEW_GAP}s gap ` +
      `(~${Math.round(SESSION_SECONDS / 60)}m total)`
  );
  return {
    gameId: admin.gameId,
    adminToken: admin.adminToken,
    adminPlayerId: admin.playerId,
    configuredHands,
    players
  };
}

// ── Admin: warm up, restart mid-game, then drive the full 30-round game ──────
export function driveGame(data) {
  const state = {
    gameId: data.gameId,
    adminToken: data.adminToken,
    adminPlayerId: data.adminPlayerId,
    configuredHands: data.configuredHands,
    roundsThisGame: 0
  };

  // ── Phase 1: play a few warm-up rounds before the restart ──
  for (let r = 1; r <= RESTART_AT_ROUND; r++) {
    driveOneRound(state, r, RESTART_AT_ROUND, DISTRIBUTIONS[(r - 1) % DISTRIBUTIONS.length]);
    sleep(REVIEW_GAP);
  }

  // ── Restart: mints a new gameId (same adminToken + roster), resets to round 1. ──
  const rg = j(
    post("/restart-game", {
      gameId: state.gameId,
      adminToken: state.adminToken,
      playerId: state.adminPlayerId
    })
  );
  check(rg, { "restart-game ok": (x) => Boolean(x.gameId) });
  if (!rg.gameId) {
    gameErrors.add(1);
  } else {
    state.gameId = rg.gameId;
    state.adminToken = rg.adminToken || state.adminToken; // same token, read back to be safe
    state.configuredHands = rg.totalRounds || state.configuredHands;
    state.roundsThisGame = 0; // fresh game instance — round counter resets
    restartsDriven.add(1);
    console.log(`*** RESTART after round ${RESTART_AT_ROUND} -> new game ${state.gameId.slice(0, 8)}; replaying full ${N_ROUNDS}-round game ***`);
  }
  sleep(REVIEW_GAP);

  // ── Phase 2: drive the full N_ROUNDS-round game to completion ──
  for (let r = 1; r <= N_ROUNDS; r++) {
    driveOneRound(state, r, N_ROUNDS, DISTRIBUTIONS[(r - 1) % DISTRIBUTIONS.length]);
    if (r < N_ROUNDS) sleep(REVIEW_GAP);
  }

  const lb = j(http.get(`${BASE}/leaderboard?gameId=${state.gameId}`, HDR));
  const top = (lb.leaderboard || [])[0];
  console.log(`Final leaderboard: ${(lb.leaderboard || []).length} players | leader=${top?.nickname} $${top?.cumulativeProfit}`);
}

// ── Player: realistic, relaxed refresh + submit; follows the restart's new id ─
let currentGameId = null; // per-VU: tracks the active game, follows restarts

export function playerLoop(data) {
  if (!currentGameId) currentGameId = data.gameId;
  const player = data.players[(__VU - 1) % data.players.length];

  // ~25% of players stay "active": they keep refreshing/browsing throughout the
  // 1-minute waits. The rest submit, then mostly wait (like a real classroom).
  const isActiveUser = __VU % 4 === 0;

  // Poll game-state. If the cached id went stale (a restart minted a new game id), the
  // server answers 400; rediscover the active game via /health and retry with our same
  // playerId — mirroring the real client swapping ids on a `game_restarted` event.
  const t0 = Date.now();
  let res = http.get(`${BASE}/game-state?gameId=${currentGameId}&playerId=${player.playerId}`, HDR);
  if (res.status === 400) {
    const h = j(http.get(`${BASE}/health`, HDR));
    if (h.activeGameId && h.activeGameId !== currentGameId) {
      currentGameId = h.activeGameId;
      restartsFollowed.add(1);
      res = http.get(`${BASE}/game-state?gameId=${currentGameId}&playerId=${player.playerId}`, HDR);
    }
  }
  pollLatency.add(Date.now() - t0);
  const gs = j(res);

  check(gs, { "poll ok": (x) => typeof x.roundPhase === "string" || x.finished === true });

  if (gs.finished) {
    sleep(5 + Math.random() * 5); // game over -> cheap idle
    return;
  }

  if (gs.roundPhase === "active" && gs.player && !gs.player.submittedThisRound) {
    sleep(Math.random() * 3); // brief human reaction delay before ordering
    const qty = chooseOrder(gs.distribution);

    const s0 = Date.now();
    const r = post("/submit-order", { gameId: currentGameId, playerId: player.playerId, orderQuantity: qty });
    submitLatency.add(Date.now() - s0);

    if (r.status === 200) submitAccepted.add(1);
    else if (r.status === 429) submitRateLimited.add(1);
    else if (r.status >= 500) gameErrors.add(1);

    // ~10%: accidental double-submit (the server should reject with 400).
    if (Math.random() < 0.1) {
      const dup = post("/submit-order", { gameId: currentGameId, playerId: player.playerId, orderQuantity: qty });
      if (dup.status === 400) submitDuplicateRejected.add(1);
      else if (dup.status === 429) submitRateLimited.add(1);
      else if (dup.status >= 500) gameErrors.add(1);
    }
  }

  // Light extra activity — active users browse the leaderboard often, others rarely.
  const roll = Math.random();
  if (isActiveUser && roll < 0.5) http.get(`${BASE}/leaderboard?gameId=${currentGameId}`, HDR);
  else if (roll < 0.08) http.get(`${BASE}/leaderboard?gameId=${currentGameId}`, HDR);
  else if (roll < 0.1) http.get(`${BASE}/health`, HDR);

  // Relaxed cadence: the real client is WebSocket-push driven (150s HTTP fallback),
  // so model occasional human-driven refreshes instead of 1s polling.
  if (isActiveUser) sleep(3 + Math.random() * 5); // active: refresh every 3-8s
  else sleep(12 + Math.random() * 13); // lazy: refresh every 12-25s
}

// ── Teardown: close a round if the driver left one open (safety) ─────────────
export function teardown(data) {
  // The active game id may have changed via restart — resolve it before ending.
  const h = j(http.get(`${BASE}/health`, HDR));
  const gameId = h.activeGameId || data.gameId;
  post("/end-round", { gameId, adminToken: data.adminToken });
}
