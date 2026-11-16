import { encode, parseMessage, isPairCode, type Message } from "@drift/shared";

const PAIR_KEY = "drift.pair";

function storedPair(): string | undefined {
  try {
    const v = localStorage.getItem(PAIR_KEY);
    return isPairCode(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export class Connection {
  private ws: WebSocket | null = null;
  private listeners: ((m: Message) => void)[] = [];
  private openers: (() => void)[] = [];
  /** Pairing code for this page's controller (kept across reloads). */
  pair: string | undefined = storedPair();

  constructor(private wsUrl: string) {
    this.open();
  }

  private open() {
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(encode(this.pair ? { t: "hello", role: "game", pair: this.pair } : { t: "hello", role: "game" }));
      this.openers.forEach((cb) => cb());
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      const m = parseMessage(e.data);
      if (!m) return;
      if (m.t === "pair") {
        this.pair = m.code;
        try {
          localStorage.setItem(PAIR_KEY, m.code);
        } catch {
          /* private mode: the code just changes on reload */
        }
      }
      this.listeners.forEach((cb) => cb(m));
    };
    ws.onclose = () => {
      this.listeners.forEach((cb) => cb({ t: "peer", role: "controller", connected: false }));
      setTimeout(() => this.open(), 1000);
    };
  }

  onMessage(cb: (m: Message) => void): void {
    this.listeners.push(cb);
  }

  /** Runs after every (re)connect, once the hello is sent. */
  onOpen(cb: () => void): void {
    this.openers.push(cb);
    if (this.ws?.readyState === WebSocket.OPEN) cb();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(m: Message): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(m));
  }
}
