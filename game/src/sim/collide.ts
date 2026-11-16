import type { CarState } from "./car";

/** Each car is two circles along its length: cheap and close enough to a 4.4 × 1.9 m body. */
export const BODY_OFFSET = 1.15;
export const BODY_RADIUS = 1.0;
const RESTITUTION = 0.35;

export type Body = { x: number; z: number; heading: number; vx: number; vz: number };
export type Bump = { car: CarState; impact: number };

function circles(b: Body): [number, number][] {
  const fx = Math.sin(b.heading) * BODY_OFFSET, fz = Math.cos(b.heading) * BODY_OFFSET;
  return [[b.x + fx, b.z + fz], [b.x - fx, b.z - fz]];
}

/**
 * Pushes `me` out of `other` and bounces its velocity along the contact normal (equal masses).
 * Each client resolves its own car, so both sides end up separated. null when not touching.
 */
export function collide(me: CarState, other: Body): Bump | null {
  if ((me.x - other.x) ** 2 + (me.z - other.z) ** 2 > (2 * (BODY_OFFSET + BODY_RADIUS)) ** 2) return null;
  let best: { nx: number; nz: number; depth: number } | null = null;
  for (const [ax, az] of circles(me)) {
    for (const [bx, bz] of circles(other)) {
      const dx = ax - bx, dz = az - bz;
      const d = Math.hypot(dx, dz);
      const depth = 2 * BODY_RADIUS - d;
      if (depth > 0 && (!best || depth > best.depth)) {
        best = d > 1e-6 ? { nx: dx / d, nz: dz / d, depth } : { nx: 1, nz: 0, depth };
      }
    }
  }
  if (!best) return null;
  const { nx, nz, depth } = best;
  // Relative velocity along the normal; only bounce when closing.
  const vn = (me.vx - other.vx) * nx + (me.vz - other.vz) * nz;
  let vx = me.vx, vz = me.vz;
  if (vn < 0) {
    const j = (-(1 + RESTITUTION) * vn) / 2;
    vx += j * nx;
    vz += j * nz;
  }
  // Half the overlap each (the other client moves its own car the other half), plus a hair.
  const push = depth / 2 + 0.01;
  return {
    car: { ...me, x: me.x + nx * push, z: me.z + nz * push, vx, vz },
    impact: Math.max(0, -vn),
  };
}
