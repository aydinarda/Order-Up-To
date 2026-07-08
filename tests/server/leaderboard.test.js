import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../../server/index.js";

const ADMIN_KEY = "admin123";

// Deterministic demand: a normal distribution with stdDev=0 always equals the
// mean. The warehouse starts empty and round 1 is a priming round (no sales;
// the opening order arrives next round with lead time 1). Default config: L=2,
// price 40, unitCost 10, holding 1, truckCapacity 100, truckCost 50,
// co2PerTruck 100, co2PerUnitHeld 0.5.
//
// A 2-round game (priming + one selling round at demand 100), player orders
// q1 (opening) then q2:
//   round 1: profit = -10*q1 - 50*ceil(q1/100);              co2 = 100*ceil(q1/100)
//   round 2: arrival q1, sold min(q1,100), onHandEnd q1-sold,
//            profit = 40*sold - 10*q2 - onHandEnd - 50*ceil(q2/100)
//            co2 = 100*ceil(q2/100) + 0.5*onHandEnd
async function setupDeterministicGame(app, { demand = 100, handsPerTur = 2 } = {}) {
  const admin = await request(app)
    .post("/start-game")
    .send({ nickname: "Alice", adminKey: ADMIN_KEY, handsPerTur });
  const { gameId, adminToken, playerId } = admin.body;

  await request(app)
    .post("/set-distribution")
    .send({ gameId, adminToken, type: "normal", mean: demand, stdDev: 0 });

  return { gameId, adminToken, alice: playerId };
}

async function join(app, gameId, nickname) {
  const res = await request(app).post("/start-game").send({ nickname, gameId });
  return res.body.playerId;
}

async function playRound(app, gameId, adminToken, submissions) {
  await request(app).post("/start-round").send({ gameId, adminToken });
  for (const [playerId, orderQty] of Object.entries(submissions)) {
    await request(app).post("/submit-order").send({ gameId, playerId, orderQty });
  }
  return request(app).post("/end-round").send({ gameId, adminToken });
}

function rows(res) {
  return res.body.leaderboard.map((r) => [r.rank, r.front, r.nickname, r.cumulativeProfit]);
}

test("ranks players by Pareto front, then profit within a front", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, alice } = await setupDeterministicGame(app);
  const bob = await join(app, gameId, "Bob");

  // Round 1 (priming): opening orders. Round 2 (selling): both order 0.
  // Alice q1=100 -> profit -1050 + 4000 = 2950, co2 100 + 0 = 100
  // Bob   q1=200 -> profit -2100 + 3900 = 1800, co2 200 + 50 = 250
  await playRound(app, gameId, adminToken, { [alice]: 100, [bob]: 200 });
  await playRound(app, gameId, adminToken, { [alice]: 0, [bob]: 0 });

  const res = await request(app).get("/leaderboard").query({ gameId });
  assert.deepEqual(rows(res), [
    [1, 1, "Alice", 2950], // dominates Bob on both profit and CO2
    [2, 2, "Bob", 1800]
  ]);
});

test("leaderboard rows carry CO2, lost sales and truck-fill KPIs", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, alice } = await setupDeterministicGame(app);

  // q1=150 opening (2 trucks), q2=0. sold 100, onHandEnd 50.
  await playRound(app, gameId, adminToken, { [alice]: 150 });
  await playRound(app, gameId, adminToken, { [alice]: 0 });

  const res = await request(app).get("/leaderboard").query({ gameId });
  const row = res.body.leaderboard[0];
  assert.equal(row.cumulativeProfit, 2350); // -1600 + 3950
  assert.equal(row.cumCo2, 225); // 200 + 25
  assert.equal(row.cumLost, 0);
  assert.equal(row.cumTrucks, 2);
  assert.equal(row.truckFillPct, 75); // 150 ordered / (2 trucks * 100)
  assert.equal(row.leftover, 50); // 50 on hand, empty pipeline
});

