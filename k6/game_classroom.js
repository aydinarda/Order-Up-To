/**
 * k6 Classroom Game — OrderUpToGame
 *
 * A full-size class to play in yourself: a bot admin creates the game and runs
 * it on a timer, 48 bot students (five personas, see lib/bots.js) play it, and
 * you join from the browser as the 50th player. Not a load test — a playable,
 * realistic game that also walks through the admin features:
 *
 *   before R1  +100 opening stock for every warehouse
 *   R4         the fast truck opens
 *   R6         (mid-round) leaderboard re-ranked on Service level vs Backorders
 *   R8         demand surge N(130, 25)
 *   R10        truck closes, +50 emergency stock, Pareto back to Profit vs CO2
 *
 * After every round the admin logs one line: demand, truck, Pareto pair,
 * leader, front-1 size, class averages and where each human player stands.
 *
 * Run (backend + frontend running locally):
 *   k6 run --env BASE_URL=http://localhost:4000 k6/game_classroom.js
 * then open the frontend, type a nickname and join — do NOT tick
 * "Create active game as admin" (that would replace the bot game).
 *
 * Pacing: --env ROUND_WINDOW=30 --env REVIEW_GAP=10 --env ROUNDS=12 --env PLAYERS=48 (bots)
 * Start:  round 1 waits for a human player — at least JOIN_WAIT (60) seconds in
 *         total and 15 s after the first human joins, at most MAX_WAIT (600)
 *         seconds. --env WAIT_FOR_HUMAN=0 starts after JOIN_WAIT regardless.
 */

import exec from "k6/execution";
import { sleep } from "k6";
import {
  ADMIN_KEY,
  addStock,
  announce,
  botName,
  decideOrder,
  describeRow,
  get,
  isBot,
  j,
  money,
  paretoLabel,
  personaAverages,
  personaFor,
  post,
  setDistribution,
  setPareto,
  setTruck
} from "./lib/bots.js";

const PLAYERS = Number(__ENV.PLAYERS || 48);
const ROUNDS = Number(__ENV.ROUNDS || 12);
const ROUND_WINDOW = Number(__ENV.ROUND_WINDOW || 30);
const REVIEW_GAP = Number(__ENV.REVIEW_GAP || 10);
const JOIN_WAIT = Number(__ENV.JOIN_WAIT || 60);
const WAIT_FOR_HUMAN = (__ENV.WAIT_FOR_HUMAN || "1") !== "0";
const MAX_WAIT = WAIT_FOR_HUMAN ? Math.max(JOIN_WAIT, Number(__ENV.MAX_WAIT || 600)) : JOIN_WAIT;
const HUMAN_GRACE = 15; // seconds between the first human joining and round 1
const SESSION_SECONDS = MAX_WAIT + ROUNDS * (ROUND_WINDOW + REVIEW_GAP) + 60;

// Every VU runs one long iteration that ends when the game is over, so k6
// exits as soon as the last round is played.
export const options = {
  setupTimeout: "120s",
  scenarios: {
    admin: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 1,
      maxDuration: `${SESSION_SECONDS}s`,
      exec: "driveGame"
    },
    players: {
      executor: "per-vu-iterations",
      vus: PLAYERS,
      iterations: 1,
      maxDuration: `${SESSION_SECONDS}s`,
      exec: "playerLoop"
    }
  }
};

// ── Setup: the bot admin creates the game and the bot class joins ───────────
export function setup() {
  if (get("/health").status !== 200) throw new Error("setup: backend /health did not respond");

  const admin = j(post("/start-game", { nickname: "Admin", adminKey: ADMIN_KEY, handsPerTur: ROUNDS }));
  if (!admin.gameId) throw new Error("setup: could not create the game");

  const players = [];
  for (let i = 0; i < PLAYERS; i++) {
    const d = j(post("/start-game", { nickname: botName(i), gameId: admin.gameId }));
    if (d.playerId) players.push({ playerId: d.playerId, persona: personaFor(i) });
  }

  console.log("════════════════════════════════════════════════════════════");
  console.log(`GAME READY — game code (gameId): ${admin.gameId}`);
  console.log(`${players.length} bots + bot admin joined. ${ROUNDS} rounds × ${ROUND_WINDOW}s (+${REVIEW_GAP}s review).`);
  console.log(
    WAIT_FOR_HUMAN
      ? `Join now: open the frontend, type a nickname (NO admin tick). Round 1 starts ${HUMAN_GRACE}s after you join (min ${JOIN_WAIT}s, max ${MAX_WAIT}s).`
      : `Join now: open the frontend, type a nickname (NO admin tick). Round 1 starts in ${JOIN_WAIT}s.`
  );
  console.log("════════════════════════════════════════════════════════════");

  return { gameId: admin.gameId, adminToken: admin.adminToken, adminPlayerId: admin.playerId, players };
}

