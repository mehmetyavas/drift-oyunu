import * as THREE from "three";
import type { RoadPoint } from "../sim/road";
import { mulberry32 } from "../sim/rng";
import type { Props } from "../world/biomes";
import { makeProp, makeLamp } from "./props";

const CHUNK_POINTS = 25; // 50 m
const asphalt = new THREE.MeshLambertMaterial({ color: 0x3a3340, side: THREE.DoubleSide });
const paint = new THREE.MeshBasicMaterial({ color: 0xf4e6d8, side: THREE.DoubleSide });

export function setRoadColors(asphaltColor: number, paintColor: number): void {
  asphalt.color.setHex(asphaltColor);
  paint.color.setHex(paintColor);
}

/** Ribbon between lateral offsets a..b. With dashLen, only every other run of dashLen points is drawn. */
function ribbon(pts: RoadPoint[], a: number, b: number, y: number, dashLen = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    if (dashLen && Math.floor(pts[i].s / 2 / dashLen) % 2 === 1) continue;
    const quad = [pts[i], pts[i + 1]].map((p) => {
      const nx = Math.cos(p.heading), nz = -Math.sin(p.heading);
      return [p.x + nx * a, p.z + nz * a, p.x + nx * b, p.z + nz * b];
    });
    const [[ax0, az0, bx0, bz0], [ax1, az1, bx1, bz1]] = quad;
    pos.push(ax0, y, az0, bx0, y, bz0, ax1, y, az1, bx0, y, bz0, bx1, y, bz1, ax1, y, az1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

type Chunk = { endS: number; group: THREE.Group; owned: THREE.BufferGeometry[] };

export class RoadMesh {
  private pending: RoadPoint[] = [];
  private chunks: Chunk[] = [];

  constructor(
    private scene: THREE.Scene,
    private halfWidth: number,
    private seed: number,
    private propsAt: (s: number) => Props,
    private onChunk?: (pts: RoadPoint[], kind: Props) => void,
  ) {}

  addPoints(points: RoadPoint[]): void {
    this.pending.push(...points);
    while (this.pending.length > CHUNK_POINTS) {
      const pts = this.pending.slice(0, CHUNK_POINTS + 1); // overlap one point so chunks join
      this.pending = this.pending.slice(CHUNK_POINTS);
      this.build(pts);
    }
  }

  private build(pts: RoadPoint[]) {
    const hw = this.halfWidth;
    const owned = [
      ribbon(pts, -hw, hw, 0),
      ribbon(pts, -hw + 0.4, -hw + 0.7, 0.02),
      ribbon(pts, hw - 0.7, hw - 0.4, 0.02),
      ribbon(pts, -0.15, 0.15, 0.02, 3),
    ];
    const group = new THREE.Group();
    group.add(new THREE.Mesh(owned[0], asphalt));
    for (const g of owned.slice(1)) group.add(new THREE.Mesh(g, paint));

    // Scenery, seeded per chunk so it is stable; kind follows the biome.
    const kind = this.propsAt(pts[0].s);
    const rand = mulberry32(this.seed ^ Math.floor(pts[0].s));
    const city = kind === "city";
    const count = city ? 3 + Math.floor(rand() * 3) : 4 + Math.floor(rand() * 6);
    for (let i = 0; i < count; i++) {
      const p = pts[Math.floor(rand() * pts.length)];
      const side = rand() < 0.5 ? -1 : 1;
      const off = side * (hw + (city ? 12 : 5) + rand() * 50);
      const x = p.x + Math.cos(p.heading) * off, z = p.z - Math.sin(p.heading) * off;
      group.add(...makeProp(kind, x, z, rand));
    }
    if (city) {
      // Street lamps on both sides, arms reaching over the road.
      for (const [i, side] of [[6, 1], [19, -1]] as [number, number][]) {
        const p = pts[i];
        const nx = Math.cos(p.heading), nz = -Math.sin(p.heading);
        const off = side * (hw + 2.5);
        group.add(makeLamp(p.x + nx * off, p.z + nz * off, Math.atan2(-nx * side, -nz * side)));
      }
    }
    this.scene.add(group);
    this.onChunk?.(pts, kind);
    this.chunks.push({ endS: pts[pts.length - 1].s, group, owned });
  }

  /** Drop every chunk and start over on a new seed (multiplayer rounds share one track). */
  reset(seed: number): void {
    this.trim(Infinity);
    this.pending = [];
    this.seed = seed;
  }

  trim(beforeS: number): void {
    while (this.chunks.length && this.chunks[0].endS < beforeS) {
      const c = this.chunks.shift()!;
      this.scene.remove(c.group);
      c.owned.forEach((g) => g.dispose());
    }
  }
}