test("identical strategies share front 1 in stable (join) order with sequential ranks", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, alice } = await setupDeterministicGame(app);
  const bob = await join(app, gameId, "Bob");

  await playRound(app, gameId, adminToken, { [alice]: 100, [bob]: 100 });
  await playRound(app, gameId, adminToken, { [alice]: 0, [bob]: 0 });

  const res = await request(app).get("/leaderboard").query({ gameId });
  assert.deepEqual(rows(res), [
    [1, 1, "Alice", 2950],
    [2, 1, "Bob", 2950]
  ]);
});

test("a player who never submits is scored with the zero fallback, not a crash", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, alice } = await setupDeterministicGame(app);
  const idle = await join(app, gameId, "Idle");

  // Alice plays q1=100 then 0; Idle never submits (fallback 0 every round).
  await playRound(app, gameId, adminToken, { [alice]: 100 });
  await playRound(app, gameId, adminToken, { [alice]: 0 });

  const res = await request(app).get("/leaderboard").query({ gameId });
  // Idle ordered nothing -> profit 0, co2 0. Alice (2950, 100). Idle's zero CO2
  // is undominated, so both sit on front 1; ranked by profit.
  assert.deepEqual(rows(res), [
    [1, 1, "Alice", 2950],
    [2, 1, "Idle", 0]
  ]);
  const idleRow = res.body.leaderboard.find((r) => r.nickname === "Idle");
  assert.equal(idleRow.cumCo2, 0);
});

test("a non-submitter still receives a visible round result", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, alice } = await setupDeterministicGame(app, { handsPerTur: 2 });
  const idle = await join(app, gameId, "Idle");

  await playRound(app, gameId, adminToken, { [alice]: 100 }); // priming
  await playRound(app, gameId, adminToken, { [alice]: 0 }); // selling; game ends

  const state = await request(app).get("/game-state").query({ gameId, playerId: idle });
  assert.equal(state.status, 200);
  // Game ended: the round results moved into the tur snapshot.
  const lastTur = state.body.player.turHistory[state.body.player.turHistory.length - 1];
  assert.equal(lastTur.rounds.length, 2);
  assert.equal(lastTur.rounds[0].priming, true); // round 1 was the priming round
  assert.equal(lastTur.rounds[1].orderQty, 0); // fallback order
});

test("extreme over-ordering produces a negative cumulative profit", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, alice } = await setupDeterministicGame(app);

  // q1=800 opening (8 trucks) then 0. r1 profit -8400; r2 sells 100, holds 700.
  await playRound(app, gameId, adminToken, { [alice]: 800 });
  await playRound(app, gameId, adminToken, { [alice]: 0 });

  const res = await request(app).get("/leaderboard").query({ gameId });
  // r1: -8000 - 400 = -8400; r2: 4000 - 700(holding) = 3300 -> -5100
  assert.equal(res.body.leaderboard[0].cumulativeProfit, -5100);
});

test("profit, CO2 and inventory carry over across the priming and selling rounds", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, alice } = await setupDeterministicGame(app, { handsPerTur: 3 });

  // Round 1 (priming): open with q1=200 -> arrives round 2. Inventory: in transit 200.
  await playRound(app, gameId, adminToken, { [alice]: 200 });
  const mid = await request(app).get("/game-state").query({ gameId, playerId: alice });
  assert.equal(mid.body.player.inventory.onHand, 0);
  assert.equal(mid.body.player.inventory.inTransit, 200);

  // Round 2 (selling): arrival 200, sold 100, hold 100, order 0.
  //   profit -2100 (r1) + 3900 (r2) so far.
  await playRound(app, gameId, adminToken, { [alice]: 0 });
  // Round 3 (selling): arrival 0, sell the held 100 -> profit 4000, co2 0.
  await playRound(app, gameId, adminToken, { [alice]: 0 });

  const res = await request(app).get("/leaderboard").query({ gameId });
  assert.equal(res.body.leaderboard[0].cumulativeProfit, 5800); // -2100 + 3900 + 4000
  assert.equal(res.body.leaderboard[0].cumCo2, 250); // 200 + 50 + 0
});
