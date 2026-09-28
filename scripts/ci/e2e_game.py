#!/usr/bin/env python3
"""End-to-end check: play a full OrderUpToGame through its HTTP API.

Used by .github/workflows/e2e.yml and runnable locally against any backend:

    BASE_URL=http://localhost:4000 ADMIN_KEY=admin123 python3 scripts/ci/e2e_game.py

Standard library only (Python >= 3.9). Exits non-zero on the first failure.

Flow: admin creates a game, 4 players join, the admin adds opening stock,
round 1 is the priming round (no demand; the truck is still closed), then the
truck opens and the selling rounds are played with ship + truck orders while
the admin re-ranks the leaderboard on another Pareto pair mid-round. Finally
the leaderboard, the admin's demand history, error cases and a restart are
verified.
"""

import json
import os
import random
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("BASE_URL", "http://localhost:4000").rstrip("/")
ADMIN_KEY = os.environ.get("ADMIN_KEY", "admin123")
HANDS = int(os.environ.get("HANDS", "4"))  # 1 priming round + selling rounds
STOCK_ADD = 60
PLAYERS = ["Alice", "Bob", "Carol", "Dave"]
KPI_FIELDS = ("front", "cumProfit", "cumCo2", "serviceLevelPct", "cumBackorders")


# ── HTTP helpers ──────────────────────────────────────────────────────────────
def call(method, path, body=None, params=None):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as res:
            status, raw = res.status, res.read()
    except urllib.error.HTTPError as err:
        status, raw = err.code, err.read()
    try:
        payload = json.loads(raw.decode() or "{}")
    except json.JSONDecodeError:
        payload = {"_raw": raw.decode(errors="replace")[:400]}
    return status, payload


def fail(label, message):
    print(f"FAIL [{label}] {message}", file=sys.stderr)
    sys.exit(1)


def ok(method, path, label, body=None, params=None):
    status, payload = call(method, path, body, params)
    if status != 200:
        fail(label, f"HTTP {status}: {json.dumps(payload)[:400]}")
    print(f"  OK  [{label}] {json.dumps(payload)[:160]}")
    return payload


def expect_status(method, path, label, expected, body=None, params=None):
    status, payload = call(method, path, body, params)
    if status != expected:
        fail(label, f"expected HTTP {expected}, got {status}: {json.dumps(payload)[:300]}")
    print(f"  OK  [{label}] → {expected}")
    return payload


def check(condition, label, message):
    if not condition:
        fail(label, message)


def state(game_id, player_id, admin_token=None):
    params = {"gameId": game_id, "playerId": player_id}
    if admin_token:
        params["adminToken"] = admin_token
    return ok("GET", "/game-state", f"game-state/{player_id[:6]}", params=params)


# ── 1. Create game (admin) ────────────────────────────────────────────────────
print(f"\n=== 1. Create game as admin ({BASE}) ===")
d = ok("POST", "/start-game", "start-game/admin",
       {"nickname": "admin", "adminKey": ADMIN_KEY, "handsPerTur": HANDS})
game_id, admin_token, admin_pid = d["gameId"], d["adminToken"], d["playerId"]
unit_cost = d["config"]["unitCost"]
check(d["config"]["paretoX"] == "co2" and d["config"]["paretoY"] == "profit",
      "default pareto", f"expected CO2 vs profit, got {d['config']}")
check(d["config"]["expressEnabled"] is False, "truck default", "the truck should start closed")

# ── 2. Join players ───────────────────────────────────────────────────────────
print("\n=== 2. Join 4 players ===")
players = []
for name in PLAYERS:
    d = ok("POST", "/start-game", f"join/{name}", {"nickname": name, "gameId": game_id})
    players.append({"id": d["playerId"], "name": name})

# ── 3. Admin adds opening stock to every warehouse ────────────────────────────
print("\n=== 3. Add opening stock ===")
d = ok("POST", "/add-stock", "add-stock", {"gameId": game_id, "adminToken": admin_token, "qty": STOCK_ADD})
check(d["pendingStockAdded"] == STOCK_ADD, "add-stock", f"pending should be {STOCK_ADD}: {d}")
gs = state(game_id, players[0]["id"])
check(gs["pendingStockAdded"] == STOCK_ADD, "add-stock/visible", "players should see the pending stock")

# ── 4. Priming round: no demand, truck closed ─────────────────────────────────
print("\n=== 4. Round 1 (priming) ===")
ok("POST", "/start-round", "r1/start-round", {"gameId": game_id, "adminToken": admin_token})
expect_status("POST", "/submit-order", "r1/truck closed → 400", 400,
              {"gameId": game_id, "playerId": players[0]["id"], "orderQty": 100, "expressQty": 10})
for p in players:
    p["opening"] = random.randint(150, 220)
    d = ok("POST", "/submit-order", f"r1/submit/{p['name']}",
           {"gameId": game_id, "playerId": p["id"], "orderQty": p["opening"]})
    check(d["accepted"], "r1/submit", f"{p['name']}: order not accepted")
d = ok("POST", "/end-round", "r1/end-round", {"gameId": game_id, "adminToken": admin_token})
check(d["realizedDemand"] is None, "r1/priming", f"priming round must not realize demand: {d['realizedDemand']}")
for p in players:
    gs = state(game_id, p["id"])
    check(gs["pendingStockAdded"] == 0, "r1/stock landed", "pending stock should be consumed")
    check(gs["player"]["inventory"]["onHand"] == STOCK_ADD, "r1/stock landed",
          f"{p['name']} on hand should be {STOCK_ADD}: {gs['player']['inventory']}")
    check(gs["player"]["lastRoundResult"]["addedQty"] == STOCK_ADD, "r1/result", "addedQty missing")
    check(gs["player"]["lastRoundResult"]["purchaseCost"] == p["opening"] * unit_cost, "r1/result",
          "only the ship order should be paid (the added stock is free)")
