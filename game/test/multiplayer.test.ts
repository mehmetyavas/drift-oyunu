import { describe, it, expect } from "vitest";
import { collide, BODY_RADIUS } from "../src/sim/collide";
import { createCar } from "../src/sim/car";
import { RemoteTrack, INTERP_DELAY } from "../src/net/remote";
import { Road } from "../src/sim/road";
import { gridSlot, rank, MAX_PLAYERS } from "@drift/shared";
import type { StateMsg } from "@drift/shared";

const snap = (x: number, z: number, h = 0): StateMsg => ({ t: "state", x, z, h, vx: 0, vz: 10, yr: 0, st: 0, d: false, sc: 0, pd: 0, m: 1, s: z });

describe("car-car collision", () => {
  it("ignores cars that are apart", () => {
    expect(collide(createCar(0, 0, 0, 20), { x: 10, z: 0, heading: 0, vx: 0, vz: 20 })).toBeNull();
  });

  it("pushes apart side by side and bounces the closing speed", () => {
    const me = { ...createCar(0, 0, 0, 0), vx: 5, vz: 30 }; // drifting right into the other car
    const hit = collide(me, { x: 1.5, z: 0, heading: 0, vx: 0, vz: 30 })!;
    expect(hit).not.toBeNull();
    expect(hit.car.x).toBeLessThan(0);
    expect(hit.car.vx).toBeCloseTo(1.625, 5); // equal masses, e = 0.35: (5 + 0)/2 - 0.35 * 5/2
    expect(hit.impact).toBeCloseTo(5, 5);
  });

  it("a rear-end hit slows the car behind", () => {
    const me = createCar(0, 0, 0, 40);
    const hit = collide(me, { x: 0, z: 4, heading: 0, vx: 0, vz: 20 })!;
    expect(hit.car.vz).toBeLessThan(40);
    expect(hit.car.z).toBeLessThan(0);
  });

  it("resolving both sides separates them", () => {
    let a = createCar(0, 0, 0, 30);
    let b = createCar(1.2, 0.5, 0, 30);
    for (let i = 0; i < 5; i++) {
      const ha = collide(a, b);
      const hb = collide(b, a);
      if (ha) a = ha.car;
      if (hb) b = hb.car;
    }
    expect(collide(a, b)).toBeNull();
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2 * BODY_RADIUS - 0.05);
  });
});

describe("remote interpolation", () => {
  it("blends between snapshots with a fixed delay", () => {
    const r = new RemoteTrack();
    r.push(snap(0, 0), 1000);
    r.push(snap(10, 0), 1050);
    const s = r.sample(1025 + INTERP_DELAY)!;
    expect(s.car.x).toBeCloseTo(5);
  });

  it("dead-reckons briefly past the last snapshot, then holds", () => {
    const r = new RemoteTrack();
    r.push(snap(0, 0), 1000);
    expect(r.sample(1000 + INTERP_DELAY + 100)!.car.z).toBeCloseTo(1);
    expect(r.sample(1000 + INTERP_DELAY + 5000)!.car.z).toBeCloseTo(2.5);
  });

  it("takes the short way round when heading wraps", () => {
    const r = new RemoteTrack();
    r.push(snap(0, 0, Math.PI - 0.1), 0);
    r.push(snap(0, 0, -Math.PI + 0.1), 100);
    const h = r.sample(50 + INTERP_DELAY)!.car.heading;
    expect(Math.abs(Math.abs(h) - Math.PI)).toBeLessThan(0.01);
  });
});

describe("shared track", () => {
  it("the same seed builds the same road regardless of how fast it is extended", () => {
    const a = new Road(1234), b = new Road(1234);
    a.ensureAhead(0);
    for (let s = 0; s < 3000; s += 37) b.ensureAhead(s);
    a.ensureAhead(3000 - 37 * 0);
    const pa = a.pointAt(2500)!, pb = b.pointAt(2500)!;
    expect(pa.x).toBeCloseTo(pb.x, 6);
    expect(pa.z).toBeCloseTo(pb.z, 6);
  });

  it("grid slots sit on the road and do not overlap", () => {
    const road = new Road(1);
    road.ensureAhead(0);
    const slots = Array.from({ length: MAX_PLAYERS }, (_, i) => gridSlot(i));
    for (const s of slots) expect(road.nearest(s.x, s.z).distance).toBeLessThan(road.halfWidth);
    for (let i = 0; i < slots.length; i++)
      for (let j = i + 1; j < slots.length; j++)
        expect(Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z)).toBeGreaterThan(5);
  });

  it("race ranking: finishers by time, then distance", () => {
    const rows = [
      { id: "a", score: 9, dist: 3000, finish: null },
      { id: "b", score: 1, dist: 4000, finish: 90 },
      { id: "c", score: 5, dist: 4000, finish: 85 },
      { id: "d", score: 0, dist: 3500, finish: null },
    ];
    expect(rank(rows, "race").map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
    expect(rank(rows, "battle").map((r) => r.id)).toEqual(["a", "c", "b", "d"]);
  });
});
