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
  // Pipeline carries one reserve slot beyond leadTime for shipping-delay events.
  assert.equal(gs.body.player.inventory.pipeline.length, 5);
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

// ── Shipping-delay events (delayProbability) ────────────────────────────────
test("delayProbability=1 forces a shared delay hitting every player identically", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, playerId: p1 } = await createGame(app, {
    handsPerTur: 3,
    config: { delayProbability: 1, leadTime: 2 }
  });
  const p2 = (await request(app).post("/start-game").send({ nickname: "p2", gameId })).body
    .playerId;

  // Round 1 (priming): never rolled for delay, no matter the probability.
  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId: p1, orderQty: 100 });
  await request(app).post("/submit-order").send({ gameId, playerId: p2, orderQty: 100 });
  let end = await request(app).post("/end-round").send({ gameId, adminToken });
  assert.equal(end.body.delayed, false);

  // Round 2: guaranteed delay. Both players' shipments freeze identically.
  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId: p1, orderQty: 0 });
  await request(app).post("/submit-order").send({ gameId, playerId: p2, orderQty: 0 });
  end = await request(app).post("/end-round").send({ gameId, adminToken });
  assert.equal(end.body.delayed, true);

  const gs1 = await request(app).get("/game-state").query({ gameId, playerId: p1 });
  const gs2 = await request(app).get("/game-state").query({ gameId, playerId: p2 });
  const r2p1 = gs1.body.player.history[1];
  const r2p2 = gs2.body.player.history[1];
  assert.equal(r2p1.delayed, true);
  assert.equal(r2p2.delayed, true);
  // Both had 100 en route from their round-1 opening order; the delay held it
  // back for both alike, so neither saw anything arrive this round.
  assert.equal(r2p1.arrival, 0);
  assert.equal(r2p2.arrival, 0);
});

test("delayProbability=0 (default) never triggers a delay", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, playerId } = await createGame(app, { handsPerTur: 3 });

  for (let i = 0; i < 3; i++) {
    await request(app).post("/start-round").send({ gameId, adminToken });
    const end = await request(app).post("/end-round").send({ gameId, adminToken });
    assert.equal(end.body.delayed, false);
  }

  const gs = await request(app).get("/game-state").query({ gameId, playerId });
  assert.ok(gs.body.player.history.every((round) => round.delayed === false));
});

// ── Delivery mode (consolidated vs express) ─────────────────────────────────
test("set-config accepts express van economy fields", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken } = await createGame(app);

  const res = await request(app)
    .post("/set-config")
    .send({ gameId, adminToken, expressCapacity: 30, expressFixedCost: 150, expressCo2: 300 });

  assert.equal(res.status, 200);
  assert.equal(res.body.config.expressCapacity, 30);
  assert.equal(res.body.config.expressFixedCost, 150);
  assert.equal(res.body.config.expressCo2, 300);
});

test("submit-order rejects an unknown delivery mode", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, playerId } = await createGame(app);
  await request(app).post("/start-round").send({ gameId, adminToken });

  const res = await request(app)
    .post("/submit-order")
    .send({ gameId, playerId, orderQty: 100, mode: "teleport" });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /mode/i);
});

test("an express order arrives the round after it is placed", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, playerId } = await createGame(app, {
    handsPerTur: 4,
    config: { leadTime: 3 }
  });

  // Priming round: no express; place a consolidated opening order.
  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId, orderQty: 0 });
  await request(app).post("/end-round").send({ gameId, adminToken });

  // Round 2: express order of 40 (one van). Despite leadTime 3, it arrives round 3.
  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId, orderQty: 40, mode: "express" });
  await request(app).post("/end-round").send({ gameId, adminToken });

  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId, orderQty: 0 });
  const end = await request(app).post("/end-round").send({ gameId, adminToken });

  const gs = await request(app).get("/game-state").query({ gameId, playerId });
  const round3 = gs.body.player.history[2];
  assert.equal(round3.arrival, 40); // express landed one round after placement
  assert.equal(gs.body.player.history[1].mode, "express");
});

// ── Admin announcements ─────────────────────────────────────────────────────
test("announce broadcasts a message and clears on empty", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken, playerId } = await createGame(app);

  const sent = await request(app)
    .post("/announce")
    .send({ gameId, adminToken, message: "Bakery rush incoming" });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.announcement.message, "Bakery rush incoming");

  const gs = await request(app).get("/game-state").query({ gameId, playerId });
  assert.equal(gs.body.announcement.message, "Bakery rush incoming");

  const cleared = await request(app).post("/announce").send({ gameId, adminToken, message: "" });
  assert.equal(cleared.body.announcement, null);
});

test("announce requires a valid admin token", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId } = await createGame(app);

  const res = await request(app).post("/announce").send({ gameId, adminToken: "nope", message: "hi" });
  assert.equal(res.status, 403);
});
