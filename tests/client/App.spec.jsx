import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/utils/api.js", () => ({
  startGame: vi.fn(),
  submitOrder: vi.fn(),
  fetchGameState: vi.fn(),
  fetchLeaderboard: vi.fn(),
  startRound: vi.fn(),
  endRound: vi.fn(),
  setDistribution: vi.fn(),
  setPrices: vi.fn()
}));

vi.mock("../../src/utils/sessionStorage.js", () => ({
  saveGameSession: vi.fn(),
  loadGameSession: vi.fn(() => null),
  clearGameSession: vi.fn(),
  updateUrlWithSession: vi.fn(),
  getSessionFromUrl: vi.fn(() => null),
  clearUrlSession: vi.fn()
}));

import App from "../../src/App.jsx";
import * as api from "../../src/utils/api.js";
import * as session from "../../src/utils/sessionStorage.js";

class MockWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this._listeners = {};
    MockWebSocket.instances.push(this);
    queueMicrotask(() => this._emit("open"));
  }

  addEventListener(type, cb) {
    (this._listeners[type] ||= []).push(cb);
  }

  removeEventListener(type, cb) {
    this._listeners[type] = (this._listeners[type] || []).filter((fn) => fn !== cb);
  }

  send() {}

  close() {
    this.readyState = 3;
    this._emit("close");
  }

  _emit(type, event) {
    (this._listeners[type] || []).forEach((cb) => cb(event));
  }
}

const prices = { wholesaleCost: 10, retailPrice: 40, salvagePrice: 5 };
const distribution = { type: "uniform", min: 80, max: 120 };

const baseGameState = {
  gameId: "g1",
  roundPhase: "active",
  currentRound: { id: 1, title: "Hand 1", distribution },
  totalRounds: 5,
  totalTurs: 1,
  currentTurIndex: 0,
  distribution,
  prices,
  finished: false,
  player: {
    id: "p1",
    nickname: "Alice",
    roundsPlayed: 0,
    cumulativeProfit: 0,
    overallProfit: 0,
    history: [],
    turHistory: [],
    lastRoundResult: null,
    submittedThisRound: false
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  session.loadGameSession.mockReturnValue(null);
  session.getSessionFromUrl.mockReturnValue(null);
  api.fetchGameState.mockResolvedValue(baseGameState);
  api.fetchLeaderboard.mockResolvedValue({ leaderboard: [] });
});

describe("App", () => {
  it("shows the join screen when there is no session", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /everchic fashions/i })).toBeInTheDocument();
    expect(screen.getByText(/hawaiian shirt newsvendor game/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/nickname/i)).toBeInTheDocument();
  });

  it("shows a clear error and does not call the API when no nickname is entered", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /start game/i }));

    expect(await screen.findByText(/please enter a nickname/i)).toBeInTheDocument();
    expect(api.startGame).not.toHaveBeenCalled();
  });

  it("joins a game and renders the player view", async () => {
    api.startGame.mockResolvedValue({
      gameId: "g1",
      playerId: "p1",
      nickname: "Alice",
      adminToken: undefined,
      currentRound: { id: 1, title: "Hand 1", distribution },
      roundPhase: "active",
      distribution,
      prices,
      totalRounds: 5,
      totalTurs: 1,
      currentTurIndex: 0,
      roundsPlayed: 0,
      cumulativeProfit: 0
    });
    api.fetchLeaderboard.mockResolvedValue({ leaderboard: [] });

    render(<App />);
    await userEvent.type(screen.getByLabelText(/nickname/i), "Alice");
    await userEvent.click(screen.getByRole("button", { name: /start game/i }));

    expect(await screen.findByText("Welcome, Alice")).toBeInTheDocument();
    expect(api.startGame).toHaveBeenCalledWith(
      expect.objectContaining({ nickname: "Alice" })
    );
  });

  it("restores a finished session to the main screen, then opens the Final Leaderboard on demand", async () => {
    session.loadGameSession.mockReturnValue({
      gameId: "g1",
      playerId: "p1",
      nickname: "Alice",
      isAdmin: false,
      adminToken: ""
    });

    api.fetchGameState.mockResolvedValue({
      ...baseGameState,
      roundPhase: "pending",
      currentRound: null,
      finished: true,
      currentTurIndex: 1,
      player: {
        ...baseGameState.player,
        overallProfit: 6420,
        turHistory: [{ turNumber: 1, cumulativeProfit: 6420, rounds: [] }]
      }
    });
    api.fetchLeaderboard.mockResolvedValue({
      leaderboard: [
        { rank: 1, nickname: "Alice", cumulativeProfit: 6420 },
        { rank: 2, nickname: "Bob", cumulativeProfit: 3190 }
      ]
    });

    render(<App />);

    // Finished games no longer auto-route to the leaderboard: the main screen
    // stays put and only offers a button to go there.
    expect(await screen.findByText("Welcome, Alice")).toBeInTheDocument();
    const goButton = await screen.findByRole("button", { name: /go to leaderboard/i });
    expect(screen.queryByRole("heading", { name: "Final Leaderboard" })).toBeNull();
    // The per-player history is reset server-side at game end, so the running
    // total on the main screen must fall back to the preserved overall profit.
    expect(await screen.findByText("$6,420")).toBeInTheDocument();

    await userEvent.click(goButton);

    expect(
      await screen.findByRole("heading", { name: "Final Leaderboard" })
    ).toBeInTheDocument();
    expect(await screen.findByText("$3,190")).toBeInTheDocument();
  });

  it("rains emojis when the hand changes", async () => {
    api.startGame.mockResolvedValue({
      gameId: "g1",
      playerId: "p1",
      nickname: "Alice",
      adminToken: undefined,
      currentRound: { id: 1, title: "Hand 1", distribution },
      roundPhase: "active",
      distribution,
      prices,
      totalRounds: 5,
      totalTurs: 1,
      currentTurIndex: 0,
      roundsPlayed: 0,
      cumulativeProfit: 0
    });

    render(<App />);
    await userEvent.type(screen.getByLabelText(/nickname/i), "Alice");
    await userEvent.click(screen.getByRole("button", { name: /start game/i }));
    await screen.findByText("Welcome, Alice");

    await waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThan(0));
    const ws = MockWebSocket.instances[0];

    // A round_started event that advances the hand id triggers the emoji burst.
    await act(async () => {
      ws._emit("message", {
        data: JSON.stringify({
          type: "game_event",
          payload: {
            type: "round_started",
            roundPhase: "active",
            currentRound: { id: 2, title: "Hand 2", distribution }
          }
        })
      });
    });

    await waitFor(() => expect(document.querySelector(".emoji-rain")).not.toBeNull());
  });
});
