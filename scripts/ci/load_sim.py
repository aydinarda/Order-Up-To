#!/usr/bin/env python3
"""N-oyunculu eş zamanlı order-up-to simülasyonu (OrderUpToGame).

.github/workflows/load-sim.yml bunu çalıştırır; lokalde de aynı kod çalışır:

    BASE_URL=http://localhost:4000 N_PLAYERS=50 N_HANDS=8 python3 scripts/ci/load_sim.py

Yalnızca standart kütüphane (Python >= 3.9): istekler bir thread havuzunda
eş zamanlı atılır (MAX_CONCURRENCY, varsayılan 120).

Oyun akışı:
  Hand 1      priming turu (talep yok); admin herkese +100 başlangıç stoğu ekler
  Hand 3      admin hızlı kamyonu açar
  Hand 4      tur ortasında Pareto ikilisi Service level vs Backorders'a geçer
  Hand 6      admin kamyonu kapatır
Her hand'de tüm oyuncular /game-state çeker ve kendi stok/yoldaki mal/eklenen
stok bilgisine göre persona kuralıyla sipariş verir (k6/lib/bots.js ile aynı):

  Base   base-stock: S = (L+1)μ + 0.97σ√(L+1), q = S − envanter pozisyonu
  Safe   aynısı, z = 2 (yüksek servis, fazla stok)
  Green  z = 0, yalnızca dolu gemi (düşük taşıma CO₂'si)
  Truck  Base + kamyon açıksa bu turun açığını kamyonla kapatır
  Naive  eğitimsiz öğrenci: her tur μ ± %40
"""

import asyncio
import csv
import json
import math
import os
import random
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

BASE = os.environ.get("BASE_URL", "http://localhost:4000").rstrip("/")
ADMIN_KEY = os.environ.get("ADMIN_KEY", "admin123")
OUT = os.environ.get("RESULTS_DIR", "results")
N_PLAYERS = int(os.environ.get("N_PLAYERS", "50"))
N_HANDS = int(os.environ.get("N_HANDS", "8"))
EXECUTOR = ThreadPoolExecutor(max_workers=int(os.environ.get("MAX_CONCURRENCY", "120")))

STOCK_ADD = 100
PERSONAS = ["Base", "Safe", "Green", "Truck", "Naive"]
PERSONA_DESC = {
    "Base": "Base-stock (z=0.97)",
    "Safe": "Yüksek servis (z=2)",
    "Green": "Dolu gemi / düşük CO₂",
    "Truck": "Kamyonla kurtarıcı",
    "Naive": "Eğitimsiz (μ±%40)",
}


def nickname(i):
    return f"{PERSONAS[i % len(PERSONAS)]}{i + 1:03d}"


# ─── Persona kararları ─────────────────────────────────────────────────────────
def demand_stats(d):
    d = d or {}
    if d.get("type") == "normal":
        return d.get("mean", 100), d.get("stdDev", 0)
    lo, hi = d.get("min", 80), d.get("max", 120)
    return (lo + hi) / 2, (hi - lo) / math.sqrt(12)


def decide(persona, gs):
    """(ship, truck) miktarı — oyuncunun kendi /game-state yanıtından."""
    cfg = gs.get("config") or {}
    inv = (gs.get("player") or {}).get("inventory") or {}
    current = gs.get("currentRound") or {}
    mean, sd = demand_stats(gs.get("distribution") or current.get("distribution"))
    priming = current.get("id") == 1
    lead = 1 if priming else (cfg.get("leadTime") or 2)
    on_hand = inv.get("onHand", 0) + (gs.get("pendingStockAdded") or 0)
    position = on_hand + inv.get("inTransit", 0)

    def up_to(z):
        return max(0, int(round((lead + 1) * mean + z * sd * math.sqrt(lead + 1))) - position)

    if persona == "Naive":
        return max(0, int(round(mean * (0.6 + random.random() * 0.8)))), 0
    if persona == "Safe":
        return up_to(2), 0
    if persona == "Green":
        cap = cfg.get("shipCapacity") or 100
        need = up_to(0)
        return (math.ceil(need / cap) * cap if need >= 0.8 * cap else 0), 0
    ship = up_to(0.97)
    if persona == "Truck" and cfg.get("expressEnabled") and not priming:
        landing = on_hand + ((inv.get("pipeline") or [0])[0] or 0)
        return ship, max(0, int(round(mean - landing)))
    return ship, 0


