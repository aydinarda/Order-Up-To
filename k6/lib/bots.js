/**
 * Shared bot behaviour for the k6 scripts — OrderUpToGame.
 *
 * Players: five order-up-to personas that read their own /game-state
 * (on hand, in transit, stock the admin added, lead time, demand distribution)
 * and decide how much to ship and truck — so a bot class spreads out across
 * all four leaderboard KPIs (profit, service level, backorders, CO2) instead
 * of everyone ordering "about the mean".
 *
 *   Base  — base-stock: raise inventory position to S = (L+1)μ + 0.97σ√(L+1)
 *           (critical ratio backorder 5 / (5 + holding 1) ≈ 0.83 → z ≈ 0.97)
 *   Safe  — same, but z = 2: high service, more stock + storage CO2
 *   Green — z = 0 and ships only full vessels: low transport CO2, more backorders
 *   Truck — Base, plus rescues this round's shortfall by truck while it is open
 *   Naive — the untrained student: orders μ ± 40% every round, ignores the pipeline
 *
 * Admin: helpers for the newer admin actions (add stock to everyone, Pareto
 * pair, truck on/off, announcements, distribution), each checked and counted.
 */

import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

export const BASE = (__ENV.BASE_URL || "https://simplenewsvendorgame.onrender.com").replace(/\/$/, "");
export const ADMIN_KEY = __ENV.ADMIN_KEY || "admin123";
export const HDR = { headers: { "Content-Type": "application/json" } };

// ── Metrics for the admin actions ───────────────────────────────────────────
export const stockAdds = new Counter("stock_adds");
export const paretoSwitches = new Counter("pareto_switches");
export const truckToggles = new Counter("truck_toggles");
// Time for /set-config to re-rank the whole leaderboard on a new Pareto pair.
export const rerankLatency = new Trend("rerank_latency", true);

// ── HTTP helpers ────────────────────────────────────────────────────────────
// Node closes idle keep-alive sockets after 5 s; a VU that slept longer (the
// admin waiting out a round) may reuse a socket the server already closed and
// get "connection reset" (status 0). Such a request never reached the server,
// so it is safe to send once more.
function withRetry(send) {
  const res = send();
  return res.status === 0 ? send() : res;
}

export function post(path, body) {
  return withRetry(() => http.post(`${BASE}${path}`, JSON.stringify(body), HDR));
}

export function get(path) {
  return withRetry(() => http.get(`${BASE}${path}`, HDR));
}

export function j(res) {
  try {
    return JSON.parse(res.body) || {};
  } catch {
    return {};
  }
}

// ── Personas ────────────────────────────────────────────────────────────────
export const PERSONAS = ["Base", "Safe", "Green", "Truck", "Naive"];
const BOT_NAME = /^(Base|Safe|Green|Truck|Naive)\d+$/;

export function personaFor(index) {
  return PERSONAS[index % PERSONAS.length];
}

// "Base01", "Safe02", ... — the persona is readable straight off the leaderboard.
export function botName(index, width = 2) {
  return `${personaFor(index)}${String(index + 1).padStart(width, "0")}`;
}

export function personaOf(nickname) {
  const match = BOT_NAME.exec(nickname || "");
  return match ? match[1] : null;
}

export function isBot(nickname) {
  return personaOf(nickname) !== null || nickname === "Admin" || /^admin_/i.test(nickname || "");
}

// Mean and standard deviation of the round's demand distribution.
export function demandStats(d = {}) {
  if (d.type === "normal") {
    return { mean: d.mean ?? 100, sd: d.stdDev ?? 0 };
  }
  const min = d.min ?? 80;
  const max = d.max ?? 120;
  return { mean: (min + max) / 2, sd: (max - min) / Math.sqrt(12) };
}

