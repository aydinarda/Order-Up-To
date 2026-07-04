import { describe, it, expect, beforeEach } from "vitest";
import {
  saveGameSession,
  loadGameSession,
  clearGameSession,
  updateUrlWithSession,
  getSessionFromUrl,
  clearUrlSession
} from "../../../src/utils/sessionStorage.js";

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("game session localStorage", () => {
  it("saves and loads a session with a timestamp", () => {
    saveGameSession({
      gameId: "g1",
      playerId: "p1",
      nickname: "Alice",
      isAdmin: true,
      adminToken: "tok",
      roundPhase: "pending"
    });

    const restored = loadGameSession();
    expect(restored).toMatchObject({
      gameId: "g1",
      playerId: "p1",
      nickname: "Alice",
      isAdmin: true,
      adminToken: "tok",
      roundPhase: "pending"
    });
    expect(typeof restored.timestamp).toBe("number");
  });

  it("returns null when nothing is stored", () => {
    expect(loadGameSession()).toBeNull();
  });

  it("clears a stored session", () => {
    saveGameSession({ gameId: "g1", playerId: "p1" });
    clearGameSession();
    expect(loadGameSession()).toBeNull();
  });
});

describe("URL session params", () => {
  it("writes gameId and playerId to the URL", () => {
    updateUrlWithSession("g1", "p1");
    expect(getSessionFromUrl()).toEqual({ gameId: "g1", playerId: "p1" });
  });

  it("returns null when params are missing", () => {
    expect(getSessionFromUrl()).toBeNull();
  });

  it("clears the URL params", () => {
    updateUrlWithSession("g1", "p1");
    clearUrlSession();
    expect(getSessionFromUrl()).toBeNull();
  });
});
