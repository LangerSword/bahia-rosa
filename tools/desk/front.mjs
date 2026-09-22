#!/usr/bin/env node
/**
 * The desk's front door.
 *
 * ComfyUI speaks its own protocol on 8188 and the finishing service on 8788, and neither is safe to
 * expose as-is: no CORS, no limit on who asks, and two ports to publish. This is the single origin
 * the app talks to, local or tunnelled:
 *
 *   /print-desk/*   → ComfyUI      (upload, prompt, history, view, system_stats, queue, ws)
 *   /restore-desk/* → the finisher (prepare, restore, health)
 *   /health         → what is actually up, and how busy
 *
 * It also puts a ceiling on printing: one address cannot queue more than N plates an hour. The desk
 * is a GPU somebody pays for by the hour — an open endpoint with no ceiling is a bill, not a service.
 *
 * Zero dependencies: node's own http, and a hand-rolled upgrade for the progress socket.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

const COMFY = process.env.COMFY_URL ?? "http://127.0.0.1:8188";
const RESTORE = process.env.RESTORE_URL ?? "http://127.0.0.1:8788";
const PORT = Number(process.env.FRONT_PORT ?? 8790);
const PRINTS_PER_HOUR = Number(process.env.FRONT_PRINTS_PER_HOUR ?? 12);
const ALLOWED = (
  process.env.FRONT_ORIGINS ??
  "https://langersword.github.io,http://localhost:5178,http://127.0.0.1:5178,http://[::1]:5178"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/** Hop-by-hop headers must not be forwarded (RFC 7230 §6.1). */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

const prints = new Map(); // ip -> [timestamps]

/** When a rented desk last did any work. The watchdog that stops the instance reads this file. */
const HEARTBEAT = process.env.FRONT_HEARTBEAT ?? path.join(process.env.HOME ?? "/tmp", ".local/state/fifteen-minutes/last-print");

function beat() {
  try {
    fs.mkdirSync(path.dirname(HEARTBEAT), { recursive: true });
    fs.writeFileSync(HEARTBEAT, new Date().toISOString());
  } catch {
    // A desk without a writable state dir is still a working desk.
  }
}

function cors(origin, response) {
  const allowed = origin && ALLOWED.includes(origin) ? origin : ALLOWED[0];
  response.setHeader("access-control-allow-origin", allowed);
  response.setHeader("vary", "origin");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type, accept");
  response.setHeader("access-control-max-age", "600");
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (prints.get(ip) ?? []).filter((at) => now - at < 3_600_000);
  if (recent.length >= PRINTS_PER_HOUR) {
    prints.set(ip, recent);
    return true;
  }
  recent.push(now);
  prints.set(ip, recent);
  return false;
}

function send(response, status, body, origin, type = "application/json") {
  cors(origin, response);
  response.writeHead(status, { "content-type": type });
  response.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function upstreamHealth(base, path) {
  try {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(2500) });
    return response.ok ? await response.json().catch(() => true) : false;
  } catch {
    return false;
  }
}

function forward(req, res, target, rest, origin) {
  const url = new URL(rest, target);
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value;
  }
  headers.host = url.host;

  const proxy = http.request(
    { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: req.method, headers },
    (upstream) => {
      cors(origin, res);
      const outgoing = {};
      for (const [key, value] of Object.entries(upstream.headers)) {
        if (!HOP_BY_HOP.has(key.toLowerCase())) outgoing[key] = value;
      }
      res.writeHead(upstream.statusCode ?? 502, outgoing);
      upstream.pipe(res);
    },
  );
  proxy.on("error", (error) => send(res, 502, { error: `the desk is not answering: ${error.message}` }, origin));
  req.pipe(proxy);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const url = new URL(req.url ?? "/", "http://desk.invalid");

  if (req.method === "OPTIONS") {
    cors(origin, res);
    res.writeHead(204).end();
    return;
  }

  if (url.pathname === "/health") {
    const [comfy, restore] = await Promise.all([upstreamHealth(COMFY, "/system_stats"), upstreamHealth(RESTORE, "/health")]);
    send(res, 200, { desk: true, comfy: Boolean(comfy), restore: Boolean(restore), gpu: comfy?.devices?.[0] ?? null }, origin);
    return;
  }

  const isPrint = url.pathname === "/print-desk" || url.pathname.startsWith("/print-desk/");
  const isFinish = url.pathname === "/restore-desk" || url.pathname.startsWith("/restore-desk/");
  if (!isPrint && !isFinish) {
    send(res, 404, { error: "the desk serves /print-desk, /restore-desk and /health" }, origin);
    return;
  }

  // One print per ask: the queue is the thing that costs money, so the ceiling sits on /prompt.
  if (isPrint && url.pathname === "/print-desk/prompt" && req.method === "POST") {
    const ip = (req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "unknown").toString();
    if (rateLimited(ip)) {
      send(res, 429, { error: `this desk prints ${PRINTS_PER_HOUR} plates an hour per address — try again shortly` }, origin);
      return;
    }
    beat();
  }

  forward(req, res, isPrint ? COMFY : RESTORE, url.pathname.replace(/^\/(print-desk|restore-desk)/, "") + url.search, origin);
});

// The progress socket: the app streams ComfyUI's /ws for real percentages, so it has to survive the
// front door. Node has no proxy for this — the sockets are joined by hand.
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://desk.invalid");
  const target = url.pathname.startsWith("/restore-desk") ? RESTORE : COMFY;
  const rest = url.pathname.replace(/^\/(print-desk|restore-desk)/, "") + url.search;
  const upstream = new URL(rest, target);

  const headers = { ...req.headers, host: upstream.host };
  const proxy = http.request({
    hostname: upstream.hostname,
    port: upstream.port,
    path: upstream.pathname + upstream.search,
    method: req.method,
    headers,
  });

  proxy.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
    const lines = Object.entries(upstreamResponse.headers).map(([key, value]) => `${key}: ${value}`);
    socket.write(`HTTP/1.1 ${upstreamResponse.statusCode} ${upstreamResponse.statusMessage}\r\n${lines.join("\r\n")}\r\n\r\n`);
    if (upstreamHead?.length) upstreamSocket.unshift(upstreamHead);
    if (head?.length) socket.unshift(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });

  proxy.on("error", () => socket.destroy());
  socket.on("error", () => proxy.destroy());
  proxy.end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`▸ desk front   http://127.0.0.1:${PORT}  →  comfy ${COMFY} · finisher ${RESTORE}`);
  console.log(`  origins      ${ALLOWED.join(", ")}`);
  console.log(`  ceiling      ${PRINTS_PER_HOUR} prints/hour per address`);
});
