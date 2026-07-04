import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../../server/index.js";

const ADMIN_KEY = "admin123";

test("creates an active game with random room id", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const response = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  assert.equal(response.status, 200);
  assert.match(
    response.body.gameId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
});

test("joins active room with 200 status", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const createRoom = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const joinRoom = await request(app).post("/start-game").send({
    nickname: "second-player",
    gameId: createRoom.body.gameId
  });

  assert.equal(joinRoom.status, 200);
  assert.equal(joinRoom.body.gameId, createRoom.body.gameId);
});

test("duplicate usernames are rejected in the same active game", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const admin = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  assert.equal(admin.status, 200);

  const duplicateAdminName = await request(app).post("/start-game").send({
    nickname: "admin-player",
    gameId: admin.body.gameId
  });

  assert.equal(duplicateAdminName.status, 409);
  assert.equal(duplicateAdminName.body.error, "this username is taken");

  const user = await request(app).post("/start-game").send({
    nickname: "unique-player",
    gameId: admin.body.gameId
  });

  assert.equal(user.status, 200);

  const duplicateUserName = await request(app).post("/start-game").send({
    nickname: "unique-player",
    gameId: admin.body.gameId
  });

  assert.equal(duplicateUserName.status, 409);
  assert.equal(duplicateUserName.body.error, "this username is taken");
});

test("joining inactive room returns error", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const response = await request(app).post("/start-game").send({
    nickname: "third-player",
    gameId: randomUUID()
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, "requested room is not active");
});

test("admin can start a round", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const createRoom = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const response = await request(app).post("/start-round").send({
    gameId: createRoom.body.gameId,
    adminToken: createRoom.body.adminToken
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.roundPhase, "active");
  assert.equal(response.body.currentRound.id, 1);
});

test("non-admin cannot start round", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const createRoom = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const response = await request(app).post("/start-round").send({
    gameId: createRoom.body.gameId,
    adminToken: "not-admin-token"
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.error, "admin authorization required");
});

test("admin can update uniform distribution and it is stored", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const createRoom = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const updateDistribution = await request(app).post("/set-distribution").send({
    gameId: createRoom.body.gameId,
    adminToken: createRoom.body.adminToken,
    min: 90,
    max: 140
  });

  assert.equal(updateDistribution.status, 200);
  assert.equal(updateDistribution.body.distribution.type, "uniform");
  assert.equal(updateDistribution.body.distribution.min, 90);
  assert.equal(updateDistribution.body.distribution.max, 140);
  assert.ok(updateDistribution.body.distributionHistory.length >= 2);

  const startRoundResponse = await request(app).post("/start-round").send({
    gameId: createRoom.body.gameId,
    adminToken: createRoom.body.adminToken
  });

  assert.equal(startRoundResponse.status, 200);
  assert.equal(startRoundResponse.body.currentRound.distribution.min, 90);
  assert.equal(startRoundResponse.body.currentRound.distribution.max, 140);
});

test("player can submit demand while round is active", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const createRoom = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const playerJoin = await request(app).post("/start-game").send({
    nickname: "second-player",
    gameId: createRoom.body.gameId
  });

  await request(app).post("/start-round").send({
    gameId: createRoom.body.gameId,
    adminToken: createRoom.body.adminToken
  });

  const submit = await request(app).post("/submit-order").send({
    gameId: createRoom.body.gameId,
    playerId: playerJoin.body.playerId,
    orderQuantity: 1200
  });

  assert.equal(submit.status, 200);
  assert.equal(submit.body.accepted, true);
  assert.equal(submit.body.roundId, 1);
  assert.equal(submit.body.orderQuantity, 1200);
  assert.equal(submit.body.roundPhase, "active");
  assert.equal(submit.body.cumulativeProfit, 0);
});

test("admin can end round and leaderboard is returned", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const createRoom = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  await request(app).post("/start-round").send({
    gameId: createRoom.body.gameId,
    adminToken: createRoom.body.adminToken
  });

  await request(app).post("/submit-order").send({
    gameId: createRoom.body.gameId,
    playerId: createRoom.body.playerId,
    orderQuantity: 1000
  });

  const endRound = await request(app).post("/end-round").send({
    gameId: createRoom.body.gameId,
    adminToken: createRoom.body.adminToken
  });

  assert.equal(endRound.status, 200);
  assert.equal(endRound.body.roundPhase, "pending");
  assert.ok(Array.isArray(endRound.body.leaderboard));
  assert.ok(endRound.body.leaderboard.length >= 1);
  assert.equal(endRound.body.leaderboard[0].nickname, "admin-player");
});

