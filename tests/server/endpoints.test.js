import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../../server/index.js";

const ADMIN_KEY = "admin123";

async function createGame(app, overrides = {}) {
  const res = await request(app)
    .post("/start-game")
    .send({ nickname: "admin", adminKey: ADMIN_KEY, ...overrides });
  return res.body;
}

// ── /set-config ───────────────────────────────────────────────────────────────
test("set-config updates economy fields for an admin", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken } = await createGame(app);

  const res = await request(app)
    .post("/set-config")
    .send({ gameId, adminToken, price: 50, unitCost: 12, truckCapacity: 150 });

  assert.equal(res.status, 200);
  assert.equal(res.body.config.price, 50);
  assert.equal(res.body.config.unitCost, 12);
  assert.equal(res.body.config.truckCapacity, 150);
  // Untouched fields keep their defaults.
  assert.equal(res.body.config.holdingCost, 1);
});

test("set-config requires a valid admin token", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId } = await createGame(app);

  const res = await request(app)
    .post("/set-config")
    .send({ gameId, adminToken: "wrong", price: 50 });

  assert.equal(res.status, 403);
});

test("set-config rejects an invalid gameId", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { adminToken } = await createGame(app);

  const res = await request(app)
    .post("/set-config")
    .send({ gameId: randomUUID(), adminToken, price: 50 });

  assert.equal(res.status, 400);
});

test("set-config rejects negative values and non-integer integer fields", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken } = await createGame(app);

  const negative = await request(app)
    .post("/set-config")
    .send({ gameId, adminToken, holdingCost: -1 });
  assert.equal(negative.status, 400);

  const fractionalTrucks = await request(app)
    .post("/set-config")
    .send({ gameId, adminToken, truckCapacity: 99.5 });
  assert.equal(fractionalTrucks.status, 400);

  const zeroCapacity = await request(app)
    .post("/set-config")
    .send({ gameId, adminToken, truckCapacity: 0 });
  assert.equal(zeroCapacity.status, 400);
});

test("set-config rejects an empty update", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken } = await createGame(app);

  const res = await request(app).post("/set-config").send({ gameId, adminToken });
  assert.equal(res.status, 400);
});

test("set-config cannot be changed during an active round", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken } = await createGame(app);

  await request(app).post("/start-round").send({ gameId, adminToken });

  const res = await request(app)
    .post("/set-config")
    .send({ gameId, adminToken, price: 50 });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /active round/i);
});

test("leadTime and seed are frozen once a round has ended", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken } = await createGame(app, { handsPerTur: 3 });

  // Pre-game: structural fields are still changeable and reset inventories.
  const preGame = await request(app)
    .post("/set-config")
    .send({ gameId, adminToken, leadTime: 3, seed: 7 });
  assert.equal(preGame.status, 200);
  assert.equal(preGame.body.config.leadTime, 3);

  // Round 1 is the priming round; ending it counts as the game having started.
  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/end-round").send({ gameId, adminToken });

  for (const frozen of [{ leadTime: 1 }, { seed: 9 }]) {
    const res = await request(app)
      .post("/set-config")
      .send({ gameId, adminToken, ...frozen });
    assert.equal(res.status, 400, JSON.stringify(frozen));
    assert.match(res.body.error, /before the first round/i);
  }

  // Non-structural fields stay adjustable between rounds (mid-game shock).
  const midGame = await request(app)
    .post("/set-config")
    .send({ gameId, adminToken, co2PerTruck: 200 });
  assert.equal(midGame.status, 200);
  assert.equal(midGame.body.config.co2PerTruck, 200);
});

test("pre-game lead-time change reshapes every player's empty pipeline", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, playerId } = await createGame(app);

  await request(app).post("/set-config").send({ gameId, adminToken, leadTime: 4 });

  const gs = await request(app).get("/game-state").query({ gameId, playerId });
  assert.equal(gs.body.player.inventory.onHand, 0); // warehouse always starts empty
  assert.equal(gs.body.player.inventory.pipeline.length, 4);
});

// ── /submit-order rate limiting ──────────────────────────────────────────────
test("submit-order is rate limited after 10 attempts per window", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, playerId } = await createGame(app);

  // No active round: each request is rejected on phase, but still counts toward the limiter.
  let last;
  for (let i = 0; i < 10; i++) {
    last = await request(app).post("/submit-order").send({ gameId, playerId, orderQty: 100 });
  }
  assert.notEqual(last.status, 429);

  const eleventh = await request(app)
    .post("/submit-order")
    .send({ gameId, playerId, orderQty: 100 });

  assert.equal(eleventh.status, 429);
  assert.match(eleventh.body.error, /too many requests/i);
});

// ── /game-state field visibility ─────────────────────────────────────────────
test("game-state exposes submittedThisRound and finished transitions", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, playerId } = await createGame(app, { handsPerTur: 1 });

  await request(app).post("/start-round").send({ gameId, adminToken });

  let gs = await request(app).get("/game-state").query({ gameId, playerId });
  assert.equal(gs.body.player.submittedThisRound, false);
  assert.equal(gs.body.finished, false);

  await request(app).post("/submit-order").send({ gameId, playerId, orderQty: 100 });

  gs = await request(app).get("/game-state").query({ gameId, playerId });
  assert.equal(gs.body.player.submittedThisRound, true);

  await request(app).post("/end-round").send({ gameId, adminToken });

  gs = await request(app).get("/game-state").query({ gameId, playerId });
  assert.equal(gs.body.finished, true);
  assert.equal(gs.body.currentRound, null);
});

test("game-state hides roundHistory from non-admins but shows it to admins", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, playerId } = await createGame(app, { handsPerTur: 2 });

  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/end-round").send({ gameId, adminToken });

  const playerView = await request(app).get("/game-state").query({ gameId, playerId });
  assert.equal(playerView.body.roundHistory, undefined);

  const adminView = await request(app).get("/game-state").query({ gameId, playerId, adminToken });
  assert.ok(Array.isArray(adminView.body.roundHistory));
  assert.equal(adminView.body.roundHistory.length, 1);
});