# ─── İstek logu ────────────────────────────────────────────────────────────────
req_log = []


def log_req(phase, hand, player, endpoint, method, status, lat_s):
    req_log.append({
        "timestamp": datetime.now(timezone.utc).strftime("%H:%M:%S.%f")[:-3],
        "phase": phase,
        "hand": hand if hand is not None else "",
        "player": player,
        "endpoint": endpoint,
        "method": method,
        "status": status,
        "latency_ms": round(lat_s * 1000, 1),
        "ok": 1 if 200 <= (status or 0) < 300 else 0,
    })


# ─── HTTP yardımcıları ─────────────────────────────────────────────────────────
def _http(method, path, body):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            status, raw = res.status, res.read()
    except urllib.error.HTTPError as err:
        status, raw = err.code, err.read()
    except Exception as err:  # bağlantı hatası / zaman aşımı
        return 0, {"_err": str(err)}
    try:
        parsed = json.loads(raw.decode() or "{}")
        if not isinstance(parsed, dict):
            return status, {"_err": f"dict değil: {type(parsed).__name__}"}
        return status, parsed
    except json.JSONDecodeError as err:
        return status, {"_err": f"JSON parse: {err}", "_raw": raw[:200].decode(errors="replace")}


async def request(method, path, body=None, phase="", hand=None, player=""):
    loop = asyncio.get_running_loop()
    t0 = time.perf_counter()
    status, data = await loop.run_in_executor(EXECUTOR, _http, method, path, body)
    lat = time.perf_counter() - t0
    log_req(phase, hand, player, path, method, status, lat)
    return data, lat, status


def require(d, status, label, *keys):
    if status != 200 or "_err" in d or any(k not in d for k in keys):
        print(f"  FATAL [{label}]: HTTP {status} {json.dumps(d)[:300]}", flush=True)
        sys.exit(1)


# ─── İstatistik yardımcıları ───────────────────────────────────────────────────
def pct(lst, p):
    if not lst:
        return 0.0
    s = sorted(lst)
    return s[min(int(len(s) * p / 100), len(s) - 1)]


def lat_stats(lats_s):
    if not lats_s:
        return {"min": 0, "avg": 0, "p50": 0, "p95": 0, "max": 0, "n": 0}
    ms = [x * 1000 for x in lats_s]
    return {
        "min": round(min(ms), 1), "avg": round(statistics.mean(ms), 1),
        "p50": round(pct(ms, 50), 1), "p95": round(pct(ms, 95), 1),
        "max": round(max(ms), 1), "n": len(ms),
    }


def lat_line(st, label):
    return (f"  {label:<30}: min={st['min']:6.0f}ms  avg={st['avg']:6.0f}ms  "
            f"p95={st['p95']:6.0f}ms  max={st['max']:6.0f}ms  n={st['n']}")


def fmt_service(value):
    return "—" if value is None else f"%{round(value)}"