// ── Admin: waits for humans, then runs the scripted game ────────────────────
function humansIn(rows) {
  return rows.filter((row) => !isBot(row.nickname));
}

function roundLine(roundNo, end) {
  const rows = end.leaderboard || [];
  const config = end.config || {};
  const withService = rows.filter((r) => r.serviceLevelPct != null);
  const avgService = withService.length
    ? `${Math.round(withService.reduce((s, r) => s + r.serviceLevelPct, 0) / withService.length)}%`
    : "—";
  const avgBackorders = rows.length ? Math.round(rows.reduce((s, r) => s + r.cumBackorders, 0) / rows.length) : 0;
  const leader = rows[0];
  const demand = end.realizedDemand == null ? "— (priming)" : end.realizedDemand;
  const humans = humansIn(rows)
    .map((row) => `${row.nickname}: ${describeRow(row)}`)
    .join(" | ");

  return (
    `R${roundNo}/${ROUNDS} | demand ${demand}${end.delayed ? " ⛈ delayed" : ""} | ` +
    `truck ${config.expressEnabled ? "ON" : "off"} | Pareto ${paretoLabel(config)} | ` +
    `leader ${leader ? `${leader.nickname} ${money(leader.cumProfit)}` : "—"} | ` +
    `front-1: ${rows.filter((r) => r.front === 1).length}/${rows.length} | ` +
    `class avg service ${avgService}, backorders ${avgBackorders}` +
    (humans ? ` || YOU → ${humans}` : " || (no human player yet)")
  );
}

function playAdminOrder(data) {
  const gs = j(get(`/game-state?gameId=${data.gameId}&playerId=${data.adminPlayerId}`));
  if (gs.roundPhase === "active") {
    const { orderQty, expressQty } = decideOrder("Base", gs);
    post("/submit-order", { gameId: data.gameId, playerId: data.adminPlayerId, orderQty, expressQty });
  }
}

