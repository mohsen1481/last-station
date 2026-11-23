/**
 * Net harness (personal record sync) + game bootstrap.
 * The server is only the record keeper; the shooter runs locally in public/game/.
 */
import { T } from "./strings.js";

// ── net ────────────────────────────────────────────────────────────────────

function playerId() {
  const key = "hf:game:playerId";
  let id = localStorage.getItem(key);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    localStorage.setItem(key, id);
  }
  return id;
}

/** One room per browser: the room is this player's save slot. */
const me = playerId();
const room = new URLSearchParams(location.search).get("room") || `p-${me}`;

const PING = "__ping";
const PONG = "__pong";
let socket = null;
let retry = 0;
const listeners = new Set();
const pending = [];

export const net = {
  best: null,
  onBest(fn) { listeners.add(fn); if (net.best) fn(net.best); },
  /** Report a finished run; queued if the socket is down. */
  record(run) {
    const msg = { type: "action", action: { kind: "record", ...run } };
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
    else pending.push(msg);
  },
};

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  try {
    socket = new WebSocket(`${proto}//${location.host}/ws/${encodeURIComponent(room)}`);
  } catch {
    return;
  }
  socket.addEventListener("open", () => {
    retry = 0;
    socket.send(JSON.stringify({ type: "join", playerId: me }));
  });
  socket.addEventListener("message", (event) => {
    if (event.data === PONG) return;
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type !== "state") return;
    if (msg.view?.best) {
      net.best = msg.view.best;
      for (const fn of listeners) fn(net.best);
    }
    if (msg.status === "playing") while (pending.length) socket.send(JSON.stringify(pending.shift()));
  });
  socket.addEventListener("close", () => {
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 500 * 2 ** (retry - 1));
  });
}

setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(PING);
}, 30_000);

// ── boot ───────────────────────────────────────────────────────────────────

for (const el of document.querySelectorAll("[data-t]")) el.textContent = T[el.dataset.t] ?? "";

function fatal(text) {
  document.querySelector("#loading").classList.add("hidden");
  document.querySelector("#fatal").classList.remove("hidden");
  document.querySelector("#fatal-msg").textContent = text;
}

connect();
import("./game/main.js")
  .then((m) => m.boot(net))
  .catch((e) => {
    console.error(e);
    fatal(e?.userMessage || T.errWebgl);
  });
