/**
 * k6 Concurrent Load Tests – SimpleNewsVendorGame
 *
 * NOT: Sunucu tek bir aktif oyun tutar. Setup bu oyunu oluşturur ve
 * 100 oyuncu önceden eklenir; tüm senaryolar bu veriyi kullanır.
 *
 * Senaryolar:
 *   1. poll_storm        – 100 VU, /game-state'i 30 sn boyunca sürekli sorgular
 *   2. concurrent_submit – 100 VU eş zamanlı olarak sipariş verir
 *   3. health_storm      – 100 VU /health'i 15 sn boyunca sorgular
 *   4. spike_join        – 50 yeni VU aynı anda oyuna katılmaya çalışır
 *
 * Eşikler (Render free tier için gerçekçi değerler):
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

// ── Özel metrikler ────────────────────────────────────────────────────────────
const submitLatency = new Trend('submit_latency', true);
const pollLatency   = new Trend('poll_latency',   true);
const joinLatency   = new Trend('join_latency',   true);
const gameErrors    = new Counter('game_errors');

const N_PLAYERS   = 100;
const N_SPIKE_VUS = 50;

// ── Seçenekler ────────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // 1. 100 VU → /game-state (tur aktifken, 30 sn boyunca)
    poll_storm: {
      executor:  'constant-vus',
      vus:       100,
      duration:  '30s',
      startTime: '5s',
      exec:      'pollStorm',
      tags:      { scenario: 'poll_storm' },
    },

    // 2. 100 VU → /submit-order (eş zamanlı, her biri 1 kez)
    concurrent_submit: {
      executor:    'shared-iterations',
      vus:         N_PLAYERS,
      iterations:  N_PLAYERS,
      maxDuration: '30s',
      startTime:   '40s',
      exec:        'concurrentSubmit',
      tags:        { scenario: 'concurrent_submit' },
    },

    // 3. 100 VU → /health (15 sn boyunca)
    health_storm: {
      executor:  'constant-vus',
      vus:       100,
      duration:  '15s',
      startTime: '75s',
      exec:      'healthStorm',
      tags:      { scenario: 'health_storm' },
    },

    // 4. 50 yeni VU → /start-game (eş zamanlı join dalgası)
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
    // Render free tier cold-start sonrası latency'leri yüksek olabiliyor
    'submit_latency': ['p(95)<8000'],
    'poll_latency':   ['p(95)<5000'],
    'join_latency':   ['p(95)<8000'],
    // 5xx hatası sayacı — spike_join/submit 4xx'leri buraya girmez
    'game_errors':    ['count<20'],
    // health_storm %100 başarılı olmalı; diğer senaryolarda 4xx beklenen davranış
    'http_req_failed{scenario:health_storm}': ['rate<0.05'],
  },
};

// ── Yardımcı fonksiyonlar ─────────────────────────────────────────────────────
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

// ── Setup: tüm senaryolardan önce 1 kez çalışır ───────────────────────────────
export function setup() {
  // Backend'in ayakta olduğunu doğrula
  let alive = false;
  for (let i = 0; i < 6; i++) {
    const r = http.get(`${BASE}/health`, HDR);
    if (r.status === 200) { alive = true; break; }
    sleep(5);
  }
  if (!alive) throw new Error('setup: /health yanıt vermedi');

  // Admin oyunu oluşturur (1 hand → sade test ortamı)
  const adminR = post('/start-game', {
    nickname:    'admin_k6',
    adminKey:    ADMIN_KEY,
    handsPerTur: 1,
  });
  const adminD = j(adminR);
  if (!adminD.gameId || !adminD.adminToken) {
    throw new Error(`setup: oyun oluşturulamadı – ${adminR.body.slice(0, 200)}`);
  }
  const { gameId, adminToken } = adminD;
  const adminPlayerId = adminD.playerId;

  // 100 oyuncu katılır (sıralı – setup tek VU'da çalışır)
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
    throw new Error(`setup: ${players.length}/${N_PLAYERS} oyuncu katıldı`);
  }

  // Admin turu başlatır
  const startR = post('/start-round', { gameId, adminToken });
  const startD = j(startR);
  if (startD.roundPhase !== 'active') {
    throw new Error(`setup: tur başlatılamadı – ${startR.body.slice(0, 200)}`);
  }

  return { gameId, adminToken, adminPlayerId, players };
}

// ── Senaryo 1: poll_storm ─────────────────────────────────────────────────────
export function pollStorm(data) {
  const player = data.players[(__VU - 1) % data.players.length];
  const t0     = Date.now();
  const r      = http.get(gameStateUrl(data.gameId, player.playerId), HDR);
  pollLatency.add(Date.now() - t0);

  const d  = j(r);
  const ok = check(r, {
    'poll: 200':            () => r.status === 200,
    'poll: roundPhase set': () => typeof d.roundPhase === 'string',
    'poll: gameId eşleşti': () => d.gameId === data.gameId,
  });
  if (!ok) gameErrors.add(1);
  sleep(1);
}

// ── Senaryo 2: concurrent_submit ──────────────────────────────────────────────
export function concurrentSubmit(data) {
  const idx    = scenario.iterationInTest % data.players.length;
  const player = data.players[idx];
  const qty    = Math.floor(Math.random() * 41) + 80; // 80–120

  const t0 = Date.now();
  const r  = post('/submit-order', {
    gameId:        data.gameId,
    playerId:      player.playerId,
    orderQuantity: qty,
  });
  submitLatency.add(Date.now() - t0);

  const d  = j(r);
  // 400 "already submitted" beklenen — sadece 5xx gerçek hata
  const ok = check(r, {
    'submit: 5xx yok':       () => r.status < 500,
    'submit: accepted true': () => r.status !== 200 || d.accepted === true,
  });
  if (r.status >= 500) gameErrors.add(1);
}

// ── Senaryo 3: health_storm ───────────────────────────────────────────────────
export function healthStorm(_data) {
  const r  = http.get(`${BASE}/health`, HDR);
  const d  = j(r);
  const ok = check(r, {
    'health: 200':     () => r.status === 200,
    'health: ok true': () => d.ok === true,
  });
  if (!ok) gameErrors.add(1);
}

// ── Senaryo 4: spike_join ─────────────────────────────────────────────────────
// 50 yeni isimle oyuna eş zamanlı katılma denemesi.
// 400 (oyun bitti) / 409 (isim çakışması) beklenen — 5xx OLMAMALI.
export function spikeJoin(data) {
  const name = `Spike_${scenario.iterationInTest + 1}_${__VU}`;
  const t0   = Date.now();
  const r    = post('/start-game', { nickname: name, gameId: data.gameId });
  joinLatency.add(Date.now() - t0);

  const ok = check(r, {
    'spike_join: 5xx yok':     () => r.status < 500,
    'spike_join: 200/400/409': () =>
      r.status === 200 || r.status === 400 || r.status === 409,
  });
  if (!ok) gameErrors.add(1); // sadece 5xx gerçek hata
}

// ── Teardown: tüm senaryolar bittikten sonra 1 kez çalışır ───────────────────
export function teardown(data) {
  // Admin turu bitirir
  const endR = post('/end-round', { gameId: data.gameId, adminToken: data.adminToken });
  const endD = j(endR);
  check(endD, {
    'teardown: tur bitti':     () => endD.roundPhase === 'pending' || endD.finished === true,
    'teardown: leaderboard var': () => Array.isArray(endD.leaderboard),
    'teardown: realizedDemand var': () => typeof endD.realizedDemand === 'number',
  });

  if (typeof endD.realizedDemand === 'number') {
    console.log(`teardown: gerçekleşen talep = ${endD.realizedDemand}`);
  }

  // Admin roundHistory'i görebilmeli (yeni özellik doğrulama)
  const gsR = http.get(
    gameStateUrl(data.gameId, data.adminPlayerId, data.adminToken),
    HDR
  );
  const gsd = j(gsR);
  check(gsd, {
    'teardown: roundHistory admin için görünür': () => Array.isArray(gsd.roundHistory),
    'teardown: en az 1 kayıt var':              () => (gsd.roundHistory || []).length >= 1,
    'teardown: realizedDemand kayıtlı':         () =>
      typeof (gsd.roundHistory || [])[0]?.realizedDemand === 'number',
  });

  // Liderboard doğrula
  const lbR = http.get(`${BASE}/leaderboard?gameId=${data.gameId}`, HDR);
  const lbd = j(lbR);
  check(lbd, {
    'teardown: leaderboard endpoint çalışıyor': () => lbR.status === 200,
    'teardown: leaderboard dolu':               () => (lbd.leaderboard || []).length > 0,
  });
}