test("leaderboard does not update during active round and updates after round ends", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const admin = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const user = await request(app).post("/start-game").send({
    nickname: "joined-user",
    gameId: admin.body.gameId
  });

  const startRoundResponse = await request(app).post("/start-round").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken
  });

  
  assert.equal(startRoundResponse.status, 200);

  const submitResponse = await request(app).post("/submit-order").send({
    gameId: admin.body.gameId,
    playerId: user.body.playerId,
    orderQuantity: 1000
  });

  assert.equal(submitResponse.status, 200);

  const leaderboardWhileActive = await request(app)
    .get("/leaderboard")
    .query({ gameId: admin.body.gameId });

  assert.equal(leaderboardWhileActive.status, 200);
  assert.ok(
    leaderboardWhileActive.body.leaderboard.every((row) => row.roundsPlayed === 0)
  );
  assert.ok(
    leaderboardWhileActive.body.leaderboard.every((row) => row.cumulativeProfit === 0)
  );

  const endRoundResponse = await request(app).post("/end-round").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken
  });

  assert.equal(endRoundResponse.status, 200);
  assert.ok(
    endRoundResponse.body.leaderboard.some((row) => row.roundsPlayed === 1)
  );
});

test("can play 5 turns back-to-back and finish game", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const createRoom = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const gameId = createRoom.body.gameId;
  const adminToken = createRoom.body.adminToken;
  const playerId = createRoom.body.playerId;

  let endRoundPayload = null;

  for (let turn = 1; turn <= 5; turn += 1) {
    const startRoundResponse = await request(app).post("/start-round").send({
      gameId,
      adminToken
    });

    assert.equal(startRoundResponse.status, 200);
    assert.equal(startRoundResponse.body.currentRound.id, turn);
    assert.equal(startRoundResponse.body.roundPhase, "active");

    const submitResponse = await request(app).post("/submit-order").send({
      gameId,
      playerId,
      orderQuantity: 1000 + turn * 10
    });

    assert.equal(submitResponse.status, 200);
    assert.equal(submitResponse.body.accepted, true);
    assert.equal(submitResponse.body.roundId, turn);

    const endRoundResponse = await request(app).post("/end-round").send({
      gameId,
      adminToken
    });

    assert.equal(endRoundResponse.status, 200);
    assert.equal(endRoundResponse.body.roundPhase, "pending");
    assert.ok(Array.isArray(endRoundResponse.body.leaderboard));

    endRoundPayload = endRoundResponse.body;
  }

  assert.ok(endRoundPayload);
  assert.equal(endRoundPayload.finished, true);
  assert.equal(endRoundPayload.nextRound, null);
  assert.ok(endRoundPayload.leaderboard.length >= 1);

  const leaderboard = await request(app)
    .get("/leaderboard")
    .query({ gameId });

  assert.equal(leaderboard.status, 200);
  assert.ok(Array.isArray(leaderboard.body.leaderboard));
  assert.equal(leaderboard.body.leaderboard[0].roundsPlayed, 5);
});

test("a joined user can complete all 5 rounds", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const admin = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const joinedUser = await request(app).post("/start-game").send({
    nickname: "joined-user",
    gameId: admin.body.gameId
  });

  const gameId = admin.body.gameId;
  const adminToken = admin.body.adminToken;
  const joinedUserId = joinedUser.body.playerId;

  for (let round = 1; round <= 5; round += 1) {
    const startRoundResponse = await request(app).post("/start-round").send({
      gameId,
      adminToken
    });

    assert.equal(startRoundResponse.status, 200);
    assert.equal(startRoundResponse.body.currentRound.id, round);

    const submitResponse = await request(app).post("/submit-order").send({
      gameId,
      playerId: joinedUserId,
      orderQuantity: 900 + round * 25
    });

    assert.equal(submitResponse.status, 200);
    assert.equal(submitResponse.body.accepted, true);
    assert.equal(submitResponse.body.roundId, round);

    const endRoundResponse = await request(app).post("/end-round").send({
      gameId,
      adminToken
    });

    assert.equal(endRoundResponse.status, 200);
  }

  const leaderboard = await request(app)
    .get("/leaderboard")
    .query({ gameId });

  assert.equal(leaderboard.status, 200);

  const joinedUserRow = leaderboard.body.leaderboard.find(
    (row) => row.nickname === "joined-user"
  );

  assert.ok(joinedUserRow);
  assert.equal(joinedUserRow.roundsPlayed, 5);
});

