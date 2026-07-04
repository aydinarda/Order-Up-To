import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createGameServer } from "../../server/index.js";

const ADMIN_KEY = "admin123";

async function startServer() {
  const { server } = createGameServer({ adminKey: ADMIN_KEY });
  await new Promise((resolve) => server.listen(0, resolve));
  return { server, port: server.address().port };
}

function connect(port) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws, predicate = () => true, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timed out waiting for ws message"));
    }, timeout);

    function onMessage(raw) {
      const msg = JSON.parse(String(raw));
      if (predicate(msg)) {
        cleanup();
        resolve(msg);
      }
    }
    function cleanup() {
      clearTimeout(timer);
      ws.off("message", onMessage);
    }
    ws.on("message", onMessage);
  });
}

async function post(port, path, body) {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

test("subscribe is acknowledged with a subscribed message", async (t) => {
  const { server, port } = await startServer();
  const ws = await connect(port);
  t.after(() => {
    ws.terminate();
    server.close();
  });

  ws.send(JSON.stringify({ type: "subscribe", gameId: "game-123" }));
  const msg = await nextMessage(ws, (m) => m.type === "subscribed");
  assert.equal(msg.gameId, "game-123");
});

test("broadcasts game events to subscribers of that game", async (t) => {
  const { server, port } = await startServer();
  const admin = await post(port, "/start-game", { nickname: "admin", adminKey: ADMIN_KEY });
  const ws = await connect(port);
  t.after(() => {
    ws.terminate();
    server.close();
  });

  ws.send(JSON.stringify({ type: "subscribe", gameId: admin.gameId }));
  await nextMessage(ws, (m) => m.type === "subscribed");

  // Arm the listener before triggering the event to avoid a race.
  const eventPromise = nextMessage(ws, (m) => m.type === "game_event");
  await post(port, "/start-game", { nickname: "bob", gameId: admin.gameId });
  const event = await eventPromise;

  assert.equal(event.payload.gameId, admin.gameId);
  assert.equal(event.payload.type, "player_joined");
});

test("does not deliver events for a different game", async (t) => {
  const { server, port } = await startServer();
  const admin = await post(port, "/start-game", { nickname: "admin", adminKey: ADMIN_KEY });
  const ws = await connect(port);
  t.after(() => {
    ws.terminate();
    server.close();
  });

  ws.send(JSON.stringify({ type: "subscribe", gameId: "some-other-game" }));
  await nextMessage(ws, (m) => m.type === "subscribed");

  let received = false;
  ws.on("message", (raw) => {
    if (JSON.parse(String(raw)).type === "game_event") {
      received = true;
    }
  });

  await post(port, "/start-game", { nickname: "bob", gameId: admin.gameId });
  await new Promise((resolve) => setTimeout(resolve, 250));

  assert.equal(received, false);
});

test("invalid payloads receive an error message", async (t) => {
  const { server, port } = await startServer();
  const ws = await connect(port);
  t.after(() => {
    ws.terminate();
    server.close();
  });

  ws.send("this is not json");
  const msg = await nextMessage(ws, (m) => m.type === "error");
  assert.match(msg.message, /invalid websocket payload/i);
});
