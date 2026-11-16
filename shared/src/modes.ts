export type Mode = "free" | "battle" | "ghost" | "race";
export const MODES: Mode[] = ["battle", "race", "ghost", "free"];

export type ModeInfo = {
  name: string;
  desc: string;
  /** Cars bump into each other. */
  collisions: boolean;
  /** Round ends when the timer runs out. */
  timed: boolean;
  /** Ranked by distance; first to RACE_LENGTH wins. */
  race: boolean;
};

export const MODE_INFO: Record<Mode, ModeInfo> = {
  battle: { name: "Drift Savaşı", desc: "Süre dolana kadar en çok drift puanını topla. Çarpışmak komboyu bozar.", collisions: true, timed: true, race: false },
  race: { name: "Yarış", desc: "Bitiş çizgisine ilk ulaşan kazanır. İtiş kakış serbest.", collisions: true, timed: false, race: true },
  ghost: { name: "Hayalet Drift", desc: "Arabalar birbirinin içinden geçer, yalnız puan yarışı.", collisions: false, timed: true, race: false },
  free: { name: "Serbest", desc: "Süre yok. Birlikte sür, canlı sıralamayı izle.", collisions: true, timed: false, race: false },
};

/** Race distance along the road (m). */
export const RACE_LENGTH = 4000;
/** Race ends this long after the first finisher (s). */
export const RACE_GRACE = 30;
/** Hard cap for untimed rounds except free (s). */
export const RACE_CAP = 360;
export const DURATIONS = [120, 180, 300];
export const MAX_PLAYERS = 8;

export function isMode(v: unknown): v is Mode {
  return v === "free" || v === "battle" || v === "ghost" || v === "race";
}

export type Standing = { id: string; score: number; dist: number; finish: number | null };

/** Sorted best first. Race: finishers by time, then by distance. Others: by score. */
export function rank<T extends Standing>(list: T[], mode: Mode): T[] {
  const out = [...list];
  if (MODE_INFO[mode].race) {
    out.sort((a, b) => {
      if (a.finish !== null && b.finish !== null) return a.finish - b.finish;
      if (a.finish !== null) return -1;
      if (b.finish !== null) return 1;
      return b.dist - a.dist;
    });
  } else out.sort((a, b) => b.score - a.score);
  return out;
}

/** Starting grid: two columns, rows 9 m apart, first row ahead. */
export function gridSlot(i: number): { x: number; z: number } {
  const row = Math.floor(i / 2);
  return { x: i % 2 === 0 ? -4 : 4, z: 24 - row * 9 };
}

export const PLAYER_COLORS = [0xff4a3a, 0x3ab0ff, 0xffd23a, 0x5be37d, 0xc06bff, 0xff8ad8, 0xffffff, 0xff8a2a];