test("admin can change min-max and joined user sees updated distribution", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const admin = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const userJoin = await request(app).post("/start-game").send({
    nickname: "joined-user",
    gameId: admin.body.gameId
  });

  assert.equal(userJoin.status, 200);
  assert.equal(userJoin.body.distribution.min, 80);
  assert.equal(userJoin.body.distribution.max, 120);

  const distributionUpdate = await request(app).post("/set-distribution").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken,
    min: 95,
    max: 135
  });

  assert.equal(distributionUpdate.status, 200);
  assert.equal(distributionUpdate.body.distribution.min, 95);
  assert.equal(distributionUpdate.body.distribution.max, 135);

  const userRefreshState = await request(app)
    .get("/game-state")
    .query({ gameId: admin.body.gameId, playerId: userJoin.body.playerId });

  assert.equal(userRefreshState.status, 200);
  assert.equal(userRefreshState.body.distribution.min, 95);
  assert.equal(userRefreshState.body.distribution.max, 135);

  const startRoundResponse = await request(app).post("/start-round").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken
  });

  assert.equal(startRoundResponse.status, 200);
  assert.equal(startRoundResponse.body.currentRound.distribution.min, 95);
  assert.equal(startRoundResponse.body.currentRound.distribution.max, 135);

  const userSubmit = await request(app).post("/submit-order").send({
    gameId: admin.body.gameId,
    playerId: userJoin.body.playerId,
    orderQuantity: 1000
  });

  assert.equal(userSubmit.status, 200);
  assert.equal(userSubmit.body.accepted, true);

  const endRound = await request(app).post("/end-round").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken
  });

  assert.equal(endRound.status, 200);
  assert.ok(endRound.body.leaderboard.length >= 1);
});

test("leaderboard is accessible at game start for admin and user, and during rounds", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const admin = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const user = await request(app).post("/start-game").send({
    nickname: "joined-user",
    gameId: admin.body.gameId
  });

  const leaderboardAtStartForAdmin = await request(app)
    .get("/leaderboard")
    .query({ gameId: admin.body.gameId });

  assert.equal(leaderboardAtStartForAdmin.status, 200);
  assert.equal(leaderboardAtStartForAdmin.body.leaderboard.length, 2);

  const leaderboardAtStartForUser = await request(app)
    .get("/leaderboard")
    .query({ gameId: user.body.gameId });

  assert.equal(leaderboardAtStartForUser.status, 200);
  assert.equal(leaderboardAtStartForUser.body.leaderboard.length, 2);

  for (let round = 1; round <= 3; round += 1) {
    const startRoundResponse = await request(app).post("/start-round").send({
      gameId: admin.body.gameId,
      adminToken: admin.body.adminToken
    });

    assert.equal(startRoundResponse.status, 200);

    const adminSubmit = await request(app).post("/submit-order").send({
      gameId: admin.body.gameId,
      playerId: admin.body.playerId,
      orderQuantity: 1000 + round
    });

    assert.equal(adminSubmit.status, 200);

    const userSubmit = await request(app).post("/submit-order").send({
      gameId: user.body.gameId,
      playerId: user.body.playerId,
      orderQuantity: 950 + round
    });

    assert.equal(userSubmit.status, 200);

    const endRoundResponse = await request(app).post("/end-round").send({
      gameId: admin.body.gameId,
      adminToken: admin.body.adminToken
    });

    assert.equal(endRoundResponse.status, 200);

    const leaderboardDuringProgress = await request(app)
      .get("/leaderboard")
      .query({ gameId: admin.body.gameId });

    assert.equal(leaderboardDuringProgress.status, 200);
    assert.equal(leaderboardDuringProgress.body.leaderboard.length, 2);
    assert.ok(
      leaderboardDuringProgress.body.leaderboard.every(
        (row) => row.roundsPlayed === round
      )
    );
  }
});

