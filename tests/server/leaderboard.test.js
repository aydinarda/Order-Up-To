import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../../server/index.js";

const ADMIN_KEY = "admin123";

// Deterministic demand: a normal distribution with stdDev=0 always equals the mean,
// so order -> profit -> leaderboard becomes fully deterministic.
async function setupDeterministicGame(app, { demand = 100 } = {}) {
  const admin = await request(app)
    .post("/start-game")
    .send({ nickname: "Alice", adminKey: ADMIN_KEY, handsPerTur: 1 });
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
  return res.body.leaderboard.map((r) => [r.rank, r.nickname, r.cumulativeProfit]);
}

// Default prices are { wholesale 10, retail 40, salvage 5 }; demand is pinned to 100.
test("ranks players by cumulative profit across under/exact/over classes", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, alice } = await setupDeterministicGame(app);
  const bob = await join(app, gameId, "Bob");
  const carol = await join(app, gameId, "Carol");

  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId: alice, orderQuantity: 100 }); // exact -> 3000
  await request(app).post("/submit-order").send({ gameId, playerId: bob, orderQuantity: 120 });   // over  -> 2900
  await request(app).post("/submit-order").send({ gameId, playerId: carol, orderQuantity: 80 });  // under -> 2400
  await request(app).post("/end-round").send({ gameId, adminToken });

  const res = await request(app).get("/leaderboard").query({ gameId });
  assert.deepEqual(rows(res), [
    [1, "Alice", 3000],
    [2, "Bob", 2900],
    [3, "Carol", 2400]
  ]);
});

test("keeps tied players in stable (join) order with sequential ranks", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, alice } = await setupDeterministicGame(app);
  const bob = await join(app, gameId, "Bob");

  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId: alice, orderQuantity: 100 });
  await request(app).post("/submit-order").send({ gameId, playerId: bob, orderQuantity: 100 });
  await request(app).post("/end-round").send({ gameId, adminToken });

  const res = await request(app).get("/leaderboard").query({ gameId });
  assert.deepEqual(rows(res), [
    [1, "Alice", 3000],
    [2, "Bob", 3000]
  ]);
});

test("a player who never submits is scored with the fallback order, not zero", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, alice } = await setupDeterministicGame(app, { demand: 80 });
  await join(app, gameId, "Idle");

  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId: alice, orderQuantity: 80 }); // optimal -> 2400
  await request(app).post("/end-round").send({ gameId, adminToken });

  const res = await request(app).get("/leaderboard").query({ gameId });
  // Idle never submitted, so it falls back to an order of 100 (not 0). With demand 80 that
  // over-orders: 80 sold * 40 + 20 leftover * 5 - 100 * 10 = 3200 + 100 - 1000 = 2300, so
  // Idle still ranks last but no longer scores zero.
  assert.deepEqual(rows(res), [
    [1, "Alice", 2400],
    [2, "Idle", 2300]
  ]);
});

test("a non-submitter receives a visible round result using the fallback order", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  // Two hands so ending hand 1 does not complete the tur (which would reset history).
  const admin = await request(app)
    .post("/start-game")
    .send({ nickname: "Alice", adminKey: ADMIN_KEY, handsPerTur: 2 });
  const { gameId, adminToken, playerId: alice } = admin.body;
  await request(app).post("/set-distribution").send({ gameId, adminToken, type: "normal", mean: 100, stdDev: 0 });
  const idle = await join(app, gameId, "Idle");

  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId: alice, orderQuantity: 100 });
  // Idle never submits, yet the round outcome should still be visible to them.
  await request(app).post("/end-round").send({ gameId, adminToken });

  const state = await request(app).get("/game-state").query({ gameId, playerId: idle });
  assert.equal(state.status, 200);
  assert.equal(state.body.player.history.length, 1);

  // First round with no prior order -> fallback of 100. With demand pinned to 100 that is
  // an exact match: 100 sold * 40 - 100 * 10 = 3000 (no longer the old zero-order result).
  const result = state.body.player.lastRoundResult;
  assert.equal(result.orderQuantity, 100);
  assert.equal(result.realizedDemand, 100);
  assert.equal(result.profit, 3000);
});

test("extreme over-ordering produces a negative cumulative profit", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, alice } = await setupDeterministicGame(app);

  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId: alice, orderQuantity: 1000 });
  await request(app).post("/end-round").send({ gameId, adminToken });

  const res = await request(app).get("/leaderboard").query({ gameId });
  // 100 sold * 40 + 900 leftover * 5 - 1000 * 10 = 4000 + 4500 - 10000 = -1500
  assert.equal(res.body.leaderboard[0].cumulativeProfit, -1500);
});

test("cumulative profit accumulates across multiple hands", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  // Two hands in one turn, demand pinned to 100 each.
  const admin = await request(app)
    .post("/start-game")
    .send({ nickname: "Alice", adminKey: ADMIN_KEY, handsPerTur: 2 });
  const { gameId, adminToken, playerId: alice } = admin.body;
  await request(app).post("/set-distribution").send({ gameId, adminToken, type: "normal", mean: 100, stdDev: 0 });

  // Hand 1: exact -> 3000
  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId: alice, orderQuantity: 100 });
  await request(app).post("/end-round").send({ gameId, adminToken });

  // Hand 2: under -> 2400
  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId: alice, orderQuantity: 80 });
  await request(app).post("/end-round").send({ gameId, adminToken });

  const res = await request(app).get("/leaderboard").query({ gameId });
  assert.equal(res.body.leaderboard[0].cumulativeProfit, 5400); // 3000 + 2400
});
