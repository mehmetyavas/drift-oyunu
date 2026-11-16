import { isMode, MAX_PLAYERS, type Mode } from "./modes";

export const SERVER_PORT = 8080;

export type Role = "game" | "controller";
/** Game: pair = the pairing code it would like to keep. Controller: pair = the game it binds to. */
export type HelloMsg = { t: "hello"; role: Role; pair?: string };
export type InputMsg = { t: "input"; steer: number; brake: boolean; nitro: boolean; seq: number };
export type CalibrateMsg = { t: "calibrate" };
export type ToggleModeMsg = { t: "toggleMode" };
export type CameraMsg = { t: "camera" };
export type HapticKind = "comboUp" | "comboEnd" | "reset" | "drift";
export type HapticMsg = { t: "haptic"; kind: HapticKind };
export type StatusMsg = {
  t: "status"; score: number; combo: number; multiplier: number; extreme?: boolean;
  /** Multiplayer: 1-based position and field size. */
  rank?: number; players?: number;
};
export type PeerMsg = { t: "peer"; role: Role; connected: boolean };
/** Server → game: the code a controller uses to bind to this game. */
export type PairMsg = { t: "pair"; code: string };

// ---- Multiplayer (game ↔ server) ----
export type Phase = "lobby" | "racing" | "results";
export type PlayerInfo = { id: string; name: string; color: number };
/** room null = create a new room. */
export type JoinMsg = { t: "join"; room: string | null; name: string };
export type LeaveMsg = { t: "leave" };
export type ConfigMsg = { t: "config"; mode: Mode; extreme: boolean; duration: number };
export type StartMsg = { t: "start" };
export type EndMsg = { t: "end" };
export type LobbyMsg = {
  t: "lobby"; room: string; you: string; host: string; players: PlayerInfo[];
  mode: Mode; extreme: boolean; duration: number; phase: Phase;
  /** Ids taking part in the current round. */
  racers: string[];
};
/** startIn < 0 means the round started that many ms ago (late join in free mode). */
export type RoundMsg = { t: "round"; seed: number; mode: Mode; extreme: boolean; duration: number; startIn: number; grid: string[] };
/** Car snapshot. Game → server without id; server → others with id. */
export type StateMsg = {
  t: "state"; id?: string;
  x: number; z: number; h: number; vx: number; vz: number; yr: number; st: number; d: boolean;
  sc: number; pd: number; m: number; s: number;
};
export type FinishMsg = { t: "finish" };
export type ResultRow = { id: string; name: string; color: number; score: number; dist: number; finish: number | null };
export type ResultsMsg = { t: "results"; mode: Mode; ranking: ResultRow[] };
export type ErrorCode = "not_found" | "full" | "busy" | "bad_name" | "not_host";
export type ErrorMsg = { t: "error"; code: ErrorCode };

export type Message =
  | HelloMsg | InputMsg | CalibrateMsg | ToggleModeMsg | CameraMsg | HapticMsg | StatusMsg | PeerMsg | PairMsg
  | JoinMsg | LeaveMsg | ConfigMsg | StartMsg | EndMsg | LobbyMsg | RoundMsg | StateMsg | FinishMsg | ResultsMsg | ErrorMsg;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isRole = (v: unknown): v is Role => v === "game" || v === "controller";
const isHaptic = (v: unknown): v is HapticKind => v === "comboUp" || v === "comboEnd" || v === "reset" || v === "drift";
const isPhase = (v: unknown): v is Phase => v === "lobby" || v === "racing" || v === "results";
const ERRORS = new Set(["not_found", "full", "busy", "bad_name", "not_host"]);

/** Unambiguous upper-case alphabet for room and pairing codes. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LEN = 4;
export const PAIR_CODE_LEN = 6;
const codeRe = (n: number) => new RegExp(`^[${CODE_ALPHABET}]{${n}}$`);
const ROOM_RE = codeRe(ROOM_CODE_LEN);
const PAIR_RE = codeRe(PAIR_CODE_LEN);
const ID_RE = /^[a-z0-9]{1,12}$/;
export const isRoomCode = (v: unknown): v is string => typeof v === "string" && ROOM_RE.test(v);
export const isPairCode = (v: unknown): v is string => typeof v === "string" && PAIR_RE.test(v);
const isId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v);

export const NAME_MAX = 16;
/** Trims, drops control/format characters and collapses spaces; null if empty or not a string. */
export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\p{C}]/gu, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
  return s.length ? s : null;
}

const BIG = 1e8;
const fin = (v: unknown, lim = BIG): v is number => isNum(v) && Math.abs(v) <= lim;
const isColor = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffff;

function parsePlayer(o: any): PlayerInfo | null {
  if (!o || typeof o !== "object" || !isId(o.id) || !isColor(o.color)) return null;
  const name = cleanName(o.name);
  return name ? { id: o.id, name, color: o.color } : null;
}