print(f"  PASS – +{STOCK_ADD} landed in every warehouse, priming realized no demand")

# ── 5. Open the truck ─────────────────────────────────────────────────────────
print("\n=== 5. Open the fast truck ===")
d = ok("POST", "/set-config", "truck on", {"gameId": game_id, "adminToken": admin_token, "expressEnabled": True})
check(d["config"]["expressEnabled"] is True, "truck on", "expressEnabled should be true")

# ── 6. Selling rounds: ship + truck, Pareto switched mid-round ────────────────
for hand in range(2, HANDS + 1):
    print(f"\n=== Round {hand}/{HANDS} ===")
    d = ok("POST", "/start-round", f"r{hand}/start-round", {"gameId": game_id, "adminToken": admin_token})
    check(d["roundPhase"] == "active", f"r{hand}/start-round", f"expected active, got {d['roundPhase']}")

    if hand == 2:
        d = ok("POST", "/set-config", "mid-round pareto switch",
               {"gameId": game_id, "adminToken": admin_token, "paretoX": "backorders", "paretoY": "serviceLevel"})
        check(d["config"]["paretoX"] == "backorders", "pareto", "pair not applied")
        expect_status("POST", "/set-config", "mid-round price change → 400", 400,
                      {"gameId": game_id, "adminToken": admin_token, "price": 99})

    for i, p in enumerate(players):
        qty = random.randint(60, 140)
        express = random.randint(5, 30) if i % 2 == 0 else 0
        d = ok("POST", "/submit-order", f"r{hand}/submit/{p['name']}",
               {"gameId": game_id, "playerId": p["id"], "orderQty": qty, "expressQty": express})
        check(d["accepted"] and d["expressQty"] == express, f"r{hand}/submit", f"{p['name']}: {d}")

    d = ok("POST", "/end-round", f"r{hand}/end-round", {"gameId": game_id, "adminToken": admin_token})
    check(isinstance(d["realizedDemand"], (int, float)), f"r{hand}/demand", "selling round needs demand")
    rows = d.get("leaderboard", [])
    check(len(rows) == len(PLAYERS) + 1, f"r{hand}/leaderboard", f"expected {len(PLAYERS) + 1} rows")
    for row in rows:
        missing = [k for k in KPI_FIELDS if k not in row]
        check(not missing, f"r{hand}/leaderboard", f"{row['nickname']} missing {missing}")
    print(f"  Realized demand: {d['realizedDemand']}")

# ── 7. Final leaderboard ──────────────────────────────────────────────────────
print("\n=== 7. Final leaderboard ===")
lb = ok("GET", "/leaderboard", "leaderboard", params={"gameId": game_id})["leaderboard"]
check(len(lb) > 0, "leaderboard", "empty leaderboard")
check([r["front"] for r in lb] == sorted(r["front"] for r in lb), "leaderboard", "rows not sorted by front")
check([r["rank"] for r in lb] == list(range(1, len(lb) + 1)), "leaderboard", "ranks not sequential")
for r in lb:
    service = "—" if r["serviceLevelPct"] is None else f"{round(r['serviceLevelPct'])}%"
    print(f"  #{r['rank']} front {r['front']}  {r['nickname']:<6} ${r['cumProfit']:>8,.0f}  "
          f"{r['cumCo2']:>6.0f} kg  service {service:>4}  backorders {r['cumBackorders']}")

# ── 8. Admin sees the realized demand history ─────────────────────────────────
print("\n=== 8. Admin round history ===")
gs = state(game_id, admin_pid, admin_token)
history = gs.get("roundHistory", [])
check(len(history) == HANDS, "round history", f"expected {HANDS} entries, got {len(history)}")
check(history[0]["realizedDemand"] is None, "round history", "round 1 (priming) must record no demand")
for entry in history[1:]:
    check(isinstance(entry["realizedDemand"], (int, float)), "round history", f"bad entry {entry}")
print("  " + ", ".join(f"R{e['roundNo']}={e['realizedDemand']}" for e in history))

# ── 9. Error cases ────────────────────────────────────────────────────────────
print("\n=== 9. Error cases ===")
expect_status("POST", "/start-round", "start-round on finished game", 400,
              {"gameId": game_id, "adminToken": admin_token})
expect_status("POST", "/add-stock", "add-stock on finished game", 400,
              {"gameId": game_id, "adminToken": admin_token, "qty": 5})
expect_status("POST", "/add-stock", "add-stock with forged token", 403,
              {"gameId": game_id, "adminToken": "forged", "qty": 5})
expect_status("POST", "/start-game", "duplicate nickname", 409, {"nickname": "Alice", "gameId": game_id})
expect_status("GET", "/game-state", "invalid gameId", 400, params={"gameId": "not-a-real-id"})

# ── 10. Restart drops stock that has not landed yet ───────────────────────────
print("\n=== 10. Restart ===")
d = ok("POST", "/restart-game", "restart", {"gameId": game_id, "adminToken": admin_token, "playerId": admin_pid})
game_id = d["gameId"]
ok("POST", "/add-stock", "add-stock after restart", {"gameId": game_id, "adminToken": admin_token, "qty": 25})
d = ok("POST", "/restart-game", "restart again", {"gameId": game_id, "adminToken": admin_token, "playerId": admin_pid})
gs = state(d["gameId"], players[0]["id"])
check(gs["pendingStockAdded"] == 0 and gs["player"]["inventory"]["onHand"] == 0, "restart",
      f"restart should drop pending stock: {gs['pendingStockAdded']}, {gs['player']['inventory']}")

print("\n  PASS – full game ran successfully!")
