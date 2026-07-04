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

// ── /set-prices ───────────────────────────────────────────────────────────────
test("set-prices updates prices for an admin", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken } = await createGame(app);

  const res = await request(app)
    .post("/set-prices")
    .send({ gameId, adminToken, wholesaleCost: 12, retailPrice: 50, salvagePrice: 3 });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.prices, { wholesaleCost: 12, retailPrice: 50, salvagePrice: 3 });
});

test("set-prices requires a valid admin token", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId } = await createGame(app);

  const res = await request(app)
    .post("/set-prices")
    .send({ gameId, adminToken: "wrong", wholesaleCost: 12, retailPrice: 50, salvagePrice: 3 });

  assert.equal(res.status, 403);
});

test("set-prices rejects an invalid gameId", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { adminToken } = await createGame(app);

  const res = await request(app)
    .post("/set-prices")
    .send({ gameId: randomUUID(), adminToken, wholesaleCost: 12, retailPrice: 50, salvagePrice: 3 });

  assert.equal(res.status, 400);
});

test("set-prices rejects salvage >= wholesale", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken } = await createGame(app);

  const res = await request(app)
    .post("/set-prices")
    .send({ gameId, adminToken, wholesaleCost: 10, retailPrice: 40, salvagePrice: 10 });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /salvage/i);
});

test("set-prices rejects wholesale >= retail", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken } = await createGame(app);

  const res = await request(app)
    .post("/set-prices")
    .send({ gameId, adminToken, wholesaleCost: 40, retailPrice: 40, salvagePrice: 5 });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /retail/i);
});

test("set-prices rejects non-positive wholesale/retail", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken } = await createGame(app);

  const res = await request(app)
    .post("/set-prices")
    .send({ gameId, adminToken, wholesaleCost: 0, retailPrice: 40, salvagePrice: 0 });

  assert.equal(res.status, 400);
});

test("set-prices cannot be changed during an active round", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, adminToken } = await createGame(app);

  await request(app).post("/start-round").send({ gameId, adminToken });

  const res = await request(app)
    .post("/set-prices")
    .send({ gameId, adminToken, wholesaleCost: 12, retailPrice: 50, salvagePrice: 3 });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /active round/i);
});

// ── /submit-order rate limiting ──────────────────────────────────────────────
test("submit-order is rate limited after 10 attempts per window", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const { gameId, playerId } = await createGame(app);

  // No active round: each request is rejected on phase, but still counts toward the limiter.
  let last;
  for (let i = 0; i < 10; i++) {
    last = await request(app).post("/submit-order").send({ gameId, playerId, orderQuantity: 100 });
  }
  assert.notEqual(last.status, 429);

  const eleventh = await request(app)
    .post("/submit-order")
    .send({ gameId, playerId, orderQuantity: 100 });

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

  await request(app).post("/submit-order").send({ gameId, playerId, orderQuantity: 100 });

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