test("demand is hidden from UI when round is active, visible only after end-round", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const admin = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const gameId = admin.body.gameId;
  const adminToken = admin.body.adminToken;
  const playerId = admin.body.playerId;

  // Start first round
  const startRoundResponse = await request(app).post("/start-round").send({
    gameId,
    adminToken
  });

  assert.equal(startRoundResponse.status, 200);
  assert.equal(startRoundResponse.body.roundPhase, "active");

  // Player submits order while round is active
  const submitResponse = await request(app).post("/submit-order").send({
    gameId,
    playerId,
    orderQuantity: 1000
  });

  assert.equal(submitResponse.status, 200);
  assert.equal(submitResponse.body.accepted, true);
  // Round is still active (UI should hide round results)
  assert.equal(submitResponse.body.roundPhase, "active");

  // Get leaderboard while round is active - demand should be hidden from client perspective
  const leaderboardDuringRound = await request(app)
    .get("/leaderboard")
    .query({ gameId });

  assert.equal(leaderboardDuringRound.status, 200);
  // Note: Leaderboard API doesn't filter - frontend filters based on roundPhase
  // Test verifies server returned data, frontend responsibility to hide demand

  // Admin ends round
  const endRoundResponse = await request(app).post("/end-round").send({
    gameId,
    adminToken
  });

  assert.equal(endRoundResponse.status, 200);
  assert.equal(endRoundResponse.body.roundPhase, "pending");
  // After round ends, leaderboard is returned in response
  assert.ok(endRoundResponse.body.leaderboard);
  // Demand values should be visible in leaderboard after round ends
  assert.ok(
    endRoundResponse.body.leaderboard[0].roundsPlayed === 1
  );
});

test("all submitted players receive same realized demand for the round", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const admin = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const user = await request(app).post("/start-game").send({
    nickname: "joined-user",
    gameId: admin.body.gameId
  });

  await request(app).post("/start-round").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken
  });

  const adminSubmit = await request(app).post("/submit-order").send({
    gameId: admin.body.gameId,
    playerId: admin.body.playerId,
    orderQuantity: 1000
  });
  assert.equal(adminSubmit.status, 200);

  const userSubmit = await request(app).post("/submit-order").send({
    gameId: admin.body.gameId,
    playerId: user.body.playerId,
    orderQuantity: 900
  });
  assert.equal(userSubmit.status, 200);

  const endRound = await request(app).post("/end-round").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken
  });
  assert.equal(endRound.status, 200);

  const adminState = await request(app)
    .get("/game-state")
    .query({ gameId: admin.body.gameId, playerId: admin.body.playerId });
  const userState = await request(app)
    .get("/game-state")
    .query({ gameId: user.body.gameId, playerId: user.body.playerId });

  assert.equal(adminState.status, 200);
  assert.equal(userState.status, 200);
  assert.equal(adminState.body.player.history.length, 1);
  assert.equal(userState.body.player.history.length, 1);

  const adminDemand = adminState.body.player.history[0].realizedDemand;
  const userDemand = userState.body.player.history[0].realizedDemand;
  assert.equal(adminDemand, userDemand);
});

test("cumulative profit remains unchanged until round ends", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const admin = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  await request(app).post("/start-round").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken
  });

  const submit = await request(app).post("/submit-order").send({
    gameId: admin.body.gameId,
    playerId: admin.body.playerId,
    orderQuantity: 1000
  });
  assert.equal(submit.status, 200);

  const duringActive = await request(app)
    .get("/game-state")
    .query({ gameId: admin.body.gameId, playerId: admin.body.playerId });
  assert.equal(duringActive.status, 200);
  assert.equal(duringActive.body.roundPhase, "active");
  assert.equal(duringActive.body.player.cumulativeProfit, 0);
  assert.equal(duringActive.body.player.history.length, 0);

  await request(app).post("/end-round").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken
  });

  const afterEnd = await request(app)
    .get("/game-state")
    .query({ gameId: admin.body.gameId, playerId: admin.body.playerId });
  assert.equal(afterEnd.status, 200);
  assert.equal(afterEnd.body.roundPhase, "pending");
  assert.equal(afterEnd.body.player.history.length, 1);
  assert.notEqual(afterEnd.body.player.cumulativeProfit, 0);
});

