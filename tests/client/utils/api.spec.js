import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startGame, submitOrder, fetchGameState, fetchLeaderboard } from "../../../src/utils/api.js";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockJson(payload, { ok = true, status = 200, statusText = "OK" } = {}) {
  fetch.mockResolvedValue({ ok, status, statusText, json: async () => payload });
}

describe("api request wrapper", () => {
  it("startGame POSTs to /start-game and returns parsed json", async () => {
    mockJson({ gameId: "g1", playerId: "p1" });

    const result = await startGame({ nickname: "Alice", adminKey: "admin123" });

    expect(result).toEqual({ gameId: "g1", playerId: "p1" });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/start-game$/);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toMatchObject({ nickname: "Alice", adminKey: "admin123" });
  });

  it("throws the server-provided error message on a non-ok response", async () => {
    mockJson({ error: "this username is taken" }, { ok: false, status: 409, statusText: "Conflict" });

    await expect(startGame({ nickname: "Alice" })).rejects.toThrow("this username is taken");
  });

  it("submitOrder sends gameId, playerId and orderQuantity", async () => {
    mockJson({ accepted: true });

    await submitOrder({ gameId: "g1", playerId: "p1", orderQuantity: 100 });

    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/\/submit-order$/);
    expect(JSON.parse(options.body)).toEqual({ gameId: "g1", playerId: "p1", orderQuantity: 100 });
  });

  it("fetchGameState builds a query string from the params", async () => {
    mockJson({ gameId: "g1" });

    await fetchGameState({ gameId: "g1", playerId: "p1", adminToken: "tok" });

    const [url] = fetch.mock.calls[0];
    expect(url).toContain("gameId=g1");
    expect(url).toContain("playerId=p1");
    expect(url).toContain("adminToken=tok");
  });

  it("fetchLeaderboard only sends gameId", async () => {
    mockJson({ leaderboard: [] });

    await fetchLeaderboard({ gameId: "g1" });

    const [url] = fetch.mock.calls[0];
    expect(url).toMatch(/\/leaderboard\?gameId=g1$/);
  });
});
