/**
 * k6 Concurrent Load Tests – OrderUpToGame
 *
 * NOTE: The server holds a single active game. Setup creates that game and
 * pre-registers 100 players; every scenario reuses this shared data.
 *
 * Scenarios:
 *   1. poll_storm        – 100 VUs hammer /game-state for 30s while a round is active
 *   2. concurrent_submit – 100 VUs place an order at the same time
 *   3. health_storm      – 100 VUs poll /health for 15s
 *   4. spike_join        – 50 fresh VUs try to join the game simultaneously
 *
 * Thresholds (realistic for Render free tier):
 *   - submit p(95) < 8000 ms
 *   - poll   p(95) < 5000 ms
 *   - join   p(95) < 8000 ms
 *   - game_errors < 20
 */

import http             from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { scenario }     from 'k6/execution';

const BASE      = (__ENV.BASE_URL  || 'https://simplenewsvendorgame.onrender.com').replace(/\/$/, '');
const ADMIN_KEY = __ENV.ADMIN_KEY  || 'admin123';
const HDR       = { headers: { 'Content-Type': 'application/json' } };

// ── Custom metrics ────────────────────────────────────────────────────────────
const submitLatency = new Trend('submit_latency', true);
const pollLatency   = new Trend('poll_latency',   true);
const joinLatency   = new Trend('join_latency',   true);
const gameErrors    = new Counter('game_errors');

const N_PLAYERS   = 100;
const N_SPIKE_VUS = 50;

