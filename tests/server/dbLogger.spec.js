import { describe, it, expect, beforeEach, vi } from "vitest";

// Set Supabase env + build a chainable recording client BEFORE dbLogger imports.
// vi.hoisted runs before the module imports below.
const { client, recorded } = vi.hoisted(() => {
  process.env.SUPABASE_URL = "http://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  const recorded = [];
  const client = {
    from: vi.fn((table) => {
      const builder = {
        upsert: vi.fn((rows, opts) => {
          recorded.push({ op: "upsert", table, rows, opts });
          return builder;
        }),
        insert: vi.fn((row) => {
          recorded.push({ op: "insert", table, row });
          return builder;
        }),
        update: vi.fn((patch) => {
          recorded.push({ op: "update", table, patch });
          return builder;
        }),
        eq: vi.fn(() => builder),
        // make the query builder awaitable (resolves like a successful supabase call)
        then: (resolve) => resolve({ error: null })
      };
      return builder;
    })
  };

  return { client, recorded };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => client)
}));

const { isDbEnabled, recordGameCreated, recordRoundStarted, recordRoundEnded } = await import(
  "../../server/dbLogger.js"
);

beforeEach(() => {
  recorded.length = 0;
});

describe("dbLogger", () => {
  it("reports the DB as enabled when env is configured", () => {
    expect(isDbEnabled()).toBe(true);
  });

  it("recordGameCreated upserts into games", async () => {
    await recordGameCreated({ gameId: "g1", adminPlayerId: "p1", createdAt: "2026-01-01T00:00:00Z" });

    const upserts = recorded.filter((r) => r.op === "upsert" && r.table === "games");
    expect(upserts).toHaveLength(1);
    expect(upserts[0].rows).toMatchObject({ game_id: "g1", admin_player_id: "p1" });
    expect(upserts[0].opts).toEqual({ onConflict: "game_id" });
  });

  it("recordRoundStarted upserts into rounds with distribution + prices", async () => {
    await recordRoundStarted({
      gameId: "g1",
      turNo: 1,
      roundId: 2,
      roundNo: 2,
      distribution: { type: "uniform", min: 80, max: 120 },
      prices: { wholesaleCost: 10, retailPrice: 40, salvagePrice: 5 },
      realizedDemand: 100,
      startedAt: "2026-01-01T00:00:00Z"
    });

    const upserts = recorded.filter((r) => r.op === "upsert" && r.table === "rounds");
    expect(upserts).toHaveLength(1);
    expect(upserts[0].rows).toMatchObject({
      game_id: "g1",
      round_id: "2",
      dist_type: "uniform",
      realized_demand: 100,
      retail_price: 40
    });
  });

  it("recordRoundEnded writes a SINGLE bulk upsert for all orders", async () => {
    await recordRoundEnded({
      gameId: "g1",
      turNo: 1,
      roundId: 3,
      realizedDemand: 100,
      endedAt: "2026-01-01T00:00:00Z",
      results: [
        { playerId: "p1", nickname: "Alice", orderQuantity: 120, sold: 100, leftover: 20, stockout: 0, profit: 3000, submittedAt: "t1" },
        { playerId: "p2", nickname: "Bob", orderQuantity: 90, sold: 90, leftover: 0, stockout: 10, profit: 2700, submittedAt: "t2" }
      ]
    });

    const orderUpserts = recorded.filter((r) => r.op === "upsert" && r.table === "orders");
    expect(orderUpserts).toHaveLength(1);
    expect(orderUpserts[0].rows).toHaveLength(2);
    expect(orderUpserts[0].opts).toEqual({ onConflict: "game_id,tur_no,round_id,player_id" });
    expect(orderUpserts[0].rows[0]).toMatchObject({
      game_id: "g1",
      tur_no: 1,
      round_id: "3",
      player_id: "p1",
      nickname: "Alice",
      order_qty: 120,
      sold: 100,
      leftover: 20,
      stockout: 0,
      profit: 3000,
      submitted_at: "t1"
    });

    // the rounds row is also updated
    expect(recorded.filter((r) => r.op === "update" && r.table === "rounds")).toHaveLength(1);

    // granular session_events logging was removed
    expect(recorded.some((r) => r.table === "session_events")).toBe(false);
  });

  it("recordRoundEnded skips the orders upsert when there are no orders", async () => {
    await recordRoundEnded({
      gameId: "g1",
      turNo: 1,
      roundId: 1,
      realizedDemand: 100,
      endedAt: "2026-01-01T00:00:00Z",
      results: []
    });

    expect(recorded.filter((r) => r.table === "orders")).toHaveLength(0);
    expect(recorded.filter((r) => r.op === "update" && r.table === "rounds")).toHaveLength(1);
  });
});