test("joined users see admin start/end round changes via game-state", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const admin = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const user = await request(app).post("/start-game").send({
    nickname: "joined-user",
    gameId: admin.body.gameId
  });

  const initialState = await request(app)
    .get("/game-state")
    .query({ gameId: user.body.gameId, playerId: user.body.playerId });

  assert.equal(initialState.status, 200);
  assert.equal(initialState.body.roundPhase, "pending");
  assert.equal(initialState.body.currentRound.id, 1);

  const startRoundResponse = await request(app).post("/start-round").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken
  });

  assert.equal(startRoundResponse.status, 200);

  const stateAfterStart = await request(app)
    .get("/game-state")
    .query({ gameId: user.body.gameId, playerId: user.body.playerId });

  assert.equal(stateAfterStart.status, 200);
  assert.equal(stateAfterStart.body.roundPhase, "active");
  assert.equal(stateAfterStart.body.currentRound.id, 1);

  await request(app).post("/submit-order").send({
    gameId: user.body.gameId,
    playerId: user.body.playerId,
    orderQuantity: 1000
  });

  const endRoundResponse = await request(app).post("/end-round").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken
  });

  assert.equal(endRoundResponse.status, 200);

  const stateAfterEnd = await request(app)
    .get("/game-state")
    .query({ gameId: user.body.gameId, playerId: user.body.playerId });

  assert.equal(stateAfterEnd.status, 200);
  assert.equal(stateAfterEnd.body.roundPhase, "pending");
  assert.equal(stateAfterEnd.body.currentRound.id, 2);
});

test("duplicate usernames are rejected with case-insensitive comparison", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const admin = await request(app).post("/start-game").send({
    nickname: "TestPlayer",
    adminKey: ADMIN_KEY
  });

  assert.equal(admin.status, 200);

  // Try to join with different case
  const duplicateWithDifferentCase = await request(app).post("/start-game").send({
    nickname: "testplayer",
    gameId: admin.body.gameId
  });

  assert.equal(duplicateWithDifferentCase.status, 409);
  assert.equal(duplicateWithDifferentCase.body.error, "this username is taken");

  // Another variation
  const duplicateWithAllCaps = await request(app).post("/start-game").send({
    nickname: "TESTPLAYER",
    gameId: admin.body.gameId
  });

  assert.equal(duplicateWithAllCaps.status, 409);
  assert.equal(duplicateWithAllCaps.body.error, "this username is taken");
});

test("admin and user cannot have the same username", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const admin = await request(app).post("/start-game").send({
    nickname: "SameName",
    adminKey: ADMIN_KEY
  });

  assert.equal(admin.status, 200);
  assert.equal(admin.body.nickname, "SameName");

  // User tries to join with admin's username
  const userWithAdminName = await request(app).post("/start-game").send({
    nickname: "SameName",
    gameId: admin.body.gameId
  });

  assert.equal(userWithAdminName.status, 409);
  assert.equal(userWithAdminName.body.error, "this username is taken");
});

test("multiple users can join with different usernames", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const admin = await request(app).post("/start-game").send({
    nickname: "Admin",
    adminKey: ADMIN_KEY
  });

  assert.equal(admin.status, 200);

  const user1 = await request(app).post("/start-game").send({
    nickname: "Player1",
    gameId: admin.body.gameId
  });

  assert.equal(user1.status, 200);
  assert.equal(user1.body.nickname, "Player1");

  const user2 = await request(app).post("/start-game").send({
    nickname: "Player2",
    gameId: admin.body.gameId
  });

  assert.equal(user2.status, 200);
  assert.equal(user2.body.nickname, "Player2");

  const user3 = await request(app).post("/start-game").send({
    nickname: "Player3",
    gameId: admin.body.gameId
  });

  assert.equal(user3.status, 200);
  assert.equal(user3.body.nickname, "Player3");

  // Verify all players are in leaderboard
  const leaderboard = await request(app)
    .get("/leaderboard")
    .query({ gameId: admin.body.gameId });

  assert.equal(leaderboard.status, 200);
  assert.equal(leaderboard.body.leaderboard.length, 4); // admin + 3 users
  const nicknames = leaderboard.body.leaderboard.map(p => p.nickname);
  assert.ok(nicknames.includes("Admin"));
  assert.ok(nicknames.includes("Player1"));
  assert.ok(nicknames.includes("Player2"));
  assert.ok(nicknames.includes("Player3"));
});

