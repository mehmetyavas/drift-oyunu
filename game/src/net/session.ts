import {
  MODE_INFO, RACE_LENGTH,
  type ErrorCode, type Message, type Mode, type Phase, type PlayerInfo, type ResultsMsg, type StateMsg,
} from "@drift/shared";
import type { Connection } from "./connection";
import { RemoteTrack } from "./remote";
import type { CarState } from "../sim/car";

/** Car snapshots per second sent to the room. */
const SEND_HZ = 20;

export type Round = {
  seed: number; mode: Mode; extreme: boolean; duration: number; startAt: number; grid: string[];
  /** Road distance to start at (late join) or to look at (spectator). 0 = the grid. */
  spawn: number;
};

export type SessionEvents = {
  lobby(): void;
  round(r: Round): void;
  results(r: ResultsMsg): void;
  error(code: ErrorCode): void;
};

/** Client side of a multiplayer room: lobby state, the running round and the other cars. */
export class Session {
  room: string | null = null;
  me: string | null = null;
  host: string | null = null;
  players: PlayerInfo[] = [];
  mode: Mode = "battle";
  extreme = false;
  duration = 180;
  phase: Phase = "lobby";
  racers = new Set<string>();
  round: Round | null = null;
  results: ResultsMsg | null = null;
  tracks = new Map<string, RemoteTrack>();
  finished = false;
  private lastSent = -Infinity;
  /** Room to rejoin after the socket comes back. */
  private rejoin: { room: string; name: string } | null = null;
  private joining: { name: string } | null = null;

  constructor(private conn: Connection, private ev: SessionEvents) {
    conn.onOpen(() => {
      if (this.rejoin) conn.send({ t: "join", room: this.rejoin.room, name: this.rejoin.name });
    });
    conn.onMessage((m) => this.handle(m, performance.now()));
  }

  get inRoom(): boolean {
    return this.room !== null;
  }
  get isHost(): boolean {
    return this.me !== null && this.me === this.host;
  }
  /** True while I am driving in a multiplayer round (countdown included). */
  get racing(): boolean {
    return this.phase === "racing" && this.round !== null && this.me !== null && this.racers.has(this.me);
  }

  /** In the room while a round runs that I am not part of (a race I joined late): watch the leader. */
  get spectating(): boolean {
    return this.phase === "racing" && this.round !== null && this.me !== null && !this.racers.has(this.me);
  }

  /** The car to watch while spectating: the one furthest down the road. */
  leader(now: number): { id: string; car: CarState } | null {
    let best: { id: string; s: number } | null = null;
    for (const id of this.racers) {
      const l = this.tracks.get(id)?.latest;
      if (l && (!best || l.s > best.s)) best = { id, s: l.s };
    }
    const smp = best ? this.tracks.get(best.id)!.sample(now) : null;
    return best && smp ? { id: best.id, car: smp.car } : null;
  }

  create(name: string): void {
    this.joining = { name };
    this.conn.send({ t: "join", room: null, name });
  }
  join(room: string, name: string): void {
    this.joining = { name };
    this.conn.send({ t: "join", room, name });
  }
  leave(): void {
    this.conn.send({ t: "leave" });
    this.reset();
    this.ev.lobby();
  }
  configure(mode: Mode, extreme: boolean, duration: number): void {
    this.conn.send({ t: "config", mode, extreme, duration });
  }
  start(): void {
    this.conn.send({ t: "start" });
  }
  end(): void {
    this.conn.send({ t: "end" });
  }

  private reset(): void {
    this.room = this.me = this.host = null;
    this.players = [];
    this.phase = "lobby";
    this.racers.clear();
    this.round = null;
    this.results = null;
    this.tracks.clear();
    this.rejoin = null;
    this.joining = null;
  }

  handle(m: Message, now: number): void {
    switch (m.t) {
      case "lobby": {
        const name = this.joining?.name ?? this.rejoin?.name ?? "";
        this.room = m.room;
        this.me = m.you;
        this.host = m.host;
        this.players = m.players;
        this.mode = m.mode;
        this.extreme = m.extreme;
        this.duration = m.duration;
        this.racers = new Set(m.racers);
        if (m.phase !== "racing" && this.phase === "racing") this.round = null;
        this.phase = m.phase;
        this.rejoin = { room: m.room, name: this.players.find((p) => p.id === m.you)?.name ?? name };
        this.joining = null;
        for (const id of [...this.tracks.keys()]) if (!this.players.some((p) => p.id === id)) this.tracks.delete(id);
        this.ev.lobby();
        break;
      }
      case "round":
        this.round = { seed: m.seed, mode: m.mode, extreme: m.extreme, duration: m.duration, startAt: now + m.startIn, grid: m.grid, spawn: m.spawn };
        this.results = null;
        this.finished = false;
        this.tracks.clear();
        this.ev.round(this.round);
        break;
      case "state": {
        if (!m.id || m.id === this.me) return;
        let tr = this.tracks.get(m.id);
        if (!tr) this.tracks.set(m.id, (tr = new RemoteTrack()));
        tr.push(m, now);
        break;
      }
      case "results":
        this.results = m;
        this.ev.results(m);
        break;
      case "error":
        if (m.code === "not_found" && this.rejoin && !this.joining) this.reset();
        this.joining = null;
        this.ev.error(m.code);
        break;
    }
  }

  /** Seconds left in a timed round (null if untimed), clamped at 0. */
  timeLeft(now: number): number | null {
    if (!this.round || !MODE_INFO[this.round.mode].timed) return null;
    return Math.max(0, (this.round.startAt + this.round.duration * 1000 - now) / 1000);
  }

  /** Seconds until the start (positive during the countdown). */
  countdown(now: number): number {
    return this.round ? (this.round.startAt - now) / 1000 : 0;
  }

  /** Sends my car at SEND_HZ; reports the finish line once in race mode. */
  sendState(now: number, car: CarState, steer: number, score: number, pending: number, mult: number, s: number): void {
    if (!this.racing || now - this.lastSent < 1000 / SEND_HZ) return;
    this.lastSent = now;
    const m: StateMsg = {
      t: "state", x: car.x, z: car.z, h: car.heading, vx: car.vx, vz: car.vz, yr: car.yawRate, st: steer, d: car.drifting,
      sc: score, pd: pending, m: mult, s,
    };
    this.conn.send(m);
    if (this.round && MODE_INFO[this.round.mode].race && !this.finished && s >= RACE_LENGTH) {
      this.finished = true;
      this.conn.send({ t: "finish" });
    }
  }

  /** Live standings for the HUD, mine included. Race: by distance; others: by score. */
  standings(mine: { score: number; s: number }): { id: string; name: string; color: number; score: number; s: number; me: boolean }[] {
    const rows = this.players
      .filter((p) => this.racers.has(p.id))
      .map((p) => {
        if (p.id === this.me) return { id: p.id, name: p.name, color: p.color, score: mine.score, s: mine.s, me: true };
        const l = this.tracks.get(p.id)?.latest;
        return { id: p.id, name: p.name, color: p.color, score: l ? l.sc + l.pd * l.m : 0, s: l?.s ?? 0, me: false };
      });
    const race = this.round ? MODE_INFO[this.round.mode].race : false;
    return rows.sort((a, b) => (race ? b.s - a.s : b.score - a.score));
  }
}
