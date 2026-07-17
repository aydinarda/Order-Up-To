import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const supabase = hasSupabaseConfig
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

async function runQuery(label, queryFactory) {
  if (!supabase) {
    return;
  }

  try {
    const { error } = await queryFactory();

    if (error) {
      console.error(`[db] ${label} failed:`, error.message, `| code: ${error.code} | details: ${error.details} | hint: ${error.hint}`);
    }
  } catch (error) {
    console.error(`[db] ${label} threw:`, error.message);
  }
}

export function isDbEnabled() {
  return Boolean(supabase);
}

export async function recordGameCreated({ gameId, adminPlayerId, createdAt }) {
  await runQuery("recordGameCreated", () =>
    supabase.from("games").upsert(
      {
        game_id: gameId,
        admin_player_id: adminPlayerId,
        created_at: createdAt
      },
      { onConflict: "game_id" }
    )
  );
}

export async function recordPlayerJoined({ gameId, playerId, nickname, isAdmin, joinedAt }) {
  await runQuery("recordPlayerJoined", () =>
    supabase.from("players").upsert(
      {
        game_id: gameId,
        player_id: playerId,
        nickname,
        is_admin: isAdmin,
        joined_at: joinedAt
      },
      { onConflict: "game_id,player_id" }
    )
  );
}

export async function recordRoundStarted({
  gameId,
  turNo,
  roundId,
  roundNo,
  distribution,
  config,
  realizedDemand,
  delayed = false,
  startedAt
}) {
  await runQuery("recordRoundStarted", () =>
    supabase.from("rounds").upsert(
      {
        game_id: gameId,
        tur_no: turNo,
        round_id: String(roundId),
        round_no: roundNo,
        dist_type: distribution.type,
        dist_min: distribution.min,
        dist_max: distribution.max,
        dist_mean: distribution.mean ?? null,
        dist_std_dev: distribution.stdDev ?? null,
        config_json: config,
        seed: config.seed ?? null,
        realized_demand: realizedDemand,
        delayed,
        started_at: startedAt
      },
      { onConflict: "game_id,tur_no,round_id" }
    )
  );
}

// Round bitince TÜM order'lar tek bulk upsert ile yazılır.
// Submit anında DB'ye dokunulmaz; veri bellekteki activeRoundOrders'tan gelir.
export async function recordRoundEnded({ gameId, turNo, roundId, realizedDemand, endedAt, results }) {
  await runQuery("recordRoundEnded.round", () =>
    supabase
      .from("rounds")
      .update({
        realized_demand: realizedDemand,
        ended_at: endedAt
      })
      .eq("game_id", gameId)
      .eq("tur_no", turNo)
      .eq("round_id", String(roundId))
  );

  if (results.length === 0) {
    return;
  }

  await runQuery("recordRoundEnded.orders", () =>
    supabase.from("orders").upsert(
      results.map((result) => ({
        game_id: gameId,
        tur_no: turNo,
        round_id: String(roundId),
        player_id: result.playerId,
        nickname: result.nickname,
        order_qty: result.orderQty,
        delivery_mode: result.mode,
        arrival: result.arrival,
        sold: result.sold,
        lost: result.lost,
        on_hand_end: result.onHandEnd,
        in_transit: result.inTransit,
        trucks: result.trucks,
        co2_transport: result.co2Transport,
        co2_storage: result.co2Storage,
        profit: result.profit,
        submitted_at: result.submittedAt
      })),
      { onConflict: "game_id,tur_no,round_id,player_id" }
    )
  );
}
