import express from "express";
import cors from "cors";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { sampleDemand } from "./utils/demand.js";
import { calculateProfit } from "./utils/profit.js";
import {
  isDbEnabled,
  recordGameCreated,
  recordPlayerJoined,
  recordRoundEnded,
  recordRoundStarted
} from "./dbLogger.js";

const PORT = Number(process.env.PORT || 4000);
const DEFAULT_ADMIN_KEY = process.env.ADMIN_KEY || "admin123";

// When a player does not submit, they keep their previous round's order. If they have no
// previous round yet (first round / joined late), fall back to this default quantity.
const FALLBACK_ORDER_QUANTITY = 100;

function calculateLeaderboard(players) {
  return Array.from(players.values())
    .map((player) => {
      const cumulativeProfit = player.history.reduce((sum, entry) => sum + entry.profit, 0);

      return {
        nickname: player.nickname,
        cumulativeProfit,
        roundsPlayed: player.history.length
      };
    })
    .sort((a, b) => b.cumulativeProfit - a.cumulativeProfit)
    .map((row, index) => ({ rank: index + 1, ...row }));
}

function sanitizeNickname(raw) {
  return String(raw || "").trim().slice(0, 20);
}

function getRoundForGame(game) {
  if (game.currentTurIndex >= game.totalTurs) {
    return null;
  }

  const baseRound = game.rounds[game.currentRoundIndex];

  if (!baseRound) {
    return null;
  }

  return {
    ...baseRound,
    distribution: { ...game.distribution }
  };
}

