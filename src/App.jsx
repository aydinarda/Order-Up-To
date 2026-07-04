import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RoundInfo from "./components/RoundInfo";
import OrderForm from "./components/OrderForm";
import RoundResult from "./components/RoundResult";
import Leaderboard from "./components/Leaderboard";
import ProgressBar from "./components/ProgressBar";
import EmojiRain from "./components/EmojiRain";
import {
  endGame,
  endRound,
  fetchGameState,
  fetchLeaderboard,
  oneMoreHand,
  restartGame,
  setDistribution,
  setPrices,
  startGame,
  startRound,
  submitOrder
} from "./utils/api";
import {
  saveGameSession,
  loadGameSession,
  clearGameSession,
  clearUrlSession,
  updateUrlWithSession,
  getSessionFromUrl
} from "./utils/sessionStorage";
function App() {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";
  const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || API_BASE_URL.replace(/^http/, "ws");

  const [nicknameInput, setNicknameInput] = useState("");
  const [nickname, setNickname] = useState("");
  const [adminMode, setAdminMode] = useState(false);
  const [adminKey, setAdminKey] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminToken, setAdminToken] = useState("");
  const [gameId, setGameId] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [totalRounds, setTotalRounds] = useState(5);
  const [turHistory, setTurHistory] = useState([]);
  const [handsPerTurInput, setHandsPerTurInput] = useState("5");
  const [currentRound, setCurrentRound] = useState(null);
  const [roundPhase, setRoundPhase] = useState("pending");
  const [distributionType, setDistributionType] = useState("uniform");
  const [distributionMin, setDistributionMin] = useState("80");
  const [distributionMax, setDistributionMax] = useState("120");
  const [distributionMean, setDistributionMean] = useState("100");
  const [distributionStdDev, setDistributionStdDev] = useState("10");
  const [hasUnsavedDistributionChanges, setHasUnsavedDistributionChanges] = useState(false);
  const [wholesaleCost, setWholesaleCost] = useState("10");
  const [retailPrice, setRetailPrice] = useState("40");
  const [salvagePrice, setSalvagePrice] = useState("5");
  const [hasUnsavedPriceChanges, setHasUnsavedPriceChanges] = useState(false);
  const [lastRoundResult, setLastRoundResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [leaderboardRows, setLeaderboardRows] = useState([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [isRoundSubmitted, setIsRoundSubmitted] = useState(false);
  const [adminRoundHistory, setAdminRoundHistory] = useState([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [showFinalLeaderboard, setShowFinalLeaderboard] = useState(false);
  const [emojiBurstKey, setEmojiBurstKey] = useState(0);
  const [emojiRaining, setEmojiRaining] = useState(false);
  const prevRoundRef = useRef(null);

  const cumulativeProfit = useMemo(
    () => history.reduce((sum, row) => sum + row.profit, 0),
    [history]
  );

  const overallProfit = useMemo(
    () => turHistory.reduce((sum, tur) => sum + tur.cumulativeProfit, 0),
    [turHistory]
  );

  // The final round's result lives in the last turn snapshot, because the server
  // resets player.history when the turn completes. Used for the "last round
  // results" screen shown before the final leaderboard.
  const finalRoundResult = useMemo(() => {
    if (!turHistory.length) return null;
    const lastTur = turHistory[turHistory.length - 1];
    if (!lastTur?.rounds?.length) return null;
    return lastTur.rounds[lastTur.rounds.length - 1];
  }, [turHistory]);

    // Restore session on page load from URL params or localStorage
    useEffect(() => {
      const urlSession = getSessionFromUrl();
      const storedSession = loadGameSession();
      const sessionToRestore = urlSession || storedSession;

      if (sessionToRestore?.gameId && sessionToRestore?.playerId) {
        // Resume session
        const restoreAsync = async () => {
          try {
            // Fetch fresh game state from server
            const data = await fetchGameState({
              gameId: sessionToRestore.gameId,
              playerId: sessionToRestore.playerId,
              adminToken: storedSession?.adminToken || undefined
            });

            // Restore all state from fresh data
            setGameId(sessionToRestore.gameId);
            setPlayerId(sessionToRestore.playerId);
            setNickname(storedSession?.nickname || "Player");
            setIsAdmin(storedSession?.isAdmin || false);
            setAdminToken(storedSession?.adminToken || "");
            setCurrentRound(data.currentRound);
            setRoundPhase(data.roundPhase || "pending");
            setDistributionType(data.distribution?.type ?? "uniform");
            setDistributionMin(String(data.distribution?.min ?? 80));
            setDistributionMax(String(data.distribution?.max ?? 120));
            setDistributionMean(String(data.distribution?.mean ?? 100));
            setDistributionStdDev(String(data.distribution?.stdDev ?? 10));
            setHasUnsavedDistributionChanges(false);
            setWholesaleCost(String(data.prices?.wholesaleCost ?? 10));
            setRetailPrice(String(data.prices?.retailPrice ?? 40));
            setSalvagePrice(String(data.prices?.salvagePrice ?? 5));
            setHasUnsavedPriceChanges(false);
            setTotalRounds(data.totalRounds || 5);
            if (data.roundHistory) {
              setAdminRoundHistory(data.roundHistory);
            }

            setStatusMessage("📍 Session restored from previous session");
          } catch (error) {
            console.error("Failed to restore session:", error);
            // Clear invalid session
            clearGameSession();
            setErrorMessage("Failed to restore session. Please start a new game.");
          }
        };

        restoreAsync();
      }
    }, []);
  const isGameFinished = Boolean(nickname) && currentRound === null;

  const refreshLeaderboard = async (nextGameId) => {
    const data = await fetchLeaderboard({ gameId: nextGameId || gameId });
    setLeaderboardRows(data.leaderboard || []);
  };

  const syncGameState = useCallback(async () => {
    if (!gameId || !playerId) {
      return;
    }

    const data = await fetchGameState({ gameId, playerId, adminToken: isAdmin ? adminToken : undefined });

    setCurrentRound(data.currentRound);
    setRoundPhase(data.roundPhase || "pending");
    setTotalRounds(data.totalRounds || 5);

    if (data.distribution) {
      const shouldPreserveAdminDraft =
        isAdmin &&
        hasUnsavedDistributionChanges &&
        (data.roundPhase || "pending") === "pending";

      if (!shouldPreserveAdminDraft) {
        setDistributionType(data.distribution.type ?? "uniform");
        setDistributionMin(String(data.distribution.min));
        setDistributionMax(String(data.distribution.max));
        setDistributionMean(String(data.distribution.mean ?? 100));
        setDistributionStdDev(String(data.distribution?.stdDev ?? 10));
        setHasUnsavedDistributionChanges(false);
      }
    }

    if (data.prices) {
      const shouldPreservePriceDraft =
        isAdmin &&
        hasUnsavedPriceChanges &&
        (data.roundPhase || "pending") === "pending";

      if (!shouldPreservePriceDraft) {
        setWholesaleCost(String(data.prices.wholesaleCost));
        setRetailPrice(String(data.prices.retailPrice));
        setSalvagePrice(String(data.prices.salvagePrice));
        setHasUnsavedPriceChanges(false);
      }
    }

    if (data.player) {
      setNickname(data.player.nickname || nickname);
      setHistory(data.player.history || []);
      setLastRoundResult(data.player.lastRoundResult || null);
      setIsRoundSubmitted(Boolean(data.player.submittedThisRound));
      setTurHistory(data.player.turHistory || []);
    }

    if (data.roundHistory) {
      setAdminRoundHistory(data.roundHistory);
    }

    // Always pull the authoritative leaderboard when the game is over so it shows
    // on every player's screen, not just the admin's.
    if (showLeaderboard || data.finished) {
      const leaderboardData = await fetchLeaderboard({ gameId });
      setLeaderboardRows(leaderboardData.leaderboard || []);
    }
  }, [
    gameId,
    playerId,
    showLeaderboard,
    nickname,
    isAdmin,
    adminToken,
    hasUnsavedDistributionChanges,
    hasUnsavedPriceChanges
  ]);

  const handleNicknameSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage("");

    if (!nicknameInput.trim()) {
      setErrorMessage("Please enter a nickname to continue.");
      return;
    }

    if (adminMode && !adminKey.trim()) {
      setErrorMessage("Admin key is required to create a game.");
      return;
    }

    try {
      const data = await startGame({
        nickname: nicknameInput.trim(),
        adminKey: adminMode ? adminKey.trim() : undefined,
        handsPerTur: adminMode ? Number(handsPerTurInput) : undefined
      });

      setNickname(data.nickname);
      setGameId(data.gameId);
      setPlayerId(data.playerId);
      setIsAdmin(Boolean(data.adminToken));
      setAdminToken(data.adminToken || "");
      setCurrentRound(data.currentRound);
      setRoundPhase(data.roundPhase || "pending");
      setDistributionType(data.distribution?.type ?? "uniform");
      setDistributionMin(String(data.distribution?.min ?? 80));
      setDistributionMax(String(data.distribution?.max ?? 120));
      setDistributionMean(String(data.distribution?.mean ?? 100));
      setDistributionStdDev(String(data.distribution?.stdDev ?? 10));
      setHasUnsavedDistributionChanges(false);
      setWholesaleCost(String(data.prices?.wholesaleCost ?? 10));
      setRetailPrice(String(data.prices?.retailPrice ?? 40));
      setSalvagePrice(String(data.prices?.salvagePrice ?? 5));
      setHasUnsavedPriceChanges(false);
      setTotalRounds(data.totalRounds);
      setTurHistory([]);
      setHistory([]);
      setLastRoundResult(null);
      setIsRoundSubmitted(false);
      
        // Save session to localStorage and URL
        saveGameSession({
          gameId: data.gameId,
          playerId: data.playerId,
          nickname: data.nickname,
          isAdmin: Boolean(data.adminToken),
          adminToken: data.adminToken || "",
          roundPhase: data.roundPhase || "pending"
        });
        updateUrlWithSession(data.gameId, data.playerId);

      setStatusMessage(
        adminMode ? "Active game created and player joined." : "Joined active game."
      );

      await refreshLeaderboard(data.gameId);
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const handleOrderSubmit = async (orderQuantity) => {
    if (!currentRound || !gameId || !playerId) {
      return;
    }

    try {
      setErrorMessage("");
      const data = await submitOrder({ gameId, playerId, orderQuantity });

      setRoundPhase(data.roundPhase || roundPhase);
      setIsRoundSubmitted(true);
      setStatusMessage("Order submitted. Waiting for round end.");
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const handleStartRound = async () => {
    try {
      setErrorMessage("");
      const data = await startRound({ gameId, adminToken });
      setCurrentRound(data.currentRound);
      setRoundPhase(data.roundPhase);
      setHasUnsavedDistributionChanges(false);
      setStatusMessage(`Round ${data.currentRound.id} started.`);
      setIsRoundSubmitted(false);
      setLastRoundResult(null);
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const handleEndRound = async () => {
    try {
      setErrorMessage("");
      const data = await endRound({ gameId, adminToken });
      setCurrentRound(data.nextRound);
      setRoundPhase(data.roundPhase);
      if (data.distribution) {
        setDistributionType(data.distribution.type ?? "uniform");
        setDistributionMin(String(data.distribution.min));
        setDistributionMax(String(data.distribution.max));
        setDistributionMean(String(data.distribution.mean ?? 100));
        setDistributionStdDev(String(data.distribution?.stdDev ?? 10));
        setHasUnsavedDistributionChanges(false);
      }
      if (data.prices) {
        setWholesaleCost(String(data.prices.wholesaleCost));
        setRetailPrice(String(data.prices.retailPrice));
        setSalvagePrice(String(data.prices.salvagePrice));
        setHasUnsavedPriceChanges(false);
      }
      setLeaderboardRows(data.leaderboard || []);
      setStatusMessage(
        data.finished
          ? "Game complete."
          : `Round ended. Next round is ${data.nextRound?.id}. Realized demand was ${data.realizedDemand}.`
      );
      setIsRoundSubmitted(false);
      await syncGameState();
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  // Reset all session-scoped state back to the nickname/auth screen.
  const resetToAuth = useCallback(() => {
    clearGameSession();
    clearUrlSession();
    setNickname("");
    setNicknameInput("");
    setGameId("");
    setPlayerId("");
    setIsAdmin(false);
    setAdminToken("");
    setAdminMode(false);
    setAdminKey("");
    setCurrentRound(null);
    setRoundPhase("pending");
    setHistory([]);
    setTurHistory([]);
    setLeaderboardRows([]);
    setShowLeaderboard(false);
    setShowFinalLeaderboard(false);
    setLastRoundResult(null);
    setIsRoundSubmitted(false);
    setStatusMessage("");
    setErrorMessage("");
  }, []);

  // "One more round?" — append a single extra round and resume the same game.
  // The final screen reappears after it ends, so this loops recursively.
  const handleOneMoreHand = async () => {
    try {
      setErrorMessage("");
      const data = await oneMoreHand({ gameId, adminToken });
      setCurrentRound(data.currentRound);
      setRoundPhase(data.roundPhase);
      setTotalRounds(data.totalRounds || totalRounds);
      setLeaderboardRows(data.leaderboard || []);
      setLastRoundResult(null);
      setIsRoundSubmitted(false);
      setShowFinalLeaderboard(false);
      setStatusMessage("Extra round added. Start the round when ready.");
      await syncGameState();
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  // "End Game" — delete the game instance and return everyone to the start screen.
  const handleEndGame = async () => {
    try {
      setErrorMessage("");
      await endGame({ gameId, adminToken });
      resetToAuth();
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  // Move this client onto the restarted game id and wipe local progress back to
  // the very beginning. Player id and nickname are kept; the admin keeps its
  // (reused) adminToken, so newAdminToken is only passed for the calling admin.
  const applyRestart = useCallback(
    ({ newGameId, newAdminToken, currentRound: nextRound, roundPhase: nextPhase }) => {
      setGameId(newGameId);
      if (newAdminToken !== undefined) {
        setAdminToken(newAdminToken);
      }
      setCurrentRound(nextRound ?? null);
      setRoundPhase(nextPhase ?? "pending");
      setHistory([]);
      setTurHistory([]);
      setLeaderboardRows([]);
      setLastRoundResult(null);
      setIsRoundSubmitted(false);
      setHasUnsavedDistributionChanges(false);
      setHasUnsavedPriceChanges(false);
      setShowRestartConfirm(false);
      setShowFinalLeaderboard(false);
      setStatusMessage("Game restarted — back to the beginning.");
      setErrorMessage("");

      saveGameSession({
        gameId: newGameId,
        playerId,
        nickname,
        isAdmin,
        adminToken: newAdminToken ?? adminToken,
        roundPhase: nextPhase ?? "pending"
      });
      updateUrlWithSession(newGameId, playerId);
    },
    [playerId, nickname, isAdmin, adminToken]
  );

  // "Restart Game" (admin) — fresh game id, same roster, all histories reset.
  const handleRestartGame = async () => {
    try {
      setErrorMessage("");
      const data = await restartGame({ gameId, adminToken, playerId });
      applyRestart({
        newGameId: data.gameId,
        newAdminToken: data.adminToken,
        currentRound: data.currentRound,
        roundPhase: data.roundPhase
      });
    } catch (error) {
      setShowRestartConfirm(false);
      setErrorMessage(error.message);
    }
  };

  const handleParametersSave = async () => {
    try {
      setErrorMessage("");

      // --- Distribution validation ---
      let distPayload = { gameId, adminToken, type: distributionType };

      if (distributionType === "normal") {
        const parsedMean = Number(distributionMean);
        const parsedStdDev = Number(distributionStdDev);

        if (!Number.isFinite(parsedMean) || !Number.isFinite(parsedStdDev)) {
          setErrorMessage("Mean and std. deviation must be valid numbers.");
          return;
        }

        // Mean is rounded to a whole number, so anything below 0.5 collapses to 0.
        if (parsedMean < 0.5) {
          setErrorMessage("Mean must be at least 0.5.");
          return;
        }

        if (parsedStdDev < 0) {
          setErrorMessage("Std. deviation cannot be negative.");
          return;
        }

        distPayload = { ...distPayload, mean: parsedMean, stdDev: parsedStdDev };
      } else {
        const parsedMin = Number(distributionMin);
        const parsedMax = Number(distributionMax);

        if (!Number.isFinite(parsedMin) || !Number.isFinite(parsedMax)) {
          setErrorMessage("Uniform min and max must be valid numbers.");
          return;
        }

        if (parsedMin < 0 || parsedMax < 0) {
          setErrorMessage("none of the variables can be less than 0");
          return;
        }

        if (parsedMin >= parsedMax) {
          setErrorMessage("min cannot be higher than max");
          return;
        }

        distPayload = { ...distPayload, min: parsedMin, max: parsedMax };
      }

      // --- Prices validation ---
      const parsedWholesale = Number(wholesaleCost);
      const parsedRetail = Number(retailPrice);
      const parsedSalvage = Number(salvagePrice);

      if (!Number.isFinite(parsedWholesale) || !Number.isFinite(parsedRetail) || !Number.isFinite(parsedSalvage)) {
        setErrorMessage("All prices must be valid numbers.");
        return;
      }

      if (parsedWholesale <= 0 || parsedRetail <= 0) {
        setErrorMessage("Wholesale cost and retail price must be greater than 0.");
        return;
      }

      if (parsedSalvage < 0) {
        setErrorMessage("Salvage price cannot be negative.");
        return;
      }

      if (parsedSalvage >= parsedWholesale) {
        setErrorMessage("Salvage price must be less than wholesale cost.");
        return;
      }

      if (parsedWholesale >= parsedRetail) {
        setErrorMessage("Wholesale cost must be less than retail price.");
        return;
      }

      // --- Save both ---
      const distData = await setDistribution(distPayload);
      const pricesData = await setPrices({
        gameId,
        adminToken,
        wholesaleCost: parsedWholesale,
        retailPrice: parsedRetail,
        salvagePrice: parsedSalvage
      });

      setDistributionType(distData.distribution.type ?? "uniform");
      setDistributionMin(String(distData.distribution.min));
      setDistributionMax(String(distData.distribution.max));
      setDistributionMean(String(distData.distribution.mean ?? 100));
      setDistributionStdDev(String(distData.distribution?.stdDev ?? 10));
      setHasUnsavedDistributionChanges(false);
      setCurrentRound((prev) => {
        if (!prev) return prev;
        return { ...prev, distribution: distData.distribution };
      });

      setWholesaleCost(String(pricesData.prices.wholesaleCost));
      setRetailPrice(String(pricesData.prices.retailPrice));
      setSalvagePrice(String(pricesData.prices.salvagePrice));
      setHasUnsavedPriceChanges(false);

      const distDesc =
        distData.distribution.type === "normal"
          ? `Normal (μ=${distData.distribution.mean}, σ=${distData.distribution.stdDev})`
          : `Uniform [${distData.distribution.min}, ${distData.distribution.max}]`;

      setStatusMessage(
        `Parameters updated — Distribution: ${distDesc} | Retail $${pricesData.prices.retailPrice}, Wholesale $${pricesData.prices.wholesaleCost}, Salvage $${pricesData.prices.salvagePrice}.`
      );
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  // "Go to Leaderboard" (everyone, once the game is finished) — pull the latest
  // standings, then switch to the dedicated final leaderboard screen.
  const handleGoToLeaderboard = async () => {
    try {
      setErrorMessage("");
      await refreshLeaderboard(gameId);
    } catch (error) {
      setErrorMessage(error.message);
    }
    setShowFinalLeaderboard(true);
  };

  const handleLeaderboardToggle = async () => {
    const nextVisible = !showLeaderboard;
    setShowLeaderboard(nextVisible);

    if (nextVisible) {
      try {
        setErrorMessage("");
        await refreshLeaderboard(gameId);
      } catch (error) {
        setErrorMessage(error.message);
      }
    }
  };

  useEffect(() => {
    if (!gameId || !playerId) {
      return undefined;
    }

    const syncStateSafely = async () => {
      try {
        await syncGameState();
      } catch (_error) {
        // Polling fallback stays quiet on transient issues.
      }
    };

    syncStateSafely();
    const intervalId = setInterval(syncStateSafely, 150000);

    return () => {
      clearInterval(intervalId);
    };
  }, [gameId, playerId, syncGameState]);

  useEffect(() => {
    if (!gameId || !playerId) {
      return undefined;
    }

    const ws = new WebSocket(`${WS_BASE_URL}/ws`);

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          type: "subscribe",
          gameId,
          playerId
        })
      );
    });

    ws.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message?.type === "game_event") {
          const eventType = message.payload?.type;

          if (eventType === "order_submitted") {
            return;
          }

          if (eventType === "game_deleted") {
            // Admin ended the game instance — send everyone back to the start.
            resetToAuth();
            return;
          }

          if (eventType === "game_restarted") {
            // Admin restarted: move to the new game id and reset to the beginning.
            // adminToken is kept as-is (it was reused, so it stays valid).
            applyRestart({
              newGameId: message.payload.newGameId,
              currentRound: message.payload.currentRound,
              roundPhase: message.payload.roundPhase
            });
            return;
          }

          if (eventType === "round_started") {
            setRoundPhase(message.payload.roundPhase || "active");
            setCurrentRound(message.payload.currentRound || null);
            setIsRoundSubmitted(false);
            setStatusMessage("");
            return;
          }

          syncGameState().catch(() => {
            // Polling will recover eventual consistency.
          });
        }
      } catch (_error) {
        // Ignore malformed websocket messages.
      }
    });

    return () => {
      ws.close();
    };
  }, [WS_BASE_URL, gameId, playerId, syncGameState, resetToAuth, applyRestart]);

  // Trigger a falling-emoji burst whenever the round changes (client-only, no network).
  useEffect(() => {
    const roundId = currentRound?.id ?? null;

    if (prevRoundRef.current !== null && roundId !== null && roundId !== prevRoundRef.current) {
      setEmojiBurstKey((key) => key + 1);
      setEmojiRaining(true);
    }

    prevRoundRef.current = roundId;
  }, [currentRound?.id]);

  // Auto-clear the burst after the animation finishes.
  useEffect(() => {
    if (!emojiRaining) {
      return undefined;
    }

    const timeoutId = setTimeout(() => setEmojiRaining(false), 4000);
    return () => clearTimeout(timeoutId);
  }, [emojiBurstKey, emojiRaining]);

  if (!nickname) {
    return (
      <main className="page auth-page">
        <section className="card auth-card">
          <div className="auth-header">
            <h1 className="auth-title">EverChic Fashions</h1>
            <p className="auth-subtitle">Hawaiian Shirt Newsvendor Game</p>
            <p className="muted">
              Enter a nickname to join an active game. Use admin mode to create one.
            </p>
          </div>
          <form onSubmit={handleNicknameSubmit} className="order-form">
            <label htmlFor="nickname">Nickname</label>
            <input
              id="nickname"
              type="text"
              value={nicknameInput}
              onChange={(event) => setNicknameInput(event.target.value)}
              placeholder="ex: ops_master"
              maxLength={20}
            />

            <label className="checkbox-line" htmlFor="adminMode">
              <input
                id="adminMode"
                type="checkbox"
                checked={adminMode}
                onChange={(event) => setAdminMode(event.target.checked)}
              />
              Create active game as admin
            </label>

            {adminMode ? (
              <>
                <label htmlFor="adminKey">Admin key</label>
                <input
                  id="adminKey"
                  type="password"
                  value={adminKey}
                  onChange={(event) => setAdminKey(event.target.value)}
                  placeholder="admin key"
                />
                <label htmlFor="handsPerTur">Number of rounds</label>
                <input
                  id="handsPerTur"
                  type="number"
                  min="1"
                  max="20"
                  value={handsPerTurInput}
                  onChange={(event) => setHandsPerTurInput(event.target.value)}
                />
              </>
            ) : null}

            {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
            <button type="submit">Start Game</button>
          </form>
        </section>
      </main>
    );
  }

  if (isGameFinished && showFinalLeaderboard) {
    return (
      <main className="page">
        <header className="hero">
          <p className="eyebrow">Final Result</p>
          <h1>{nickname}, game complete.</h1>
          <p className="total-profit">Overall Profit: ${overallProfit.toLocaleString("en-US")}</p>
        </header>

        <Leaderboard rows={leaderboardRows} title="Final Leaderboard" />

        <button type="button" className="back-to-game" onClick={() => setShowFinalLeaderboard(false)}>
          Back to game
        </button>

        {isAdmin ? (
          <section className="card final-actions">
            <div className="admin-buttons">
              <button type="button" onClick={handleOneMoreHand}>
                One more round?
              </button>
              <button type="button" className="danger" onClick={handleEndGame}>
                End Game
              </button>
            </div>
            {statusMessage ? <p className="status-line">{statusMessage}</p> : null}
            {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
          </section>
        ) : (
          <p className="muted">
            Waiting for the admin to start another round or end the game…
          </p>
        )}
      </main>
    );
  }

  return (
    <main className={`page ${showLeaderboard ? "page-wide" : ""}`}>
      {emojiRaining ? <EmojiRain key={emojiBurstKey} /> : null}
      <header className="hero">
        <p className="eyebrow">EverChic Fashions</p>
        <h1>Welcome, {nickname}</h1>
        <p className="muted">
          {isGameFinished
            ? "Game complete. Review your final round below or head to the leaderboard."
            : "Decide order quantities and submit."}
        </p>
      </header>

      <div className={`game-layout ${showLeaderboard ? "with-leaderboard" : ""}`}>
        <div className="game-main">
      {isAdmin ? (
        <section className="card admin-controls">
          <h3>Admin Controls</h3>
          <p className="muted">Round phase: {roundPhase}</p>
          <div className="distribution-controls">
            <label htmlFor="dist-type">Distribution type</label>
            <select
              id="dist-type"
              value={distributionType}
              onChange={(event) => {
                setDistributionType(event.target.value);
                setHasUnsavedDistributionChanges(true);
              }}
              disabled={roundPhase === "active"}
            >
              <option value="uniform">Uniform</option>
              <option value="normal">Normal</option>
            </select>

            {distributionType === "uniform" ? (
              <>
                <label htmlFor="dist-min">Uniform min</label>
                <input
                  id="dist-min"
                  type="number"
                  value={distributionMin}
                  onChange={(event) => {
                    setDistributionMin(event.target.value);
                    setHasUnsavedDistributionChanges(true);
                  }}
                  disabled={roundPhase === "active"}
                />
                <label htmlFor="dist-max">Uniform max</label>
                <input
                  id="dist-max"
                  type="number"
                  value={distributionMax}
                  onChange={(event) => {
                    setDistributionMax(event.target.value);
                    setHasUnsavedDistributionChanges(true);
                  }}
                  disabled={roundPhase === "active"}
                />
              </>
            ) : (
              <>
                <label htmlFor="dist-mean">Mean</label>
                <input
                  id="dist-mean"
                  type="number"
                  value={distributionMean}
                  onChange={(event) => {
                    setDistributionMean(event.target.value);
                    setHasUnsavedDistributionChanges(true);
                  }}
                  disabled={roundPhase === "active"}
                />
                <label htmlFor="dist-stddev">Std. Deviation</label>
                <input
                  id="dist-stddev"
                  type="number"
                  value={distributionStdDev}
                  onChange={(event) => {
                    setDistributionStdDev(event.target.value);
                    setHasUnsavedDistributionChanges(true);
                  }}
                  disabled={roundPhase === "active"}
                />
              </>
            )}

          </div>
          <div className="price-controls">
            <label htmlFor="price-wholesale">Wholesale Cost</label>
            <input
              id="price-wholesale"
              type="number"
              value={wholesaleCost}
              onChange={(event) => {
                setWholesaleCost(event.target.value);
                setHasUnsavedPriceChanges(true);
              }}
              disabled={roundPhase === "active"}
            />
            <label htmlFor="price-retail">Retail Price</label>
            <input
              id="price-retail"
              type="number"
              value={retailPrice}
              onChange={(event) => {
                setRetailPrice(event.target.value);
                setHasUnsavedPriceChanges(true);
              }}
              disabled={roundPhase === "active"}
            />
            <label htmlFor="price-salvage">Salvage Price</label>
            <input
              id="price-salvage"
              type="number"
              value={salvagePrice}
              onChange={(event) => {
                setSalvagePrice(event.target.value);
                setHasUnsavedPriceChanges(true);
              }}
              disabled={roundPhase === "active"}
            />
          </div>
          <button
            type="button"
            onClick={handleParametersSave}
            disabled={roundPhase === "active"}
          >
            Set Parameters
          </button>
          <div className="admin-buttons">
            <button
              type="button"
              onClick={handleStartRound}
              disabled={!currentRound || roundPhase === "active"}
            >
              Start Round
            </button>
            <button
              type="button"
              onClick={handleEndRound}
              disabled={!currentRound || roundPhase !== "active"}
            >
              End Round
            </button>
          </div>

          {isGameFinished ? (
            <div className="admin-buttons">
              <button type="button" onClick={handleGoToLeaderboard}>
                Go to Leaderboard
              </button>
              <button type="button" onClick={handleOneMoreHand}>
                One more round?
              </button>
            </div>
          ) : null}

          <div className="restart-control">
            {showRestartConfirm ? (
              <div className="restart-confirm">
                <p className="status-line">
                  Are you sure you want to restart? 
                </p>
                <div className="admin-buttons">
                  <button type="button" className="danger" onClick={handleRestartGame}>
                    Yes, restart
                  </button>
                  <button type="button" onClick={() => setShowRestartConfirm(false)}>
                    No
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="danger restart-button"
                onClick={() => setShowRestartConfirm(true)}
              >
                Restart Game
              </button>
            )}
          </div>

          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
          {statusMessage ? <p className="status-line">{statusMessage}</p> : null}

          {adminRoundHistory.length > 0 ? (
            <div className="admin-demand-history">
              <h4>Realized Demands</h4>
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>Round</th>
                    <th>Realized Demand</th>
                  </tr>
                </thead>
                <tbody>
                  {adminRoundHistory.map((entry, i) => (
                    <tr key={i}>
                      <td>{entry.roundNo}</td>
                      <td>{entry.realizedDemand}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {currentRound ? (
        <>
          <ProgressBar currentRound={currentRound.id} totalRounds={totalRounds} />
          <RoundInfo
            round={currentRound}
            totalRounds={totalRounds}
            prices={{
              wholesaleCost: Number(wholesaleCost),
              retailPrice: Number(retailPrice),
              salvagePrice: Number(salvagePrice)
            }}
          />
          <OrderForm
            onSubmit={handleOrderSubmit}
            disabled={isRoundSubmitted || roundPhase !== "active"}
          />
        </>
      ) : null}

      {isRoundSubmitted && roundPhase === "active" ? (
        <section className="card">
          <p className="status-line">Order submitted. Waiting for round to end...</p>
        </section>
      ) : null}

      {roundPhase === "pending" ? <RoundResult result={lastRoundResult || finalRoundResult} /> : null}

      {isGameFinished && !isAdmin ? (
        <section className="card final-actions">
          <p className="status-line">Game complete — the final round is in. </p>
          <button type="button" className="go-to-leaderboard" onClick={handleGoToLeaderboard}>
            Go to Leaderboard
          </button>
        </section>
      ) : null}

      {!isAdmin && statusMessage ? <p className="status-line">{statusMessage}</p> : null}
      {!isAdmin && errorMessage ? <p className="error-text">{errorMessage}</p> : null}

          <section className="card sticky-score">
            <p>Current cumulative profit</p>
            <strong>
              ${(isGameFinished ? overallProfit : cumulativeProfit).toLocaleString("en-US")}
            </strong>
          </section>
        </div>

        <aside className="game-side">
          <button type="button" className="leaderboard-toggle" onClick={handleLeaderboardToggle}>
            {showLeaderboard ? "Hide Leaderboard" : "Show Leaderboard"}
          </button>

          {showLeaderboard ? <Leaderboard rows={leaderboardRows} title="Leaderboard" /> : null}
        </aside>
      </div>
    </main>
  );
}

export default App;
