import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../../server/index.js";

const ADMIN_KEY = "admin123";

// Deterministic demand: a normal distribution with stdDev=0 always equals the mean,
// so S -> order -> profit/CO2 -> leaderboard becomes fully deterministic.
//
// Default config: L=2, price 40, unitCost 10, holding 1, truckCapacity 100,
// truckCost 50, co2PerTruck 100, co2PerUnitHeld 0.5, startingOnHand 300.
//
// Round 1 with demand pinned to 100, for any submitted S:
//   arrival 0; sold 100; onHandEnd 200; IP 200; q = max(0, S - 200)
//   profit = 4000 - 10q - 200(holding) - 50*ceil(q/100)
//   co2    = 100(storage: 200*0.5) + 100*ceil(q/100)
async function setupDeterministicGame(app, { demand = 100, handsPerTur = 1 } = {}) {
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

function rows(res) {
  return res.body.leaderboard.map((r) => [r.rank, r.front, r.nickname, r.cumulativeProfit]);
}

test("ranks players by Pareto front, then profit within a front", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, alice } = await setupDeterministicGame(app);
  const bob = await join(app, gameId, "Bob");
  const carol = await join(app, gameId, "Carol");

  await request(app).post("/start-round").send({ gameId, adminToken });
  // Alice S=200 -> q=0:   profit 3800, co2 100  (dominates everyone)
  // Bob   S=300 -> q=100: profit 2750, co2 200
  // Carol S=450 -> q=250: profit 1150, co2 400
  await request(app).post("/submit-order").send({ gameId, playerId: alice, orderUpTo: 200 });
  await request(app).post("/submit-order").send({ gameId, playerId: bob, orderUpTo: 300 });
  await request(app).post("/submit-order").send({ gameId, playerId: carol, orderUpTo: 450 });
  await request(app).post("/end-round").send({ gameId, adminToken });

  const res = await request(app).get("/leaderboard").query({ gameId });
  assert.deepEqual(rows(res), [
    [1, 1, "Alice", 3800],
    [2, 2, "Bob", 2750],
    [3, 3, "Carol", 1150]
  ]);
});

test("leaderboard rows carry CO2, lost sales and truck-fill KPIs", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, alice } = await setupDeterministicGame(app);

  await request(app).post("/start-round").send({ gameId, adminToken });
  // S=350 -> q=150 -> 2 trucks at 75% fill; co2 = 100 storage + 200 transport.
  await request(app).post("/submit-order").send({ gameId, playerId: alice, orderUpTo: 350 });
  await request(app).post("/end-round").send({ gameId, adminToken });

  const res = await request(app).get("/leaderboard").query({ gameId });
  const row = res.body.leaderboard[0];
  assert.equal(row.cumCo2, 300);
  assert.equal(row.cumLost, 0);
  assert.equal(row.cumTrucks, 2);
  assert.equal(row.truckFillPct, 75);
  assert.equal(row.leftover, 200 + 150); // on hand + in transit, sunk at game end
});

test("identical strategies share front 1 in stable (join) order with sequential ranks", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, alice } = await setupDeterministicGame(app);
  const bob = await join(app, gameId, "Bob");

  await request(app).post("/start-round").send({ gameId, adminToken });
  // Both S=250 -> q=50 -> profit 3250, co2 200.
  await request(app).post("/submit-order").send({ gameId, playerId: alice, orderUpTo: 250 });
  await request(app).post("/submit-order").send({ gameId, playerId: bob, orderUpTo: 250 });
  await request(app).post("/end-round").send({ gameId, adminToken });

  const res = await request(app).get("/leaderboard").query({ gameId });
  assert.deepEqual(rows(res), [
    [1, 1, "Alice", 3250],
    [2, 1, "Bob", 3250]
  ]);
});

test("a player who never submits is scored with the hold-steady fallback, not zero", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, alice } = await setupDeterministicGame(app);
  await join(app, gameId, "Idle");

  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId: alice, orderUpTo: 200 });
  await request(app).post("/end-round").send({ gameId, adminToken });

  const res = await request(app).get("/leaderboard").query({ gameId });
  // Idle never submitted -> S falls back to startingOnHand (300) -> q=100:
  // profit 2750, co2 200. Alice (3800, 100) dominates -> Idle lands on front 2.
  assert.deepEqual(rows(res), [
    [1, 1, "Alice", 3800],
    [2, 2, "Idle", 2750]
  ]);
});

test("a non-submitter receives a visible round result using the fallback level", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  // Two hands so ending hand 1 does not complete the tur (which would reset history).
  const { gameId, adminToken, alice } = await setupDeterministicGame(app, { handsPerTur: 2 });
  const idle = await join(app, gameId, "Idle");

  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId: alice, orderUpTo: 200 });
  // Idle never submits, yet the round outcome should still be visible to them.
  await request(app).post("/end-round").send({ gameId, adminToken });

  const state = await request(app).get("/game-state").query({ gameId, playerId: idle });
  assert.equal(state.status, 200);
  assert.equal(state.body.player.history.length, 1);

  const result = state.body.player.lastRoundResult;
  assert.equal(result.orderUpTo, 300);
  assert.equal(result.orderQty, 100);
  assert.equal(result.realizedDemand, 100);
  assert.equal(result.profit, 2750);
  assert.equal(result.co2, 200);
});

test("extreme over-ordering produces a negative cumulative profit", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, alice } = await setupDeterministicGame(app);

  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId: alice, orderUpTo: 1000 });
  await request(app).post("/end-round").send({ gameId, adminToken });

  const res = await request(app).get("/leaderboard").query({ gameId });
  // q=800 -> 8 trucks: 4000 - 8000 - 200 - 400 = -4600
  assert.equal(res.body.leaderboard[0].cumulativeProfit, -4600);
});

test("profit, CO2 and inventory carry over across multiple hands", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, alice } = await setupDeterministicGame(app, { handsPerTur: 2 });

  // Hand 1: S=300 -> q=100 -> profit 2750, co2 200. Pipeline [0, 100].
  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId: alice, orderUpTo: 300 });
  await request(app).post("/end-round").send({ gameId, adminToken });

  const midState = await request(app).get("/game-state").query({ gameId, playerId: alice });
  assert.equal(midState.body.player.inventory.onHand, 200);
  assert.equal(midState.body.player.inventory.inTransit, 100);

  // Hand 2: arrival still 0 (L=2). sold 100 -> onHandEnd 100; IP 200 -> q=100:
  // profit = 4000 - 1000 - 100 - 50 = 2850; co2 = 50 storage + 100 transport = 150.
  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId: alice, orderUpTo: 300 });
  await request(app).post("/end-round").send({ gameId, adminToken });

  const res = await request(app).get("/leaderboard").query({ gameId });
  assert.equal(res.body.leaderboard[0].cumulativeProfit, 5600); // 2750 + 2850
  assert.equal(res.body.leaderboard[0].cumCo2, 350); // 200 + 150
});