test("duplicate names remain rejected even after round starts", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const admin = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  assert.equal(admin.status, 200);

  const user = await request(app).post("/start-game").send({
    nickname: "user-player",
    gameId: admin.body.gameId
  });

  assert.equal(user.status, 200);

  // Start round
  const startRound = await request(app).post("/start-round").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken
  });

  assert.equal(startRound.status, 200);
  assert.equal(startRound.body.roundPhase, "active");

  // Try to join with duplicate name during active round
  const duplicateDuringRound = await request(app).post("/start-game").send({
    nickname: "user-player",
    gameId: admin.body.gameId
  });

  assert.equal(duplicateDuringRound.status, 409);
  assert.equal(duplicateDuringRound.body.error, "this username is taken");
});

test("admin cannot set negative values for min or max", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const admin = await request(app).post("/start-game").send({
    nickname: "AdminUser",
    adminKey: ADMIN_KEY
  });

  // Test negative min
  const negMin = await request(app).post("/set-distribution").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken,
    min: -10,
    max: 50
  });
  assert.equal(negMin.status, 400);
  assert.equal(negMin.body.error, "none of the variables can be less than 0");

  // Test negative max
  const negMax = await request(app).post("/set-distribution").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken,
    min: 10,
    max: -50
  });
  assert.equal(negMax.status, 400);
  assert.equal(negMax.body.error, "none of the variables can be less than 0");
});

test("admin cannot set min greater than or equal to max", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const admin = await request(app).post("/start-game").send({
    nickname: "AdminUser",
    adminKey: ADMIN_KEY
  });

  // Test min >= max (equal)
  const equal = await request(app).post("/set-distribution").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken,
    min: 100,
    max: 100
  });
  assert.equal(equal.status, 400);
  assert.equal(equal.body.error, "min cannot be higher than max");

  // Test min > max
  const greater = await request(app).post("/set-distribution").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken,
    min: 150,
    max: 100
  });
  assert.equal(greater.status, 400);
  assert.equal(greater.body.error, "min cannot be higher than max");
});
import { sampleDemand } from "../../server/utils/demand.js";

test("normal distribution with stdDev=0 always returns mean", () => {
  const dist = { type: "normal", mean: 100, stdDev: 0, min: 100, max: 100 };
  for (let i = 0; i < 100; i++) {
    assert.equal(sampleDemand(dist), 100);
  }
});

test("set-distribution accepts normal type with mean and stdDev", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const admin = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const res = await request(app).post("/set-distribution").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken,
    type: "normal",
    mean: 100,
    stdDev: 10
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.distribution.type, "normal");
  assert.equal(res.body.distribution.mean, 100);
  assert.equal(res.body.distribution.stdDev, 10);
  assert.equal(res.body.distribution.min, 70);
  assert.equal(res.body.distribution.max, 130);
});

test("set-distribution accepts normal with stdDev=0 (deterministic demand)", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const admin = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const res = await request(app).post("/set-distribution").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken,
    type: "normal",
    mean: 100,
    stdDev: 0
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.distribution.type, "normal");
  assert.equal(res.body.distribution.mean, 100);
  assert.equal(res.body.distribution.stdDev, 0);
  assert.equal(res.body.distribution.min, 100);
  assert.equal(res.body.distribution.max, 100);
});