export function createApp({ adminKey = DEFAULT_ADMIN_KEY, onGameEvent } = {}) {
  const app = express();
  let activeGame = null;
  const submitAttempts = new Map(); // playerId -> { count, windowStart }

  if (isDbEnabled()) {
    console.log("Supabase persistence is enabled.");
  }

  const emitGameEvent = (game, type, extra = {}) => {
    if (typeof onGameEvent !== "function" || !game) {
      return;
    }

    onGameEvent({
      type,
      gameId: game.id,
      roundPhase: game.roundPhase,
      currentRound: getRoundForGame(game),
      distribution: game.distribution,
      timestamp: new Date().toISOString(),
      ...extra
    });
  };

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, activeGameId: activeGame?.id || null });
  });

  app.post("/start-game", (req, res) => {
    const nickname = sanitizeNickname(req.body?.nickname);
    const requestedAdminKey = req.body?.adminKey;
    const requestedGameId = req.body?.gameId;

    if (!nickname) {
      return res.status(400).json({ error: "nickname is required" });
    }

    if (requestedAdminKey) {
      if (requestedAdminKey !== adminKey) {
        return res.status(403).json({ error: "invalid admin key" });
      }

      const handsPerTur = Math.max(1, Math.min(40, Math.round(Number(req.body?.handsPerTur) || 5)));
      // Multi-turn support was removed from the UI; every game is a single turn.
      const totalTurs = 1;

      activeGame = {
        id: randomUUID(),
        adminToken: randomUUID(),
        players: new Map(),
        createdAt: new Date().toISOString(),
        currentRoundIndex: 0,
        currentTurIndex: 0,
        totalTurs,
        handsPerTur,
        initialHandsPerTur: handsPerTur,
        rounds: Array.from({ length: handsPerTur }, (_, i) => ({ id: i + 1, title: `Round ${i + 1}` })),
        roundPhase: "pending",
        distribution: { type: "uniform", min: 80, max: 120 },
        prices: { wholesaleCost: 10, retailPrice: 40, salvagePrice: 5 },
        distributionHistory: [],
        roundHistory: [],
        leaderboard: [],
        activeRoundDemand: null,
        activeRoundOrders: new Map()
      };

      activeGame.distributionHistory.push({
        roundIndex: activeGame.currentRoundIndex,
        distribution: { ...activeGame.distribution },
        updatedAt: new Date().toISOString()
      });
    }

    if (!activeGame) {
      return res.status(400).json({
        error: "no active game. ask admin to create one with adminKey"
      });
    }

    if (requestedGameId && requestedGameId !== activeGame.id) {
      return res.status(400).json({ error: "requested room is not active" });
    }

    const existingPlayer = Array.from(activeGame.players.values()).find(
      (player) => player.nickname.toLowerCase() === nickname.toLowerCase()
    );

    if (existingPlayer) {
      return res.status(409).json({ error: "this username is taken" });
    }

    const player = {
      id: randomUUID(),
      nickname,
      currentRoundIndex: 0,
      cumulativeProfit: 0,
      overallProfit: 0,
      history: [],
      turHistory: []
    };

    activeGame.players.set(player.id, player);

    const joinedAt = new Date().toISOString();

    if (requestedAdminKey) {
      void recordGameCreated({
        gameId: activeGame.id,
        adminPlayerId: player.id,
        createdAt: activeGame.createdAt
      });
    }

    void recordPlayerJoined({
      gameId: activeGame.id,
      playerId: player.id,
      nickname: player.nickname,
      isAdmin: Boolean(requestedAdminKey),
      joinedAt
    });

    if (activeGame.roundPhase === "pending") {
      activeGame.leaderboard = calculateLeaderboard(activeGame.players);
    }

    emitGameEvent(activeGame, "player_joined", {
      playerId: player.id,
      nickname: player.nickname
    });

    return res.json({
      gameId: activeGame.id,
      adminToken: requestedAdminKey ? activeGame.adminToken : undefined,
      playerId: player.id,
      nickname: player.nickname,
      currentRound: getRoundForGame(activeGame),
      roundPhase: activeGame.roundPhase,
      distribution: activeGame.distribution,
      prices: activeGame.prices,
      totalRounds: activeGame.handsPerTur,
      totalTurs: activeGame.totalTurs,
      currentTurIndex: activeGame.currentTurIndex,
      roundsPlayed: player.history.length,
      cumulativeProfit: player.cumulativeProfit
    });
  });

  app.post("/set-distribution", (req, res) => {
    const { gameId, adminToken, type, min, max, mean } = req.body || {};

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    if (!adminToken || adminToken !== activeGame.adminToken) {
      return res.status(403).json({ error: "admin authorization required" });
    }

    if (activeGame.roundPhase === "active") {
      return res.status(400).json({ error: "cannot change distribution during active round" });
    }

    const distType = type === "normal" ? "normal" : "uniform";

    let newDistribution;

    if (distType === "normal") {
      const parsedMean = Number(mean);
      const parsedStdDev = Number(req.body?.stdDev);

      if (!Number.isFinite(parsedMean) || !Number.isFinite(parsedStdDev)) {
        return res.status(400).json({ error: "mean and stdDev must be numbers" });
      }

      // Mean is rounded to a whole number, so anything below 0.5 collapses to 0.
      if (parsedMean < 0.5) {
        return res.status(400).json({ error: "mean must be at least 0.5" });
      }

      if (parsedStdDev < 0) {
        return res.status(400).json({ error: "stdDev cannot be negative" });
      }

      const boundedMin = Math.max(0, Math.round(parsedMean - 3 * parsedStdDev));
      const boundedMax = Math.round(parsedMean + 3 * parsedStdDev);

      newDistribution = {
        type: "normal",
        mean: Math.round(parsedMean),
        stdDev: parsedStdDev,
        min: parsedStdDev === 0 ? Math.round(parsedMean) : boundedMin,
        max: parsedStdDev === 0 ? Math.round(parsedMean) : boundedMax
      };
    } else {
      const parsedMin = Number(min);
      const parsedMax = Number(max);

      if (!Number.isFinite(parsedMin) || !Number.isFinite(parsedMax)) {
        return res.status(400).json({ error: "min and max must be numbers" });
      }

      if (parsedMin < 0 || parsedMax < 0) {
        return res.status(400).json({ error: "none of the variables can be less than 0" });
      }

      if (parsedMin >= parsedMax) {
        return res.status(400).json({ error: "min cannot be higher than max" });
      }

      newDistribution = {
        type: "uniform",
        min: Math.round(parsedMin),
        max: Math.round(parsedMax)
      };
    }

    activeGame.distribution = newDistribution;

    activeGame.distributionHistory.push({
      roundIndex: activeGame.currentRoundIndex,
      distribution: { ...activeGame.distribution },
      updatedAt: new Date().toISOString()
    });

    emitGameEvent(activeGame, "distribution_updated");

    return res.json({
      gameId: activeGame.id,
      distribution: activeGame.distribution,
      distributionHistory: activeGame.distributionHistory
    });
  });

  app.post("/set-prices", (req, res) => {
    const { gameId, adminToken, wholesaleCost, retailPrice, salvagePrice } = req.body || {};

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    if (!adminToken || adminToken !== activeGame.adminToken) {
      return res.status(403).json({ error: "admin authorization required" });
    }

    if (activeGame.roundPhase === "active") {
      return res.status(400).json({ error: "cannot change prices during active round" });
    }

    const parsedWholesale = Number(wholesaleCost);
    const parsedRetail = Number(retailPrice);
    const parsedSalvage = Number(salvagePrice);

    if (!Number.isFinite(parsedWholesale) || !Number.isFinite(parsedRetail) || !Number.isFinite(parsedSalvage)) {
      return res.status(400).json({ error: "all prices must be valid numbers" });
    }

    if (parsedWholesale <= 0 || parsedRetail <= 0) {
      return res.status(400).json({ error: "wholesaleCost and retailPrice must be greater than 0" });
    }

    if (parsedSalvage < 0) {
      return res.status(400).json({ error: "salvagePrice cannot be negative" });
    }

    if (parsedSalvage >= parsedWholesale) {
      return res.status(400).json({ error: "salvagePrice must be less than wholesaleCost" });
    }

    if (parsedWholesale >= parsedRetail) {
      return res.status(400).json({ error: "wholesaleCost must be less than retailPrice" });
    }

    activeGame.prices = {
      wholesaleCost: parsedWholesale,
      retailPrice: parsedRetail,
      salvagePrice: parsedSalvage
    };

    emitGameEvent(activeGame, "prices_updated");

    return res.json({
      gameId: activeGame.id,
      prices: activeGame.prices
    });
  });

  app.post("/start-round", (req, res) => {
    const { gameId, adminToken } = req.body || {};

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    if (!adminToken || adminToken !== activeGame.adminToken) {
      return res.status(403).json({ error: "admin authorization required" });
    }

    const currentRound = getRoundForGame(activeGame);
    if (!currentRound) {
      return res.status(400).json({ error: "game already completed" });
    }

    if (activeGame.roundPhase === "active") {
      return res.status(400).json({ error: "round already active" });
    }

    activeGame.activeRoundDemand = sampleDemand(activeGame.distribution);
    activeGame.activeRoundOrders = new Map();
    activeGame.roundPhase = "active";
    const startedAt = new Date().toISOString();

    void recordRoundStarted({
      gameId: activeGame.id,
      turNo: activeGame.currentTurIndex + 1,
      roundId: currentRound.id,
      roundNo: activeGame.currentRoundIndex + 1,
      distribution: activeGame.distribution,
      prices: activeGame.prices,
      realizedDemand: activeGame.activeRoundDemand,
      startedAt
    });

    emitGameEvent(activeGame, "round_started");

    return res.json({
      gameId: activeGame.id,
      roundPhase: activeGame.roundPhase,
      currentRound,
      totalRounds: activeGame.handsPerTur,
      totalTurs: activeGame.totalTurs,
      currentTurIndex: activeGame.currentTurIndex
    });
  });

  app.post("/submit-order", (req, res) => {
    const { gameId, playerId, orderQuantity } = req.body || {};

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    const player = activeGame.players.get(playerId);
    if (!player) {
      return res.status(404).json({ error: "player not found" });
    }

    const now = Date.now();
    const attempt = submitAttempts.get(player.id) || { count: 0, windowStart: now };
    if (now - attempt.windowStart > 60_000) {
      attempt.count = 0;
      attempt.windowStart = now;
    }
    if (attempt.count >= 10) {
      return res.status(429).json({ error: "too many requests, please slow down" });
    }
    attempt.count += 1;
    submitAttempts.set(player.id, attempt);

    if (activeGame.roundPhase !== "active") {
      return res.status(400).json({ error: "round is not active" });
    }

    const parsedQty = Number(orderQuantity);
    if (!Number.isInteger(parsedQty) || parsedQty <= 0) {
      return res.status(400).json({ error: "orderQuantity must be positive integer" });
    }

    const round = getRoundForGame(activeGame);
    if (!round) {
      return res.status(400).json({ error: "game already completed" });
    }

    const alreadySubmittedThisRound = activeGame.activeRoundOrders.has(player.id);

    if (alreadySubmittedThisRound) {
      return res.status(400).json({ error: "player already submitted this round" });
    }

    activeGame.activeRoundOrders.set(player.id, {
      playerId: player.id,
      nickname: player.nickname,
      orderQuantity: parsedQty,
      submittedAt: new Date().toISOString()
    });

    emitGameEvent(activeGame, "order_submitted", {
      playerId: player.id,
      nickname: player.nickname,
      roundsPlayed: player.history.length
    });

    return res.json({
      accepted: true,
      roundId: round.id,
      orderQuantity: parsedQty,
      cumulativeProfit: player.cumulativeProfit,
      roundsPlayed: player.history.length,
      totalRounds: activeGame.handsPerTur,
      currentRound: round,
      roundPhase: activeGame.roundPhase
    });
  });

  app.post("/end-round", (req, res) => {
    const { gameId, adminToken } = req.body || {};

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    if (!adminToken || adminToken !== activeGame.adminToken) {
      return res.status(403).json({ error: "admin authorization required" });
    }

    if (activeGame.roundPhase !== "active") {
      return res.status(400).json({ error: "round is not active" });
    }

    const endingRound = getRoundForGame(activeGame);
    const realizedDemand = activeGame.activeRoundDemand;
    const endedAt = new Date().toISOString();

    if (!endingRound || !Number.isFinite(realizedDemand)) {
      return res.status(400).json({ error: "round demand state is invalid" });
    }

    const dbRoundResults = [];

    // Record a result for every player so non-submitters also see the round outcome.
    // No order submitted carries the player's previous round's order forward, or falls
    // back to FALLBACK_ORDER_QUANTITY when they have no prior round yet.
    for (const player of activeGame.players.values()) {
      const order = activeGame.activeRoundOrders.get(player.id);
      const lastResult = player.history[player.history.length - 1];
      const orderQuantity = order
        ? order.orderQuantity
        : lastResult
          ? lastResult.orderQuantity
          : FALLBACK_ORDER_QUANTITY;

      const details = calculateProfit(orderQuantity, realizedDemand, activeGame.prices);
      const roundResult = {
        round: endingRound.id,
        title: endingRound.title,
        distribution: { ...activeGame.distribution },
        orderQuantity,
        realizedDemand,
        ...details,
        createdAt: new Date().toISOString()
      };

      player.history.push(roundResult);
      player.cumulativeProfit += roundResult.profit;

      dbRoundResults.push({
        playerId: player.id,
        nickname: player.nickname,
        orderQuantity,
        submittedAt: order ? order.submittedAt : null,
        sold: roundResult.soldUnits,
        leftover: roundResult.unsoldUnits,
        stockout: Math.max(0, realizedDemand - orderQuantity),
        profit: roundResult.profit
      });
    }

    void recordRoundEnded({
      gameId: activeGame.id,
      turNo: activeGame.currentTurIndex + 1,
      roundId: endingRound.id,
      realizedDemand,
      endedAt,
      results: dbRoundResults
    });

    activeGame.roundHistory.push({
      roundId: endingRound.id,
      roundNo: activeGame.currentRoundIndex + 1,
      turNo: activeGame.currentTurIndex + 1,
      realizedDemand,
      endedAt
    });

    activeGame.roundPhase = "pending";
    activeGame.currentRoundIndex += 1;
    activeGame.activeRoundDemand = null;
    activeGame.activeRoundOrders = new Map();

    let isTurComplete = false;
    let isGameOver = false;

    if (activeGame.currentRoundIndex >= activeGame.handsPerTur) {
      isTurComplete = true;

      // Snapshot leaderboard before score reset
      activeGame.leaderboard = calculateLeaderboard(activeGame.players);

      const completedTurNumber = activeGame.currentTurIndex + 1;

      for (const p of activeGame.players.values()) {
        p.turHistory.push({
          turNumber: completedTurNumber,
          cumulativeProfit: p.cumulativeProfit,
          rounds: [...p.history]
        });
        p.overallProfit += p.cumulativeProfit;
        p.cumulativeProfit = 0;
        p.history = [];
      }

      activeGame.currentTurIndex += 1;
      activeGame.currentRoundIndex = 0;

      if (activeGame.currentTurIndex >= activeGame.totalTurs) {
        isGameOver = true;
      }
    } else {
      activeGame.leaderboard = calculateLeaderboard(activeGame.players);
    }

    const nextRound = getRoundForGame(activeGame);
    emitGameEvent(activeGame, "round_ended", { finished: isGameOver, turComplete: isTurComplete });

    return res.json({
      gameId: activeGame.id,
      finished: isGameOver,
      turComplete: isTurComplete,
      currentTurIndex: activeGame.currentTurIndex,
      currentTurNumber: activeGame.currentTurIndex + 1,
      totalTurs: activeGame.totalTurs,
      nextRound,
      roundPhase: activeGame.roundPhase,
      distribution: activeGame.distribution,
      prices: activeGame.prices,
      leaderboard: activeGame.leaderboard,
      realizedDemand
    });
  });

  app.post("/one-more-hand", (req, res) => {
    const { gameId, adminToken } = req.body || {};

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    if (!adminToken || adminToken !== activeGame.adminToken) {
      return res.status(403).json({ error: "admin authorization required" });
    }

    // Only valid once the game has finished (no playable round remains).
    if (getRoundForGame(activeGame) !== null) {
      return res.status(400).json({ error: "game is still in progress" });
    }

    // Re-open the just-completed turn so the extra round continues the same run:
    // undo the finalize step (turHistory snapshot + score reset) that the last
    // end-round performed, restoring each player's running profit and history.
    for (const player of activeGame.players.values()) {
      const lastTur = player.turHistory.pop();
      if (!lastTur) {
        continue;
      }
      player.history = lastTur.rounds;
      player.cumulativeProfit = lastTur.cumulativeProfit;
      player.overallProfit -= lastTur.cumulativeProfit;
    }
    activeGame.currentTurIndex = Math.max(0, activeGame.currentTurIndex - 1);

    // Append one more round and make it the one to play next.
    const newHandId = activeGame.rounds.length + 1;
    activeGame.rounds.push({ id: newHandId, title: `Round ${newHandId}` });
    activeGame.handsPerTur = activeGame.rounds.length;
    activeGame.currentRoundIndex = newHandId - 1;
    activeGame.roundPhase = "pending";
    activeGame.activeRoundDemand = null;
    activeGame.activeRoundOrders = new Map();
    activeGame.leaderboard = calculateLeaderboard(activeGame.players);

    emitGameEvent(activeGame, "game_extended");

    return res.json({
      gameId: activeGame.id,
      roundPhase: activeGame.roundPhase,
      currentRound: getRoundForGame(activeGame),
      totalRounds: activeGame.handsPerTur,
      totalTurs: activeGame.totalTurs,
      currentTurIndex: activeGame.currentTurIndex,
      distribution: activeGame.distribution,
      prices: activeGame.prices,
      leaderboard: activeGame.leaderboard
    });
  });

  app.post("/end-game", (req, res) => {
    const { gameId, adminToken } = req.body || {};

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    if (!adminToken || adminToken !== activeGame.adminToken) {
      return res.status(403).json({ error: "admin authorization required" });
    }

    // Notify every subscribed client before the instance is dropped.
    emitGameEvent(activeGame, "game_deleted");
    activeGame = null;

    return res.json({ ok: true });
  });

  app.post("/restart-game", (req, res) => {
    const { gameId, adminToken, playerId } = req.body || {};

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    if (!adminToken || adminToken !== activeGame.adminToken) {
      return res.status(403).json({ error: "admin authorization required" });
    }

    const oldGameId = activeGame.id;
    const roster = Array.from(activeGame.players.values()).map((p) => ({
      id: p.id,
      nickname: p.nickname
    }));
    // Restart returns to the originally configured number of rounds, even if the
    // game was extended via "one more round".
    const handsPerTur = activeGame.initialHandsPerTur ?? activeGame.handsPerTur;
    const createdAt = new Date().toISOString();
    const newGameId = randomUUID();

    // Rebuild every player fresh, keeping their id + nickname so each client only
    // has to swap the game id. All progress is wiped back to the very beginning.
    const players = new Map();
    for (const member of roster) {
      players.set(member.id, {
        id: member.id,
        nickname: member.nickname,
        currentRoundIndex: 0,
        cumulativeProfit: 0,
        overallProfit: 0,
        history: [],
        turHistory: []
      });
    }

    // A brand-new game id means DB round writes start clean instead of colliding
    // with the previous run's (game_id, tur_no, round_id) rows. The adminToken is
    // reused so the admin keeps control without broadcasting a new secret.
    const restarted = {
      id: newGameId,
      adminToken: activeGame.adminToken,
      players,
      createdAt,
      currentRoundIndex: 0,
      currentTurIndex: 0,
      totalTurs: activeGame.totalTurs,
      handsPerTur,
      initialHandsPerTur: handsPerTur,
      rounds: Array.from({ length: handsPerTur }, (_, i) => ({ id: i + 1, title: `Round ${i + 1}` })),
      roundPhase: "pending",
      distribution: { ...activeGame.distribution },
      prices: { ...activeGame.prices },
      distributionHistory: [],
      roundHistory: [],
      leaderboard: [],
      activeRoundDemand: null,
      activeRoundOrders: new Map()
    };

    restarted.distributionHistory.push({
      roundIndex: 0,
      distribution: { ...restarted.distribution },
      updatedAt: createdAt
    });
    restarted.leaderboard = calculateLeaderboard(restarted.players);

    activeGame = restarted;

    // Register the new game id + roster so later round/order writes have a home.
    void recordGameCreated({
      gameId: newGameId,
      adminPlayerId: playerId || roster[0]?.id || null,
      createdAt
    });
    for (const member of roster) {
      void recordPlayerJoined({
        gameId: newGameId,
        playerId: member.id,
        nickname: member.nickname,
        isAdmin: member.id === playerId,
        joinedAt: createdAt
      });
    }

    // Route the event to the OLD game id so currently-subscribed clients receive
    // it, handing them the new id to move to. The new adminToken is intentionally
    // omitted from the broadcast; only the calling admin gets it (and it is the
    // same value anyway).
    if (typeof onGameEvent === "function") {
      onGameEvent({
        type: "game_restarted",
        gameId: oldGameId,
        newGameId,
        roundPhase: restarted.roundPhase,
        currentRound: getRoundForGame(restarted),
        distribution: restarted.distribution,
        timestamp: createdAt
      });
    }

    return res.json({
      gameId: newGameId,
      adminToken: restarted.adminToken,
      roundPhase: restarted.roundPhase,
      currentRound: getRoundForGame(restarted),
      distribution: restarted.distribution,
      prices: restarted.prices,
      totalRounds: restarted.handsPerTur,
      totalTurs: restarted.totalTurs,
      currentTurIndex: restarted.currentTurIndex,
      leaderboard: restarted.leaderboard
    });
  });

  app.get("/game-state", (req, res) => {
    const gameId = req.query.gameId;
    const playerId = req.query.playerId;
    const adminToken = req.query.adminToken;

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    const player = playerId ? activeGame.players.get(playerId) : null;
    if (playerId && !player) {
      return res.status(404).json({ error: "player not found" });
    }

    const currentRound = getRoundForGame(activeGame);
    const isValidAdmin = adminToken && adminToken === activeGame.adminToken;

    return res.json({
      gameId: activeGame.id,
      roundPhase: activeGame.roundPhase,
      currentRound,
      totalRounds: activeGame.handsPerTur,
      totalTurs: activeGame.totalTurs,
      currentTurIndex: activeGame.currentTurIndex,
      distribution: activeGame.distribution,
      prices: activeGame.prices,
      finished: currentRound === null,
      roundHistory: isValidAdmin ? activeGame.roundHistory : undefined,
      player: player
        ? {
            id: player.id,
            nickname: player.nickname,
            roundsPlayed: player.history.length,
            cumulativeProfit: player.cumulativeProfit,
            overallProfit: player.overallProfit,
            history: player.history,
            turHistory: player.turHistory,
            lastRoundResult: player.history[player.history.length - 1] || null,
            submittedThisRound:
              activeGame.roundPhase === "active" && activeGame.activeRoundOrders.has(player.id)
          }
        : undefined
    });
  });

  app.get("/leaderboard", (req, res) => {
    const gameId = req.query.gameId;

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    return res.json({
      gameId: activeGame.id,
      createdAt: activeGame.createdAt,
      leaderboard: activeGame.leaderboard
    });
  });

  return app;
}

