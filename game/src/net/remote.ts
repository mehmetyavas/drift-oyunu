import type { StateMsg } from "@drift/shared";
import type { CarState } from "../sim/car";

/** Render remote cars this far in the past so there are two snapshots to blend between. */
export const INTERP_DELAY = 120;
/** Extrapolate at most this long when snapshots stop (ms). */
const MAX_EXTRAPOLATE = 250;
const KEEP = 20;

type Snap = { at: number; m: StateMsg };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Snapshot buffer for one remote car with time-delayed interpolation. */
export class RemoteTrack {
  private snaps: Snap[] = [];

  push(m: StateMsg, at: number): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && at <= last.at) at = last.at + 1;
    this.snaps.push({ at, m });
    if (this.snaps.length > KEEP) this.snaps.shift();
  }

  get latest(): StateMsg | null {
    return this.snaps[this.snaps.length - 1]?.m ?? null;
  }

  /** Time of the newest snapshot, or -Infinity. */
  get lastAt(): number {
    return this.snaps[this.snaps.length - 1]?.at ?? -Infinity;
  }

  /** Car state at local time `now` (already delayed internally), or null before the first snapshot. */
  sample(now: number): { car: CarState; steer: number } | null {
    const n = this.snaps.length;
    if (!n) return null;
    const t = now - INTERP_DELAY;
    let i = n - 1;
    while (i > 0 && this.snaps[i - 1].at > t) i--;
    const b = this.snaps[i];
    const a = i > 0 ? this.snaps[i - 1] : null;
    let x: number, z: number, h: number;
    if (a && t <= b.at) {
      const k = Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at)));
      x = a.m.x + (b.m.x - a.m.x) * k;
      z = a.m.z + (b.m.z - a.m.z) * k;
      h = a.m.h + wrap(b.m.h - a.m.h) * k;
    } else {
      // Past the newest snapshot: dead-reckon briefly.
      const dt = Math.max(0, Math.min(MAX_EXTRAPOLATE, t - b.at)) / 1000;
      x = b.m.x + b.m.vx * dt;
      z = b.m.z + b.m.vz * dt;
      h = b.m.h + b.m.yr * dt;
    }
    const m = b.m;
    return {
      car: { x, z, heading: h, vx: m.vx, vz: m.vz, yawRate: m.yr, drifting: m.d, lowSlipTime: 0 },
      steer: m.st,
    };
  }
}