export function driveGame(data) {
  const { gameId, adminToken } = data;
  const seen = new Set();

  // Join window: report humans as they arrive; start once one has had time to settle in.
  const opened = Date.now();
  let firstHumanAt = null;
  for (;;) {
    const rows = j(get(`/leaderboard?gameId=${gameId}`)).leaderboard || [];
    for (const row of humansIn(rows)) {
      if (!seen.has(row.nickname)) {
        seen.add(row.nickname);
        if (firstHumanAt === null) firstHumanAt = Date.now();
        console.log(`JOINED: ${row.nickname} (human) — ${rows.length} players in the game`);
      }
    }
    const elapsed = (Date.now() - opened) / 1000;
    const humanReady = firstHumanAt !== null && (Date.now() - firstHumanAt) / 1000 >= HUMAN_GRACE;
    if (elapsed >= MAX_WAIT) break;
    if (elapsed >= JOIN_WAIT && (!WAIT_FOR_HUMAN || humanReady)) break;
    sleep(3);
  }
  console.log(`STARTING: ${seen.size} human player(s) — ${ROUNDS} rounds of ${ROUND_WINDOW}s`);

  for (let r = 1; r <= ROUNDS; r++) {
    // Scripted events, applied between rounds.
    if (r === 1) {
      addStock(gameId, adminToken, 100);
      announce(gameId, adminToken, "Opening stock: every warehouse gets +100 kg at the start of round 1.");
      console.log("EVENT before R1: +100 opening stock for everyone");
    }
    if (r === 4) {
      setTruck(gameId, adminToken, true);
      announce(gameId, adminToken, "The fast truck is open from this round on — it lands the same round.");
      console.log("EVENT R4: fast truck opened");
    }
    if (r === 8) {
      setDistribution(gameId, adminToken, { type: "normal", mean: 130, stdDev: 25 });
      announce(gameId, adminToken, "Demand surge: bakeries now expect about 130 kg per round.");
      console.log("EVENT R8: demand surge N(130, 25)");
    }
    if (r === 10) {
      setTruck(gameId, adminToken, false);
      addStock(gameId, adminToken, 50);
      setPareto(gameId, adminToken, "co2", "profit");
      announce(gameId, adminToken, "Truck closed. Emergency supply: +50 kg for everyone. Leaderboard back to Profit vs CO2.");
      console.log("EVENT R10: truck closed, +50 emergency stock, Pareto back to Profit vs CO2");
    }

    const started = j(post("/start-round", { gameId, adminToken }));
    if (started.roundPhase !== "active") {
      console.log(`R${r}: could not start the round — ${JSON.stringify(started).slice(0, 160)}`);
      break;
    }
    playAdminOrder(data);

    if (r === 6) {
      sleep(ROUND_WINDOW / 2);
      setPareto(gameId, adminToken, "backorders", "serviceLevel");
      announce(gameId, adminToken, "The leaderboard now ranks Service level vs Backorders.");
      console.log("EVENT R6 (mid-round): Pareto → Service level vs Backorders");
      sleep(ROUND_WINDOW / 2);
    } else {
      sleep(ROUND_WINDOW);
    }

    const end = j(post("/end-round", { gameId, adminToken }));
    console.log(roundLine(r, end));
    if (end.finished) break;
    sleep(REVIEW_GAP);
  }

  // Final report.
  const rows = j(get(`/leaderboard?gameId=${gameId}`)).leaderboard || [];
  console.log("════════════════════════ FINAL LEADERBOARD ════════════════════════");
  console.log(`Ranked on ${paretoLabel(j(get(`/game-state?gameId=${gameId}`)).config)} — ${rows.length} players`);
  for (const row of rows.slice(0, 10)) console.log(`  ${row.nickname.padEnd(12)} ${describeRow(row)}`);
  for (const row of humansIn(rows)) console.log(`  YOU ${row.nickname}: ${describeRow(row)}`);
  console.log("Persona averages (bots):");
  for (const p of personaAverages(rows)) {
    const service = p.service == null ? "—" : `${Math.round(p.service)}%`;
    console.log(
      `  ${p.persona.padEnd(6)} n=${p.n}  profit ${money(p.profit)}  CO2 ${Math.round(p.co2)} kg  ` +
        `service ${service}  backorders ${Math.round(p.backorders)}  front-1 ${p.front1}`
    );
  }
  console.log("═══════════════════════════════════════════════════════════════════");
}

// ── Bot students: read their own state, think, order — until the game ends ──
export function playerLoop(data) {
  // One iteration per VU, so the scenario's iteration number is a unique
  // 0..N-1 bot index. (__VU is numbered across ALL scenarios — the admin VU
  // takes one of the ids — so __VU-based indexing left one bot unplayed.)
  const bot = data.players[exec.scenario.iterationInTest % data.players.length];
  let misses = 0;

  for (;;) {
    const res = get(`/game-state?gameId=${data.gameId}&playerId=${bot.playerId}`);
    const gs = j(res);

    if (gs.finished) return;
    if (res.status !== 200) {
      // The game was replaced or ended by an admin: give up after a while.
      if (++misses >= 10) return;
      sleep(3);
      continue;
    }
    misses = 0;

    if (gs.roundPhase === "active" && gs.player && !gs.player.submittedThisRound) {
      // Think like a student, but always submit within the first half of the window.
      sleep(Math.random() * ROUND_WINDOW * 0.3);
      const { orderQty, expressQty } = decideOrder(bot.persona, gs);
      post("/submit-order", { gameId: data.gameId, playerId: bot.playerId, orderQty, expressQty });
    }

    // Look again soon enough to catch every round (at most a fifth of the window).
    sleep(1 + Math.random() * Math.min(4, ROUND_WINDOW / 5));
  }
}

// Safety: close a round the driver left open.
export function teardown(data) {
  post("/end-round", { gameId: data.gameId, adminToken: data.adminToken });
}
