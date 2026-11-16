import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { parseMessage, encode, isPairCode, type Message } from "@drift/shared";
import { getLanIp } from "./lanIp";
import { Hub, type Conn } from "./hub";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

const HOST_RE = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;
const LOCAL_RE = /^(localhost|127\.\d+\.\d+\.\d+)(:\d+)?$/;

/**
 * WebSocket URL the browser (and, through the QR, the phone) should use.
 * PUBLIC_WS_URL wins; a public host header gives ws(s)://host; localhost falls back to the LAN IP
 * so a phone on the same Wi-Fi can still reach it.
 */
export function wsUrlFor(req: http.IncomingMessage, port: number, env = process.env): string {
  if (env.PUBLIC_WS_URL) return env.PUBLIC_WS_URL;
  const host = req.headers.host ?? "";
  if (!HOST_RE.test(host) || LOCAL_RE.test(host)) return `ws://${getLanIp()}:${port}`;
  const proto = req.headers["x-forwarded-proto"] === "https" ? "wss" : "ws";
  return `${proto}://${host}`;
}

export async function createServer(opts: { port: number; staticDir?: string; host?: string }) {
  let port = opts.port;
  const hub = new Hub();
  const httpServer = http.createServer(async (req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    if (url === "/config.json") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", ...SECURITY_HEADERS });
      res.end(JSON.stringify({ wsUrl: wsUrlFor(req, port) }));
      return;
    }
    if (url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (!opts.staticDir) {
      res.writeHead(404).end();
      return;
    }
    const root = path.resolve(opts.staticDir);
    let rel: string;
    try {
      rel = url === "/" ? "/index.html" : decodeURIComponent(url);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const file = path.resolve(root, "." + rel);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const data = await readFile(file);
      const ext = path.extname(file);
      res.writeHead(200, {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "cache-control": rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        ...SECURITY_HEADERS,
        ...(ext === ".html" ? { "content-security-policy": CSP } : {}),
      });
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });

  const wss = new WebSocketServer({ server: httpServer, maxPayload: 16 * 1024 });
  wss.on("connection", (ws, req) => {
    const conn: Conn = {
      send: (m: Message) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(encode(m));
      },
      close: () => ws.close(),
    };
    hub.connect(conn);
    // Controllers may carry their pairing code in the URL (?pair=XXXXXX) instead of the hello.
    const qp = new URLSearchParams((req.url ?? "").split("?")[1] ?? "").get("pair");
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const m = parseMessage(String(data));
      if (!m) return;
      if (m.t === "hello" && m.role === "controller" && !m.pair && isPairCode(qp)) m.pair = qp;
      hub.message(conn, m);
    });
    ws.on("close", () => hub.disconnect(conn));
    ws.on("error", () => {});
  });

  const ticker = setInterval(() => hub.tick(), 250);
  await new Promise<void>((r) => httpServer.listen(opts.port, opts.host ?? "0.0.0.0", r));
  port = (httpServer.address() as { port: number }).port;

  return {
    port,
    hub,
    close: () =>
      new Promise<void>((r) => {
        clearInterval(ticker);
        wss.clients.forEach((c) => c.terminate());
        wss.close();
        httpServer.close(() => r());
      }),
  };
}