// The order a persona places this round, from its own /game-state response.
export function decideOrder(persona, gs) {
  const config = gs.config || {};
  const inventory = (gs.player && gs.player.inventory) || { onHand: 0, inTransit: 0, pipeline: [] };
  const { mean, sd } = demandStats(gs.distribution || (gs.currentRound && gs.currentRound.distribution));
  // Round 1 is the priming round: the opening order arrives in 1 round.
  const priming = gs.currentRound && gs.currentRound.id === 1;
  const leadTime = priming ? 1 : config.leadTime || 2;
  // Stock the admin added lands at the start of this round — count it as on hand.
  const onHand = (inventory.onHand || 0) + (gs.pendingStockAdded || 0);
  const position = onHand + (inventory.inTransit || 0);
  const target = (z) => Math.round((leadTime + 1) * mean + z * sd * Math.sqrt(leadTime + 1));
  const upTo = (z) => Math.max(0, target(z) - position);

  if (persona === "Naive") {
    return { orderQty: Math.max(0, Math.round(mean * (0.6 + Math.random() * 0.8))), expressQty: 0 };
  }
  if (persona === "Safe") {
    return { orderQty: upTo(2), expressQty: 0 };
  }
  if (persona === "Green") {
    const capacity = config.shipCapacity || 100;
    const needed = upTo(0);
    // Only sail full ships: wait until the need fills most of one.
    return {
      orderQty: needed >= 0.8 * capacity ? Math.ceil(needed / capacity) * capacity : 0,
      expressQty: 0
    };
  }

  const orderQty = upTo(0.97);
  if (persona === "Truck" && config.expressEnabled && !priming) {
    // What lands this round anyway: stock on hand + the ship due now.
    const landing = onHand + ((inventory.pipeline && inventory.pipeline[0]) || 0);
    const shortfall = Math.round(mean - landing);
    return { orderQty, expressQty: Math.max(0, shortfall) };
  }
  return { orderQty, expressQty: 0 };
}

// ── Admin actions ───────────────────────────────────────────────────────────
export function addStock(gameId, adminToken, qty) {
  const res = post("/add-stock", { gameId, adminToken, qty });
  if (check(res, { "add-stock 200": (r) => r.status === 200 })) {
    stockAdds.add(1);
  }
  return j(res);
}

// Works mid-round too (the Pareto pair is presentation only).
export function setPareto(gameId, adminToken, x, y) {
  const t0 = Date.now();
  const res = post("/set-config", { gameId, adminToken, paretoX: x, paretoY: y });
  rerankLatency.add(Date.now() - t0);
  if (check(res, { "pareto switch 200": (r) => r.status === 200 })) {
    paretoSwitches.add(1);
  }
  return j(res);
}

export function setTruck(gameId, adminToken, on) {
  const res = post("/set-config", { gameId, adminToken, expressEnabled: on });
  if (check(res, { "truck toggle 200": (r) => r.status === 200 })) {
    truckToggles.add(1);
  }
  return j(res);
}

export function announce(gameId, adminToken, message) {
  return j(post("/announce", { gameId, adminToken, message }));
}

export function setDistribution(gameId, adminToken, distribution) {
  const res = post("/set-distribution", { gameId, adminToken, ...distribution });
  check(res, { "set-distribution 200": (r) => r.status === 200 });
  return j(res);
}

// Pairs the admin cycles through (x, y).
export const PARETO_PAIRS = [
  ["co2", "profit"],
  ["backorders", "serviceLevel"],
  ["co2", "serviceLevel"],
  ["backorders", "profit"]
];

// ── Reporting ───────────────────────────────────────────────────────────────
const LABELS = { profit: "Profit", serviceLevel: "Service", backorders: "Backorders", co2: "CO2" };

export function paretoLabel(config) {
  return `${LABELS[config?.paretoY] || "Profit"} vs ${LABELS[config?.paretoX] || "CO2"}`;
}

// k6's JS runtime has no locale-aware toLocaleString, so group digits by hand.
export function money(value) {
  const rounded = Math.round(value || 0);
  const digits = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${rounded < 0 ? "-" : ""}$${digits}`;
}

// One leaderboard row as "#rank (front f) $profit · co2 kg · service% · backorders bo".
export function describeRow(row) {
  const service = row.serviceLevelPct == null ? "—" : `${Math.round(row.serviceLevelPct)}%`;
  return (
    `#${row.rank} (front ${row.front}) ${money(row.cumProfit)} · ${Math.round(row.cumCo2)} kg · ` +
    `${service} · ${row.cumBackorders} bo`
  );
}

// Average KPIs per persona (bots only).
export function personaAverages(rows) {
  const groups = {};
  for (const row of rows) {
    const persona = personaOf(row.nickname);
    if (!persona) continue;
    const g = (groups[persona] = groups[persona] || { n: 0, profit: 0, co2: 0, service: 0, serviceN: 0, backorders: 0, front1: 0 });
    g.n += 1;
    g.profit += row.cumProfit || 0;
    g.co2 += row.cumCo2 || 0;
    g.backorders += row.cumBackorders || 0;
    if (row.serviceLevelPct != null) {
      g.service += row.serviceLevelPct;
      g.serviceN += 1;
    }
    if (row.front === 1) g.front1 += 1;
  }
  return PERSONAS.filter((p) => groups[p]).map((p) => {
    const g = groups[p];
    return {
      persona: p,
      n: g.n,
      profit: g.profit / g.n,
      co2: g.co2 / g.n,
      service: g.serviceN ? g.service / g.serviceN : null,
      backorders: g.backorders / g.n,
      front1: g.front1
    };
  });
}