// ── Options ───────────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // 1. 100 VUs → /game-state (while a round is active, for 30s)
    poll_storm: {
      executor:  'constant-vus',
      vus:       100,
      duration:  '30s',
      startTime: '5s',
      exec:      'pollStorm',
      tags:      { scenario: 'poll_storm' },
    },

    // 2. 100 VUs → /submit-order (concurrent, one each)
    concurrent_submit: {
      executor:    'shared-iterations',
      vus:         N_PLAYERS,
      iterations:  N_PLAYERS,
      maxDuration: '30s',
      startTime:   '40s',
      exec:        'concurrentSubmit',
      tags:        { scenario: 'concurrent_submit' },
    },

    // 3. 100 VUs → /health (for 15s)
    health_storm: {
      executor:  'constant-vus',
      vus:       100,
      duration:  '15s',
      startTime: '75s',
      exec:      'healthStorm',
      tags:      { scenario: 'health_storm' },
    },

    // 4. 50 fresh VUs → /start-game (simultaneous join wave)
    spike_join: {
      executor:    'shared-iterations',
      vus:         N_SPIKE_VUS,
      iterations:  N_SPIKE_VUS,
      maxDuration: '30s',
      startTime:   '100s',
      exec:        'spikeJoin',
      tags:        { scenario: 'spike_join' },
    },
  },

  thresholds: {
    // Latencies can spike after a Render free-tier cold start.
    'submit_latency': ['p(95)<8000'],
    'poll_latency':   ['p(95)<5000'],
    'join_latency':   ['p(95)<8000'],
    // 5xx error counter — spike_join/submit 4xx responses do not count here.
    'game_errors':    ['count<20'],
    // health_storm must be 100% healthy; 4xx in other scenarios is expected.
    'http_req_failed{scenario:health_storm}': ['rate<0.05'],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function post(path, body) {
  return http.post(`${BASE}${path}`, JSON.stringify(body), HDR);
}

function j(res) {
  try   { return JSON.parse(res.body) || {}; }
  catch { return {}; }
}

function gameStateUrl(gameId, playerId, adminToken) {
  let url = `${BASE}/game-state?gameId=${gameId}&playerId=${playerId}`;
  if (adminToken) url += `&adminToken=${adminToken}`;
  return url;
}

// ── Setup: runs once before all scenarios ─────────────────────────────────────
export function setup() {
  // Make sure the backend is awake.
  let alive = false;
  for (let i = 0; i < 6; i++) {
    const r = http.get(`${BASE}/health`, HDR);
    if (r.status === 200) { alive = true; break; }
    sleep(5);
  }
  if (!alive) throw new Error('setup: /health did not respond');

  // Admin creates the game. handsPerTur=2: round 1 is the "priming" round (no
  // demand is realized — the opening order just arrives after the lead time),
  // and the real demand round is round 2. Setup plays through the priming round
  // in setup so the scenarios submit into round 2 and teardown sees a real
  // realizedDemand.
  const adminR = post('/start-game', {
    nickname:    'admin_k6',
    adminKey:    ADMIN_KEY,
    handsPerTur: 2,
  });
  const adminD = j(adminR);
  if (!adminD.gameId || !adminD.adminToken) {
    throw new Error(`setup: could not create game – ${adminR.body.slice(0, 200)}`);
  }
  const { gameId, adminToken } = adminD;
  const adminPlayerId = adminD.playerId;

  // 100 players join (sequentially – setup runs in a single VU).
  const players = [];
  for (let i = 0; i < N_PLAYERS; i++) {
    const r = post('/start-game', {
      nickname: `P${String(i + 1).padStart(3, '0')}`,
      gameId,
    });
    const d = j(r);
    if (d.playerId) {
      players.push({ playerId: d.playerId, nickname: d.nickname });
    }
  }
  if (players.length < N_PLAYERS) {
    throw new Error(`setup: ${players.length}/${N_PLAYERS} players joined`);
  }

  // Play the priming round to completion (round 1 realizes no demand). Missing
  // submissions default to 0, so we can end it immediately.
  const prime = j(post('/start-round', { gameId, adminToken }));
  if (prime.roundPhase !== 'active') {
    throw new Error(`setup: could not start priming round – ${JSON.stringify(prime).slice(0, 200)}`);
  }
  post('/end-round', { gameId, adminToken });

  // Start round 2 — the real demand round the scenarios will poll/submit against.
  const startR = post('/start-round', { gameId, adminToken });
  const startD = j(startR);
  if (startD.roundPhase !== 'active') {
    throw new Error(`setup: could not start round – ${startR.body.slice(0, 200)}`);
  }

  return { gameId, adminToken, adminPlayerId, players };
}

// ── Scenario 1: poll_storm ────────────────────────────────────────────────────
export function pollStorm(data) {
  const player = data.players[(__VU - 1) % data.players.length];
  const t0     = Date.now();
  const r      = http.get(gameStateUrl(data.gameId, player.playerId), HDR);
  pollLatency.add(Date.now() - t0);

  const d  = j(r);
  const ok = check(r, {
    'poll: 200':             () => r.status === 200,
    'poll: roundPhase set':  () => typeof d.roundPhase === 'string',
    'poll: gameId matches':  () => d.gameId === data.gameId,
  });
  if (!ok) gameErrors.add(1);
  sleep(1);
}

// ── Scenario 2: concurrent_submit ─────────────────────────────────────────────
export function concurrentSubmit(data) {
  const idx    = scenario.iterationInTest % data.players.length;
  const player = data.players[idx];
  const qty    = Math.floor(Math.random() * 41) + 80; // 80–120

  // Two-vehicle order: most rides the consolidated truck; ~30% of players also
  // split a little onto the express van (arrives same round) to exercise both legs.
  const useExpress = Math.random() < 0.3;
  const expressQty = useExpress ? Math.floor(Math.random() * 30) + 10 : 0; // 10–39

  const t0 = Date.now();
  const r  = post('/submit-order', {
    gameId:   data.gameId,
    playerId: player.playerId,
    orderQty: qty,
    expressQty,
  });
  submitLatency.add(Date.now() - t0);

  const d  = j(r);
  // 400 "already submitted" is expected — only 5xx is a real failure.
  const ok = check(r, {
    'submit: no 5xx':        () => r.status < 500,
    'submit: accepted true': () => r.status !== 200 || d.accepted === true,
  });
  if (r.status >= 500) gameErrors.add(1);
}

// ── Scenario 3: health_storm ──────────────────────────────────────────────────
export function healthStorm(_data) {
  const r  = http.get(`${BASE}/health`, HDR);
  const d  = j(r);
  const ok = check(r, {
    'health: 200':     () => r.status === 200,
    'health: ok true': () => d.ok === true,
  });
  if (!ok) gameErrors.add(1);
}

// ── Scenario 4: spike_join ────────────────────────────────────────────────────
// 50 fresh names try to join the game at the same time.
// 400 (game over) / 409 (name clash) are expected — 5xx must NOT happen.
export function spikeJoin(data) {
  const name = `Spike_${scenario.iterationInTest + 1}_${__VU}`;
  const t0   = Date.now();
  const r    = post('/start-game', { nickname: name, gameId: data.gameId });
  joinLatency.add(Date.now() - t0);

  const ok = check(r, {
    'spike_join: no 5xx':      () => r.status < 500,
    'spike_join: 200/400/409': () =>
      r.status === 200 || r.status === 400 || r.status === 409,
  });
  if (!ok) gameErrors.add(1); // only 5xx is a real failure
}

// ── Teardown: runs once after all scenarios finish ───────────────────────────
export function teardown(data) {
  // Admin ends the (round 2) round.
  const endR = post('/end-round', { gameId: data.gameId, adminToken: data.adminToken });
  const endD = j(endR);
  check(endD, {
    'teardown: round ended':       () => endD.roundPhase === 'pending' || endD.finished === true,
    'teardown: leaderboard set':   () => Array.isArray(endD.leaderboard),
    'teardown: realizedDemand set': () => typeof endD.realizedDemand === 'number',
  });

  if (typeof endD.realizedDemand === 'number') {
    console.log(`teardown: realized demand = ${endD.realizedDemand}`);
  }

  // Admin should be able to see roundHistory (feature check).
  const gsR = http.get(
    gameStateUrl(data.gameId, data.adminPlayerId, data.adminToken),
    HDR
  );
  const gsd = j(gsR);
  const history = gsd.roundHistory || [];
  check(gsd, {
    'teardown: roundHistory visible to admin': () => Array.isArray(gsd.roundHistory),
    'teardown: at least one record':           () => history.length >= 1,
    // The last record is round 2 (real demand); the priming round records null.
    'teardown: realizedDemand recorded':       () =>
      typeof history[history.length - 1]?.realizedDemand === 'number',
  });

  // Verify the leaderboard.
  const lbR = http.get(`${BASE}/leaderboard?gameId=${data.gameId}`, HDR);
  const lbd = j(lbR);
  check(lbd, {
    'teardown: leaderboard endpoint works': () => lbR.status === 200,
    'teardown: leaderboard populated':      () => (lbd.leaderboard || []).length > 0,
  });
}