function parseRow(o: any): ResultRow | null {
  const p = parsePlayer(o);
  if (!p || !fin(o.score) || !fin(o.dist) || !(o.finish === null || fin(o.finish))) return null;
  return { ...p, score: o.score, dist: o.dist, finish: o.finish };
}

function list<T>(v: unknown, f: (o: any) => T | null, max: number): T[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: T[] = [];
  for (const o of v) {
    const r = f(o);
    if (r === null) return null;
    out.push(r);
  }
  return out;
}

export function parseMessage(raw: string): Message | null {
  if (raw.length > 8192) return null;
  let o: any;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  switch (o.t) {
    case "hello":
      if (!isRole(o.role)) return null;
      return isPairCode(o.pair) ? { t: "hello", role: o.role, pair: o.pair } : { t: "hello", role: o.role };
    case "input":
      if (!isNum(o.steer) || !isBool(o.brake) || !isBool(o.nitro) || !isNum(o.seq)) return null;
      return { t: "input", steer: Math.max(-1, Math.min(1, o.steer)), brake: o.brake, nitro: o.nitro, seq: o.seq };
    case "calibrate":
      return { t: "calibrate" };
    case "toggleMode":
      return { t: "toggleMode" };
    case "camera":
      return { t: "camera" };
    case "haptic":
      return isHaptic(o.kind) ? { t: "haptic", kind: o.kind } : null;
    case "status": {
      if (!isNum(o.score) || !isNum(o.combo) || !isNum(o.multiplier)) return null;
      if (o.extreme !== undefined && !isBool(o.extreme)) return null;
      if ((o.rank !== undefined && !isNum(o.rank)) || (o.players !== undefined && !isNum(o.players))) return null;
      const m: StatusMsg = { t: "status", score: o.score, combo: o.combo, multiplier: o.multiplier };
      if (o.extreme !== undefined) m.extreme = o.extreme;
      if (o.rank !== undefined) m.rank = o.rank;
      if (o.players !== undefined) m.players = o.players;
      return m;
    }
    case "peer":
      if (!isRole(o.role) || !isBool(o.connected)) return null;
      return { t: "peer", role: o.role, connected: o.connected };
    case "pair":
      return isPairCode(o.code) ? { t: "pair", code: o.code } : null;
    case "join": {
      const name = cleanName(o.name);
      if (!name || !(o.room === null || isRoomCode(o.room))) return null;
      return { t: "join", room: o.room, name };
    }
    case "leave":
      return { t: "leave" };
    case "config":
      if (!isMode(o.mode) || !isBool(o.extreme) || !fin(o.duration, 3600) || o.duration < 30) return null;
      return { t: "config", mode: o.mode, extreme: o.extreme, duration: Math.round(o.duration) };
    case "start":
      return { t: "start" };
    case "end":
      return { t: "end" };
    case "lobby": {
      if (!isRoomCode(o.room) || !isId(o.you) || !isId(o.host) || !isMode(o.mode) || !isBool(o.extreme)) return null;
      if (!fin(o.duration) || !isPhase(o.phase)) return null;
      const players = list(o.players, parsePlayer, MAX_PLAYERS);
      const racers = list(o.racers, (v) => (isId(v) ? v : null), MAX_PLAYERS);
      if (!players || !racers) return null;
      return { t: "lobby", room: o.room, you: o.you, host: o.host, players, mode: o.mode, extreme: o.extreme, duration: o.duration, phase: o.phase, racers };
    }
    case "round": {
      if (!(Number.isInteger(o.seed) && Math.abs(o.seed) <= 2 ** 32) || !isMode(o.mode) || !isBool(o.extreme) || !fin(o.duration) || !fin(o.startIn)) return null;
      const grid = list(o.grid, (v) => (isId(v) ? v : null), MAX_PLAYERS);
      if (!grid) return null;
      return { t: "round", seed: o.seed | 0, mode: o.mode, extreme: o.extreme, duration: o.duration, startIn: o.startIn, grid };
    }
    case "state": {
      if (o.id !== undefined && !isId(o.id)) return null;
      for (const k of ["x", "z", "h", "vx", "vz", "yr", "st", "sc", "pd", "m", "s"]) if (!fin(o[k])) return null;
      if (!isBool(o.d)) return null;
      const m: StateMsg = {
        t: "state", x: o.x, z: o.z, h: o.h, vx: o.vx, vz: o.vz, yr: o.yr, st: Math.max(-1, Math.min(1, o.st)), d: o.d,
        sc: o.sc, pd: o.pd, m: o.m, s: o.s,
      };
      if (o.id !== undefined) m.id = o.id;
      return m;
    }
    case "finish":
      return { t: "finish" };
    case "results": {
      if (!isMode(o.mode)) return null;
      const ranking = list(o.ranking, parseRow, MAX_PLAYERS);
      return ranking ? { t: "results", mode: o.mode, ranking } : null;
    }
    case "error":
      return ERRORS.has(o.code) ? { t: "error", code: o.code } : null;
    default:
      return null;
  }
}

export function encode(msg: Message): string {
  return JSON.stringify(msg);
}
