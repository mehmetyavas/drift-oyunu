import {
  CODE_ALPHABET, PAIR_CODE_LEN, ROOM_CODE_LEN, MAX_PLAYERS, MODE_INFO, PLAYER_COLORS, RACE_CAP, RACE_GRACE, RACE_LENGTH, DURATIONS,
  rank, type Message, type Mode, type Phase, type StateMsg, type ResultRow, type ErrorCode,
} from "@drift/shared";

/** A socket as the hub sees it. */
export interface Conn {
  send(m: Message): void;
  close(): void;
}

export const COUNTDOWN_MS = 4000;
/** Late joiners appear this far behind the last car (m), so they do not land on top of it. */
export const SPAWN_BEHIND = 40;
export const MAX_ROOMS = 300;
/** Minimum gap between accepted car states from one player (ms). */
export const STATE_MIN_GAP = 30;
/** Per-connection message budget (burst / refill per second). */
const BUDGET = 120;

type Seat = { conn: Conn; pair: string; controller: Conn | null; player: Player | null };
type Ctl = { conn: Conn; seat: Seat | null; want: string | null };
type Player = {
  id: string; name: string; color: number; seat: Seat; room: Room;
  last: StateMsg | null; lastAt: number; finish: number | null;
};
type Room = {
  code: string; players: Player[]; host: string;
  mode: Mode; extreme: boolean; duration: number; phase: Phase;
  racers: Set<string>; seed: number; startAt: number; firstFinishAt: number | null;
};
type Client = { kind: "new" } | { kind: "game"; seat: Seat } | { kind: "controller"; ctl: Ctl };

const TO_GAME = new Set(["input", "calibrate", "toggleMode", "camera"]);
const TO_CONTROLLER = new Set(["haptic", "status"]);

export class Hub {
  private clients = new Map<Conn, Client>();
  private budget = new Map<Conn, { tokens: number; at: number }>();
  private seats: Seat[] = [];
  private pending: Ctl[] = [];
  private rooms = new Map<string, Room>();
  private nextId = 1;

  constructor(
    private now: () => number = () => Date.now(),
    private random: () => number = Math.random,
  ) {}