# ═══════════════════════════════════════════════════════════════════════════════
async def main():
    os.makedirs(OUT, exist_ok=True)
    sim_start = datetime.now(timezone.utc)
    total_t0 = time.perf_counter()
    join_rows, hand_rows, final_rows, demand_log = [], [], [], []

    # ═══ AŞAMA 1: Oyun oluştur (admin) ═══════════════════════════════════════
    print("\n" + "=" * 66)
    print(f"AŞAMA 1 – Oyun oluştur ({N_PLAYERS} oyuncu, {N_HANDS} hand) → {BASE}")
    d, lat, st = await request("POST", "/start-game", {
        "nickname": "admin_sim", "adminKey": ADMIN_KEY, "handsPerTur": N_HANDS,
    }, phase="setup")
    require(d, st, "start-game/admin", "gameId", "adminToken")
    game_id, admin_token, admin_pid = d["gameId"], d["adminToken"], d["playerId"]
    print(f"  gameId={game_id}  latency={lat * 1000:.0f}ms")

    # ═══ AŞAMA 2: N oyuncu eş zamanlı katılır ════════════════════════════════
    print("\n" + "=" * 66)
    print(f"AŞAMA 2 – {N_PLAYERS} oyuncu eş zamanlı katılıyor")
    t0 = time.perf_counter()
    join_results = await asyncio.gather(*[
        request("POST", "/start-game", {"nickname": nickname(i), "gameId": game_id},
                phase="join", player=nickname(i))
        for i in range(N_PLAYERS)
    ])
    join_wall = time.perf_counter() - t0

    players, join_lats, join_errs = {}, [], 0
    for i, (data, lat, st) in enumerate(join_results):
        success = st == 200 and "playerId" in data
        persona = PERSONAS[i % len(PERSONAS)]
        join_rows.append({
            "player_index": i, "nickname": nickname(i), "persona": persona,
            "persona_desc": PERSONA_DESC[persona], "player_id": data.get("playerId", "") if success else "",
            "status_code": st, "latency_ms": round(lat * 1000, 1), "success": 1 if success else 0,
            "error": "" if success else json.dumps(data)[:200],
        })
        if success:
            players[i] = {"player_id": data["playerId"], "nickname": nickname(i), "persona": persona}
            join_lats.append(lat)
        else:
            join_errs += 1
            print(f"  ✗ {nickname(i)} katılım başarısız: HTTP {st}")

    print(f"  Duvar süresi   : {join_wall:.2f}s")
    print(f"  Başarılı       : {len(players)}/{N_PLAYERS}  |  Hata: {join_errs}")
    print(lat_line(lat_stats(join_lats), "  JOIN gecikmesi"))
    if len(players) < 2:
        print("FATAL: en az 2 oyuncu gerekli", flush=True)
        sys.exit(1)

    roster = [players[i] for i in sorted(players)]
    all_sub_lats, all_state_lats = [], []
    truck_on = False
    pareto = ("co2", "profit")

    # ═══ AŞAMA 3: Tüm handları oyna ══════════════════════════════════════════
    for hand in range(1, N_HANDS + 1):
        print("\n" + "-" * 66)
        print(f"  HAND {hand}/{N_HANDS}" + ("  (priming — talep yok)" if hand == 1 else ""))
        hand_t0 = time.perf_counter()
        events = []

        # 3a. Admin olayları (turlar arasında)
        if hand == 1:
            d, _, st = await request("POST", "/add-stock",
                                     {"gameId": game_id, "adminToken": admin_token, "qty": STOCK_ADD},
                                     phase="admin", hand=hand)
            require(d, st, "add-stock", "pendingStockAdded")
            events.append(f"+{STOCK_ADD} başlangıç stoğu")
        if hand in (3, 6):
            truck_on = hand == 3
            d, _, st = await request("POST", "/set-config",
                                     {"gameId": game_id, "adminToken": admin_token, "expressEnabled": truck_on},
                                     phase="admin", hand=hand)
            require(d, st, "truck toggle", "config")
            events.append("kamyon açıldı" if truck_on else "kamyon kapandı")

        # 3b. Admin turu başlatır
        d, start_lat, st = await request("POST", "/start-round",
                                         {"gameId": game_id, "adminToken": admin_token},
                                         phase="start-round", hand=hand)
        require(d, st, f"start-round h{hand}", "roundPhase")
        print(f"  start-round: {start_lat * 1000:.0f}ms  phase={d.get('roundPhase')}")

        # 3c. Tüm oyuncular eş zamanlı /game-state çeker
        t0 = time.perf_counter()
        state_res = await asyncio.gather(*[
            request("GET", f"/game-state?gameId={game_id}&playerId={p['player_id']}",
                    phase="poll", hand=hand, player=p["nickname"])
            for p in roster
        ])
        state_wall = time.perf_counter() - t0
        state_lats = [lat for _, lat, s in state_res if s == 200]
        state_errs = sum(1 for _, _, s in state_res if s != 200)
        ss = lat_stats(state_lats)
        all_state_lats.extend(state_lats)
        print(f"  GET /game-state: duvar={state_wall:.2f}s  hata={state_errs}")
        print(lat_line(ss, "    gecikme"))

        # 3d. Tur ortası: Pareto ikilisi değişir (aktif turda da serbest)
        rerank_ms = None
        if hand == 4:
            pareto = ("backorders", "serviceLevel")
            d, rerank_lat, st = await request(
                "POST", "/set-config",
                {"gameId": game_id, "adminToken": admin_token, "paretoX": pareto[0], "paretoY": pareto[1]},
                phase="admin", hand=hand)
            require(d, st, "pareto switch", "config")
            rerank_ms = round(rerank_lat * 1000, 1)
            events.append(f"Pareto → Service vs Backorders ({rerank_ms:.0f}ms)")

        # 3e. Persona kararları + eş zamanlı sipariş
        decisions = [decide(p["persona"], gs) if s == 200 else (0, 0)
                     for p, (gs, _, s) in zip(roster, state_res)]
        t0 = time.perf_counter()
        submit_res = await asyncio.gather(*[
            request("POST", "/submit-order",
                    {"gameId": game_id, "playerId": p["player_id"], "orderQty": ship, "expressQty": truck},
                    phase="submit", hand=hand, player=p["nickname"])
            for p, (ship, truck) in zip(roster, decisions)
        ])
        submit_wall = time.perf_counter() - t0
        sub_lats = [lat for _, lat, s in submit_res if s == 200]
        sub_errs = sum(1 for _, _, s in submit_res if s != 200)
        subs = lat_stats(sub_lats)
        all_sub_lats.extend(sub_lats)
        ship_units = sum(ship for ship, _ in decisions)
        truck_units = sum(truck for _, truck in decisions)
        print(f"  POST /submit-order: duvar={submit_wall:.2f}s  hata={sub_errs}  "
              f"gemi={ship_units} kg  kamyon={truck_units} kg")
        print(lat_line(subs, "    gecikme"))

        # 3f. Admin turu bitirir
        d, end_lat, st = await request("POST", "/end-round",
                                       {"gameId": game_id, "adminToken": admin_token},
                                       phase="end-round", hand=hand)
        require(d, st, f"end-round h{hand}", "roundPhase")
        realized = d.get("realizedDemand")
        demand_log.append({"hand": hand, "realizedDemand": realized})
        rows = d.get("leaderboard") or []
        front1 = sum(1 for r in rows if r.get("front") == 1)
        print(f"  end-round: {end_lat * 1000:.0f}ms  gerçekleşen talep="
              f"{'— (priming)' if realized is None else realized}  front-1={front1}/{len(rows)}")
        if events:
            print("  olaylar: " + "; ".join(events))

        hand_rows.append({
            "hand": hand, "realized_demand": realized, "events": "; ".join(events),
            "truck_on": int(truck_on), "pareto": f"{pareto[1]}/{pareto[0]}",
            "ship_units": ship_units, "truck_units": truck_units, "front1": front1,
            "rerank_ms": rerank_ms, "hand_wall_s": round(time.perf_counter() - hand_t0, 3),
            "start_round_ms": round(start_lat * 1000, 1), "state_wall_s": round(state_wall, 3),
            "state_min_ms": ss["min"], "state_avg_ms": ss["avg"], "state_p95_ms": ss["p95"],
            "state_max_ms": ss["max"], "state_errors": state_errs, "submit_wall_s": round(submit_wall, 3),
            "submit_min_ms": subs["min"], "submit_avg_ms": subs["avg"], "submit_p95_ms": subs["p95"],
            "submit_max_ms": subs["max"], "submit_errors": sub_errs, "end_round_ms": round(end_lat * 1000, 1),
        })

    # ═══ AŞAMA 4: Son liderboard ═════════════════════════════════════════════
    print("\n" + "=" * 66)
    print("AŞAMA 4 – Son liderboard")
    lb_d, _, st = await request("GET", f"/leaderboard?gameId={game_id}", phase="leaderboard")
    require(lb_d, st, "leaderboard", "leaderboard")
    persona_by_nick = {p["nickname"]: p["persona"] for p in roster}
    for row in lb_d["leaderboard"]:
        final_rows.append({
            "rank": row["rank"], "front": row["front"], "nickname": row["nickname"],
            "persona": persona_by_nick.get(row["nickname"], "admin"),
            "cumulative_profit": round(row["cumProfit"]), "cum_co2_kg": round(row["cumCo2"], 1),
            "service_level_pct": None if row["serviceLevelPct"] is None else round(row["serviceLevelPct"], 1),
            "cum_backorders": row["cumBackorders"],
            "fleet_fill_pct": None if row.get("fleetFillPct") is None else round(row["fleetFillPct"], 1),
            "rounds_played": row["roundsPlayed"],
        })
    for row in final_rows[:10]:
        print(f"  #{row['rank']:<3} front {row['front']}  {row['nickname']:<9} ${row['cumulative_profit']:>9,}  "
              f"{row['cum_co2_kg']:>7.0f} kg  servis {fmt_service(row['service_level_pct']):>5}  "
              f"backorder {row['cum_backorders']}")

    # ═══ AŞAMA 5: Doğrulamalar ═══════════════════════════════════════════════
    print("\n" + "=" * 66)
    print("AŞAMA 5 – Doğrulama")
    gs_d, _, st = await request(
        "GET", f"/game-state?gameId={game_id}&adminToken={admin_token}&playerId={admin_pid}", phase="verify")
    require(gs_d, st, "admin game-state", "roundHistory")
    rh = gs_d["roundHistory"]
    assert len(rh) == N_HANDS, f"Beklenen {N_HANDS} kayıt, bulunan {len(rh)}"
    assert rh[0]["realizedDemand"] is None, "Hand 1 (priming) talep kaydetmemeli"
    for entry in rh[1:]:
        assert isinstance(entry["realizedDemand"], (int, float)), f"realizedDemand sayı değil: {entry}"
    archived = ((gs_d.get("player") or {}).get("turHistory") or [{}])[-1].get("rounds") or []
    assert archived and archived[0].get("addedQty") == STOCK_ADD, "başlangıç stoğu hand 1'de inmedi"
    assert all(r["front"] >= 1 for r in final_rows), "liderboard satırında front eksik"
    print(f"  PASS – {N_HANDS} hand'in talebi kayıtlı (hand 1 priming), +{STOCK_ADD} stok hand 1'de indi")

    # ═══ Artifact dosyaları ══════════════════════════════════════════════════
    total_time = time.perf_counter() - total_t0

    def write_csv(name, rows, fields):
        with open(f"{OUT}/{name}_{N_PLAYERS}p.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)

    write_csv("requests_log", req_log,
              ["timestamp", "phase", "hand", "player", "endpoint", "method", "status", "latency_ms", "ok"])
    write_csv("join_results", join_rows,
              ["player_index", "nickname", "persona", "persona_desc", "player_id", "status_code",
               "latency_ms", "success", "error"])
    hand_fields = list(hand_rows[0].keys()) if hand_rows else []
    write_csv("hands_timing", hand_rows, hand_fields)
    write_csv("leaderboard", final_rows,
              ["rank", "front", "nickname", "persona", "cumulative_profit", "cum_co2_kg",
               "service_level_pct", "cum_backorders", "fleet_fill_pct", "rounds_played"])

    persona_analysis = {}
    for persona in PERSONAS:
        rows = [r for r in final_rows if r["persona"] == persona]
        if not rows:
            continue
        services = [r["service_level_pct"] for r in rows if r["service_level_pct"] is not None]
        persona_analysis[persona] = {
            "desc": PERSONA_DESC[persona], "n": len(rows),
            "avg_profit": round(statistics.mean(r["cumulative_profit"] for r in rows), 1),
            "avg_co2_kg": round(statistics.mean(r["cum_co2_kg"] for r in rows), 1),
            "avg_service_pct": round(statistics.mean(services), 1) if services else None,
            "avg_backorders": round(statistics.mean(r["cum_backorders"] for r in rows), 1),
            "front1": sum(1 for r in rows if r["front"] == 1),
        }

    report = {
        "meta": {
            "sim_start_utc": sim_start.isoformat(), "base_url": BASE, "n_players": N_PLAYERS,
            "n_hands": N_HANDS, "total_time_s": round(total_time, 2), "players_joined": len(players),
            "join_errors": join_errs, "total_requests": len(req_log),
            "total_errors": sum(1 for r in req_log if not r["ok"]),
            "final_pareto_pair": f"{pareto[1]} vs {pareto[0]}",
        },
        "join_phase": {"wall_s": round(join_wall, 3), "latency": lat_stats(join_lats)},
        "overall_latency": {"state_GET": lat_stats(all_state_lats), "submit_POST": lat_stats(all_sub_lats)},
        "demand_log": demand_log,
        "hands": hand_rows,
        "persona_analysis": persona_analysis,
        "leaderboard": final_rows,
        "slowest_requests": sorted(req_log, key=lambda r: r["latency_ms"], reverse=True)[:20],
    }
    with open(f"{OUT}/simulation_report_{N_PLAYERS}p.json", "w") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    # ─── Özet metni ──────────────────────────────────────────────────────────
    slowest_hand = max(hand_rows, key=lambda r: r["hand_wall_s"])
    s_all, su_all = lat_stats(all_state_lats), lat_stats(all_sub_lats)
    lines = []
    L = lines.append
    L("=" * 66)
    L(f"{N_PLAYERS}-OYUNCULU EŞ ZAMANLI SİMÜLASYON – ÖZET")
    L("=" * 66)
    L(f"Tarih (UTC)      : {sim_start.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    L(f"Sunucu           : {BASE}")
    L(f"Oyuncu sayısı    : {len(players)}/{N_PLAYERS} katıldı")
    L(f"Hand sayısı      : {N_HANDS} (hand 1 priming)")
    L(f"Toplam süre      : {total_time:.1f}s")
    L(f"Toplam istek     : {len(req_log)}")
    L(f"Toplam hata      : {sum(1 for r in req_log if not r['ok'])}")
    L("")
    L("─" * 66)
    L("KATILIM AŞAMASI (eş zamanlı)")
    L("─" * 66)
    L(f"  Duvar süresi   : {join_wall:.2f}s  |  Başarılı: {len(players)}/{N_PLAYERS}  |  Hata: {join_errs}")
    L(lat_line(lat_stats(join_lats), "  Gecikme"))
    L("")
    L("─" * 66)
    L("HAND BAZLI ZAMANLAMA VE OLAYLAR")
    L("─" * 66)
    L(f"  {'H':<3} {'Toplam':>7} {'Talep':>7} {'Gemi':>6} {'Kamyon':>6} {'Gönder-D':>9} {'End':>7} {'Hata':>5}  Olaylar")
    for r in hand_rows:
        errs = r["state_errors"] + r["submit_errors"]
        demand = "prim." if r["realized_demand"] is None else str(r["realized_demand"])
        flag = "  ← EN YAVAŞ" if r["hand"] == slowest_hand["hand"] else ""
        L(f"  {r['hand']:<3} {r['hand_wall_s']:>6.2f}s {demand:>7} {r['ship_units']:>6} {r['truck_units']:>6} "
          f"{r['submit_wall_s']:>8.2f}s {r['end_round_ms']:>6.0f}ms {errs:>5}  {r['events']}{flag}")
    L("")
    L("─" * 66)
    L("GECİKME ÖZETİ (tüm handlar)")
    L("─" * 66)
    L(lat_line(s_all, "  GET  /game-state"))
    L(lat_line(su_all, "  POST /submit-order"))
    rerank = [r["rerank_ms"] for r in hand_rows if r["rerank_ms"] is not None]
    if rerank:
        L(f"  Pareto yeniden sıralama (set-config): {rerank[0]:.0f}ms")
    L(f"  Ana dar boğaz: {'submit POST' if su_all['avg'] > s_all['avg'] else 'state GET'}")
    L("")
    L("─" * 66)
    L("PERSONA ANALİZİ (ortalamalar)")
    L("─" * 66)
    L(f"  {'Persona':<32} {'n':>3} {'Kâr':>10} {'CO₂ kg':>8} {'Servis':>7} {'Backord.':>9} {'Front-1':>8}")
    for persona, a in persona_analysis.items():
        L(f"  {persona + ' – ' + a['desc']:<32} {a['n']:>3} ${a['avg_profit']:>9,.0f} {a['avg_co2_kg']:>8.0f} "
          f"{fmt_service(a['avg_service_pct']):>7} {a['avg_backorders']:>9.0f} {a['front1']:>8}")
    L("")
    L("─" * 66)
    L(f"LİDERBOARD (ilk 20) — Pareto: {pareto[1]} vs {pareto[0]}")
    L("─" * 66)
    L(f"  {'Sıra':<5} {'Front':<6} {'Nickname':<10} {'Kâr':>10} {'CO₂ kg':>8} {'Servis':>7} {'Backord.':>9}")
    for row in final_rows[:20]:
        L(f"  {row['rank']:<5} {row['front']:<6} {row['nickname']:<10} ${row['cumulative_profit']:>9,} "
          f"{row['cum_co2_kg']:>8.0f} {fmt_service(row['service_level_pct']):>7} {row['cum_backorders']:>9}")
    if len(final_rows) > 20:
        L(f"  ... +{len(final_rows) - 20} oyuncu daha")
    L("")
    L("─" * 66)
    L("ARTIFACT DOSYALARI")
    L("─" * 66)
    for name, desc in [("simulation_summary", "bu rapor (.txt)"), ("requests_log", "tüm HTTP istekleri (.csv)"),
                       ("join_results", "oyuncu başına katılım (.csv)"), ("hands_timing", "hand bazlı zamanlama (.csv)"),
                       ("leaderboard", "final liderboard, 4 KPI + front (.csv)"),
                       ("simulation_report", "tam rapor (.json)")]:
        L(f"  {name}_{N_PLAYERS}p – {desc}")
    L("")
    L("=" * 66)
    L(f"PASS – {N_PLAYERS} oyunculu simülasyon başarıyla tamamlandı.")
    L("=" * 66)

    text = "\n".join(lines)
    with open(f"{OUT}/simulation_summary_{N_PLAYERS}p.txt", "w") as f:
        f.write(text + "\n")
    print("\n\n" + text)
    print(f"\n  Artifact'lar: {OUT}/")


if __name__ == "__main__":
    asyncio.run(main())