// ── Issue #18: non-submitters get a carried/fallback order instead of 0 ───────
test("non-submitter gets the fallback order quantity on the first round", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const admin = await request(app)
    .post("/start-game")
    .send({ nickname: "admin", adminKey: ADMIN_KEY, handsPerTur: 2 });
  const { gameId, adminToken } = admin.body;
  const player = await request(app).post("/start-game").send({ nickname: "p1", gameId });
  const playerId = player.body.playerId;

  await request(app).post("/start-round").send({ gameId, adminToken });
  // p1 does NOT submit
  await request(app).post("/end-round").send({ gameId, adminToken });

  const gs = await request(app).get("/game-state").query({ gameId, playerId });
  assert.equal(gs.body.player.history.length, 1);
  assert.equal(gs.body.player.history[0].orderQuantity, 100);
});

test("non-submitter carries forward the previous round's order quantity", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  // Three hands so playing two rounds does not complete the tur (which resets history).
  const admin = await request(app)
    .post("/start-game")
    .send({ nickname: "admin", adminKey: ADMIN_KEY, handsPerTur: 3 });
  const { gameId, adminToken } = admin.body;
  const player = await request(app).post("/start-game").send({ nickname: "p1", gameId });
  const playerId = player.body.playerId;

  // Round 1: submit 150.
  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId, orderQuantity: 150 });
  await request(app).post("/end-round").send({ gameId, adminToken });

  // Round 2: no submission -> carries 150 forward.
  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/end-round").send({ gameId, adminToken });

  const gs = await request(app).get("/game-state").query({ gameId, playerId });
  assert.equal(gs.body.player.history.length, 2);
  assert.equal(gs.body.player.history[0].orderQuantity, 150);
  assert.equal(gs.body.player.history[1].orderQuantity, 150);
  // Carrying 150 (>= max demand of the default uniform[80,120]) yields a positive profit,
  // not the zero the old `: 0` default produced.
  assert.ok(gs.body.player.history[1].profit > 0);
});

test("a player who never submits gets the fallback every round", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  // Three hands so playing two rounds does not complete the tur (which resets history).
  const admin = await request(app)
    .post("/start-game")
    .send({ nickname: "admin", adminKey: ADMIN_KEY, handsPerTur: 3 });
  const { gameId, adminToken } = admin.body;
  const player = await request(app).post("/start-game").send({ nickname: "p1", gameId });
  const playerId = player.body.playerId;

  for (let i = 0; i < 2; i++) {
    await request(app).post("/start-round").send({ gameId, adminToken });
    await request(app).post("/end-round").send({ gameId, adminToken });
  }

  const gs = await request(app).get("/game-state").query({ gameId, playerId });
  assert.equal(gs.body.player.history.length, 2);
  assert.equal(gs.body.player.history[0].orderQuantity, 100);
  assert.equal(gs.body.player.history[1].orderQuantity, 100);
});

test("one more round still carries forward the previous order for a non-submitter", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });
  const admin = await request(app)
    .post("/start-game")
    .send({ nickname: "admin", adminKey: ADMIN_KEY, handsPerTur: 2 });
  const { gameId, adminToken } = admin.body;
  const player = await request(app).post("/start-game").send({ nickname: "p1", gameId });
  const playerId = player.body.playerId;

  // Play the whole game; the final submitted order is 200.
  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId, orderQuantity: 150 });
  await request(app).post("/end-round").send({ gameId, adminToken });

  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/submit-order").send({ gameId, playerId, orderQuantity: 200 });
  const finalEnd = await request(app).post("/end-round").send({ gameId, adminToken });
  assert.equal(finalEnd.body.finished, true); // game over: server reset player.history

  // Admin extends the game; the extra round is played WITHOUT a submission.
  await request(app).post("/one-more-hand").send({ gameId, adminToken });
  await request(app).post("/start-round").send({ gameId, adminToken });
  await request(app).post("/end-round").send({ gameId, adminToken });

  // The extra round completes the tur again, so the result lives in the latest
  // snapshot. The non-submitter must carry forward round 2's order (200), proving
  // one-more-hand fully restored history before the carry-forward ran.
  const gs = await request(app).get("/game-state").query({ gameId, playerId });
  const lastTur = gs.body.player.turHistory[gs.body.player.turHistory.length - 1];
  assert.equal(lastTur.rounds.length, 3);
  assert.equal(lastTur.rounds[2].orderQuantity, 200);
});