export function createGameServer({ adminKey } = {}) {
  const clients = new Set();

  const server = http.createServer(
    createApp({
      adminKey,
      onGameEvent: (eventPayload) => {
        const message = JSON.stringify({ type: "game_event", payload: eventPayload });

        for (const ws of clients) {
          if (ws.readyState !== 1) {
            continue;
          }

          if (!ws.subscription || ws.subscription.gameId !== eventPayload.gameId) {
            continue;
          }

          ws.send(message);
        }
      }
    })
  );

  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws) => {
    ws.subscription = null;
    clients.add(ws);

    ws.on("message", (raw) => {
      try {
        const incoming = JSON.parse(String(raw));

        if (incoming?.type === "subscribe" && typeof incoming?.gameId === "string") {
          ws.subscription = {
            gameId: incoming.gameId,
            playerId: typeof incoming.playerId === "string" ? incoming.playerId : null
          };

          ws.send(JSON.stringify({ type: "subscribed", gameId: ws.subscription.gameId }));
        }
      } catch (_error) {
        ws.send(JSON.stringify({ type: "error", message: "invalid websocket payload" }));
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  server.on("upgrade", (request, socket, head) => {
    if (!request.url || !request.url.startsWith("/ws")) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  return { server, wss };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createGameServer();

  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`WebSocket available on ws://localhost:${PORT}/ws`);
  });
}