  connect(conn: Conn): void {
    this.clients.set(conn, { kind: "new" });
    this.budget.set(conn, { tokens: BUDGET, at: this.now() });
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  private allow(conn: Conn): boolean {
    const b = this.budget.get(conn);
    if (!b) return false;
    const t = this.now();
    b.tokens = Math.min(BUDGET, b.tokens + ((t - b.at) / 1000) * BUDGET);
    b.at = t;
    if (b.tokens < 1) return false;
    b.tokens--;
    return true;
  }

  message(conn: Conn, m: Message): void {
    const c = this.clients.get(conn);
    if (!c || !this.allow(conn)) return;
    if (c.kind === "new") {
      if (m.t !== "hello") return;
      if (m.role === "game") this.addSeat(conn, m.pair);
      else this.addController(conn, m.pair ?? null);
      return;
    }
    if (c.kind === "controller") {
      const seat = c.ctl.seat;
      if (seat && TO_GAME.has(m.t)) seat.conn.send(m);
      return;
    }
    const seat = c.seat;
    if (TO_CONTROLLER.has(m.t)) {
      seat.controller?.send(m);
      return;
    }
    switch (m.t) {
      case "join": return this.join(seat, m.room, m.name);
      case "leave": return this.leave(seat);
      case "config": return this.config(seat, m.mode, m.extreme, m.duration);
      case "start": return this.start(seat);
      case "end": return this.endByHost(seat);
      case "state": return this.state(seat, m);
      case "finish": return this.finish(seat);
    }
  }

  disconnect(conn: Conn): void {
    const c = this.clients.get(conn);
    this.clients.delete(conn);
    this.budget.delete(conn);
    if (!c) return;
    if (c.kind === "controller") {
      const ctl = c.ctl;
      this.pending = this.pending.filter((p) => p !== ctl);
      if (ctl.seat && ctl.seat.controller === conn) {
        ctl.seat.controller = null;
        ctl.seat.conn.send({ t: "peer", role: "controller", connected: false });
      }
    } else if (c.kind === "game") {
      const seat = c.seat;
      this.leave(seat);
      this.seats = this.seats.filter((s) => s !== seat);
      if (seat.controller) {
        const cc = this.clients.get(seat.controller);
        seat.controller.send({ t: "peer", role: "game", connected: false });
        if (cc?.kind === "controller") {
          cc.ctl.seat = null;
          cc.ctl.want = seat.pair; // the game page may come back with the same code
          this.pending.push(cc.ctl);
        }
      }
    }
  }

  // ---------- pairing ----------

  private code(len: number): string {
    let s = "";
    for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)];
    return s;
  }

  private addSeat(conn: Conn, want?: string): void {
    const taken = (p: string) => this.seats.some((s) => s.pair === p);
    let pair = want && !taken(want) ? want : this.code(PAIR_CODE_LEN);
    while (taken(pair)) pair = this.code(PAIR_CODE_LEN);
    const seat: Seat = { conn, pair, controller: null, player: null };
    this.seats.push(seat);
    this.clients.set(conn, { kind: "game", seat });
    conn.send({ t: "pair", code: pair });
    // A controller waiting for exactly this code wins; otherwise the newest code-less one.
    const match = this.pending.find((p) => p.want === pair) ?? [...this.pending].reverse().find((p) => p.want === null);
    if (match) this.bind(match, seat);
  }

  private addController(conn: Conn, want: string | null): void {
    const ctl: Ctl = { conn, seat: null, want };
    this.clients.set(conn, { kind: "controller", ctl });
    const seat = want ? this.seats.find((s) => s.pair === want) : this.seats[this.seats.length - 1];
    if (seat) this.bind(ctl, seat);
    else this.pending.push(ctl);
  }

  private bind(ctl: Ctl, seat: Seat): void {
    this.pending = this.pending.filter((p) => p !== ctl);
    const prev = seat.controller;
    ctl.seat = seat;
    seat.controller = ctl.conn;
    if (prev && prev !== ctl.conn) {
      const pc = this.clients.get(prev);
      if (pc?.kind === "controller") pc.ctl.seat = null;
      prev.close();
    }
    seat.conn.send({ t: "peer", role: "controller", connected: true });
    ctl.conn.send({ t: "peer", role: "game", connected: true });
  }

  // ---------- rooms ----------

  private err(seat: Seat, code: ErrorCode): void {
    seat.conn.send({ t: "error", code });
  }

  private join(seat: Seat, code: string | null, name: string): void {
    this.leave(seat);
    let room: Room | undefined;
    if (code === null) {
      if (this.rooms.size >= MAX_ROOMS) return this.err(seat, "busy");
      let c = this.code(ROOM_CODE_LEN);
      while (this.rooms.has(c)) c = this.code(ROOM_CODE_LEN);
      room = {
        code: c, players: [], host: "", mode: "battle", extreme: false, duration: DURATIONS[1], phase: "lobby",
        racers: new Set(), seed: 0, startAt: 0, firstFinishAt: null,
      };
      this.rooms.set(c, room);
    } else {
      room = this.rooms.get(code);
      if (!room) return this.err(seat, "not_found");
      if (room.players.length >= MAX_PLAYERS) return this.err(seat, "full");
    }
    const used = new Set(room.players.map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
    const player: Player = {
      id: (this.nextId++).toString(36), name, color, seat, room, last: null, lastAt: -Infinity, finish: null,
    };
    room.players.push(player);
    if (!room.host) room.host = player.id;
    seat.player = player;
    if (room.phase === "racing") {
      // Drop-in: score modes take the newcomer straight into the running round, next to the last car.
      // A race would be unfair to join halfway, so the newcomer watches the leader until the next one.
      const drop = !MODE_INFO[room.mode].race;
      if (drop) room.racers.add(player.id);
      this.broadcastLobby(room);
      seat.conn.send(this.roundMsg(room, drop ? this.spawnHint(room, "last") : this.spawnHint(room, "lead")));
    } else this.broadcastLobby(room);
  }

  private leave(seat: Seat): void {
    const p = seat.player;
    if (!p) return;
    seat.player = null;
    const room = p.room;
    room.players = room.players.filter((q) => q !== p);
    room.racers.delete(p.id);
    if (!room.players.length) {
      this.rooms.delete(room.code);
      return;
    }
    if (room.host === p.id) room.host = room.players[0].id;
    if (room.phase === "racing" && room.racers.size === 0) this.endRound(room);
    else this.broadcastLobby(room);
  }

  private hostOf(seat: Seat): Player | null {
    const p = seat.player;
    if (!p) return null;
    if (p.room.host !== p.id) {
      this.err(seat, "not_host");
      return null;
    }
    return p;
  }

  private config(seat: Seat, mode: Mode, extreme: boolean, duration: number): void {
    const p = this.hostOf(seat);
    if (!p || p.room.phase === "racing") return;
    const room = p.room;
    room.mode = mode;
    room.extreme = extreme;
    room.duration = DURATIONS.includes(duration) ? duration : room.duration;
    this.broadcastLobby(room);
  }

  private start(seat: Seat): void {
    const p = this.hostOf(seat);
    if (!p || p.room.phase === "racing") return;
    const room = p.room;
    room.phase = "racing";
    room.seed = Math.floor(this.random() * 2 ** 31);
    room.startAt = this.now() + COUNTDOWN_MS;
    room.firstFinishAt = null;
    room.racers = new Set(room.players.map((q) => q.id));
    for (const q of room.players) {
      q.last = null;
      q.finish = null;
      q.lastAt = -Infinity;
    }
    this.broadcastLobby(room);
    this.broadcast(room, this.roundMsg(room));
  }

  private endByHost(seat: Seat): void {
    const p = this.hostOf(seat);
    if (p && p.room.phase === "racing") this.endRound(p.room);
  }

  private state(seat: Seat, m: StateMsg): void {
    const p = seat.player;
    if (!p || p.room.phase !== "racing" || !p.room.racers.has(p.id)) return;
    const t = this.now();
    if (t - p.lastAt < STATE_MIN_GAP) return;
    p.lastAt = t;
    const out: StateMsg = { ...m, id: p.id };
    p.last = out;
    for (const q of p.room.players) if (q !== p) q.seat.conn.send(out);
  }

  private finish(seat: Seat): void {
    const p = seat.player;
    if (!p) return;
    const room = p.room;
    if (room.phase !== "racing" || !MODE_INFO[room.mode].race || p.finish !== null || !room.racers.has(p.id)) return;
    if (!p.last || p.last.s < RACE_LENGTH - 250) return; // must actually be near the line
    const t = this.now();
    p.finish = Math.max(0, (t - room.startAt) / 1000);
    room.firstFinishAt ??= t;
    if ([...room.racers].every((id) => room.players.find((q) => q.id === id)?.finish !== null)) this.endRound(room);
    else this.broadcast(room, this.results(room)); // live standings with the new finisher
  }

  /** Call a few times per second: ends rounds whose time is up. */
  tick(): void {
    const t = this.now();
    for (const room of this.rooms.values()) {
      if (room.phase !== "racing") continue;
      const info = MODE_INFO[room.mode];
      const elapsed = t - room.startAt;
      if (info.timed && elapsed >= room.duration * 1000) this.endRound(room);
      else if (info.race && (elapsed >= RACE_CAP * 1000 || (room.firstFinishAt !== null && t - room.firstFinishAt >= RACE_GRACE * 1000))) {
        this.endRound(room);
      }
    }
  }

  private results(room: Room) {
    const rows: ResultRow[] = room.players
      .filter((p) => room.racers.has(p.id))
      .map((p) => ({
        id: p.id, name: p.name, color: p.color,
        // Banked points plus the combo still running when the round ended.
        score: Math.round(p.last ? p.last.sc + p.last.pd * p.last.m : 0), dist: Math.round(p.last?.s ?? 0), finish: p.finish,
      }));
    return { t: "results" as const, mode: room.mode, ranking: rank(rows, room.mode) };
  }

  private endRound(room: Room): void {
    room.phase = "results";
    this.broadcastLobby(room); // phase first, so clients know these results are final
    this.broadcast(room, this.results(room));
  }

  /** Road distance of the last (or leading) car in the round, from the latest snapshots. */
  private spawnHint(room: Room, which: "last" | "lead"): number {
    const ss = room.players.filter((p) => room.racers.has(p.id) && p.last).map((p) => p.last!.s);
    if (!ss.length) return 0;
    return which === "last" ? Math.max(0, Math.min(...ss) - SPAWN_BEHIND) : Math.max(...ss);
  }

  private roundMsg(room: Room, spawn = 0): Message {
    return {
      t: "round", seed: room.seed, mode: room.mode, extreme: room.extreme, duration: room.duration,
      startIn: room.startAt - this.now(), grid: room.players.filter((p) => room.racers.has(p.id)).map((p) => p.id),
      spawn: Math.round(spawn),
    };
  }

  private broadcast(room: Room, m: Message): void {
    for (const p of room.players) p.seat.conn.send(m);
  }

  private broadcastLobby(room: Room): void {
    const players = room.players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    for (const p of room.players) {
      p.seat.conn.send({
        t: "lobby", room: room.code, you: p.id, host: room.host, players, mode: room.mode, extreme: room.extreme,
        duration: room.duration, phase: room.phase, racers: [...room.racers],
      });
    }
  }
}
