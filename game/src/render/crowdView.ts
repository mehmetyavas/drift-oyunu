import * as THREE from "three";
import type { Spectator } from "../sim/crowd";
import type { Props } from "../world/biomes";

const lam = (c: number) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const glow = (c: number) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide });
const cache = new Map<number, THREE.Material>();
const mat = (c: number) => {
  let m = cache.get(c);
  if (!m) cache.set(c, (m = lam(c)));
  return m;
};

/** Clothing palettes and accessories per biome. */
const STYLE: Record<Props, { tops: number[]; bottoms: number[]; hat: "cowboy" | "cap" | "beanie" | "hood"; flags: number[] }> = {
  desert: { tops: [0xe8603a, 0xf2c14e, 0x3a9ad9, 0xffffff, 0x8ad16a, 0xd94a8a], bottoms: [0x4a6a9a, 0x6a5a4a, 0xd8c8a8], hat: "cowboy", flags: [0xff3a3a, 0xffd23a, 0x3a8aff] },
  city: { tops: [0xff3ea5, 0x3ef2ff, 0xb84dff, 0x1a1a24, 0xf2f2f2, 0x7aff5a], bottoms: [0x15151c, 0x2a2a3a, 0x3a4a8a], hat: "cap", flags: [0xff3ea5, 0x3ef2ff, 0xb84dff] },
  snow: { tops: [0xd23a3a, 0x2a6ad2, 0x2aa86a, 0xf2c14e, 0xf2f2f2, 0x8a3ad2], bottoms: [0x2a2a34, 0x3a3a4a, 0x1a2a4a], hat: "beanie", flags: [0xd23a3a, 0xffffff, 0x2a6ad2] },
  autumn: { tops: [0x8a3a2a, 0xd2862a, 0x4a6a3a, 0x6a4a8a, 0xc8a87a, 0x2a4a6a], bottoms: [0x3a3a2a, 0x4a3a2a, 0x2a2a3a], hat: "hood", flags: [0xd2862a, 0x8a3a2a, 0xf2c14e] },
};
const SKIN = [0xf6d0ac, 0xe0ac84, 0xc68b5e, 0x8a5a3a, 0x5a3a26];
const HAIR = [0x1a120c, 0x3a2414, 0x6a4422, 0xc8a050, 0x8a2a1a, 0x9a9a9a];

const G = {
  leg: new THREE.BoxGeometry(0.15, 0.82, 0.17),
  shoe: new THREE.BoxGeometry(0.17, 0.09, 0.27),
  hips: new THREE.BoxGeometry(0.38, 0.18, 0.22),
  torso: new THREE.CylinderGeometry(0.25, 0.19, 0.62, 7),
  neck: new THREE.CylinderGeometry(0.07, 0.08, 0.1, 6),
  head: new THREE.SphereGeometry(0.17, 8, 7),
  hair: new THREE.SphereGeometry(0.175, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55),
  upperArm: new THREE.BoxGeometry(0.11, 0.34, 0.11),
  foreArm: new THREE.BoxGeometry(0.1, 0.3, 0.1),
  hand: new THREE.IcosahedronGeometry(0.065, 0),
  brim: new THREE.CylinderGeometry(0.34, 0.34, 0.03, 10),
  crown: new THREE.CylinderGeometry(0.15, 0.18, 0.18, 8),
  cap: new THREE.SphereGeometry(0.18, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
  visor: new THREE.BoxGeometry(0.26, 0.025, 0.16),
  pom: new THREE.IcosahedronGeometry(0.07, 0),
  scarf: new THREE.TorusGeometry(0.13, 0.05, 5, 10),
  pole: new THREE.CylinderGeometry(0.02, 0.02, 1.3, 4),
  flag: new THREE.PlaneGeometry(0.75, 0.48, 6, 1),
  sign: new THREE.PlaneGeometry(0.9, 0.5),
  stick: new THREE.CylinderGeometry(0.03, 0.03, 0.38, 4),
};

type View = { root: THREE.Group; armL: THREE.Object3D; armR: THREE.Object3D; flag?: THREE.Mesh };

function seeded(seed: number) {
  let s = Math.floor(seed * 2 ** 31) || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function build(kind: Props, seed: number): View {
  const st = STYLE[kind];
  const r = seeded(seed);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const top = mat(pick(st.tops));
  const bottom = mat(pick(st.bottoms));
  const skin = mat(pick(SKIN));
  const root = new THREE.Group();
  const height = 0.9 + r() * 0.22;
  const width = 0.9 + r() * 0.25;
  const body = new THREE.Group();
  body.scale.set(width, height, width);
  root.add(body);

  for (const x of [-0.1, 0.1]) {
    const leg = new THREE.Mesh(G.leg, bottom);
    leg.position.set(x, 0.41, 0);
    const shoe = new THREE.Mesh(G.shoe, mat(0x1a1a1a));
    shoe.position.set(x, 0.045, 0.04);
    body.add(leg, shoe);
  }
  const hips = new THREE.Mesh(G.hips, bottom);
  hips.position.y = 0.88;
  const torso = new THREE.Mesh(G.torso, top);
  torso.position.y = 1.27;
  const neck = new THREE.Mesh(G.neck, skin);
  neck.position.y = 1.63;
  const head = new THREE.Mesh(G.head, skin);
  head.position.y = 1.8;
  body.add(hips, torso, neck, head);

  const arm = (x: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(x, 1.52, 0);
    const upper = new THREE.Mesh(G.upperArm, top);
    upper.position.y = -0.17;
    const elbow = new THREE.Group();
    elbow.position.y = -0.34;
    elbow.rotation.x = -0.3;
    const fore = new THREE.Mesh(G.foreArm, skin);
    fore.position.y = -0.15;
    const hand = new THREE.Mesh(G.hand, skin);
    hand.position.y = -0.32;
    elbow.add(fore, hand);
    shoulder.add(upper, elbow);
    body.add(shoulder);
    return { shoulder, hand: elbow };
  };
  const L = arm(-0.3), R = arm(0.3);

  // Hair or headwear.
  const hairMat = mat(pick(HAIR));
  const hat = st.hat;
  if (hat === "cowboy" && r() < 0.75) {
    const brim = new THREE.Mesh(G.brim, mat(0x8a5a2a));
    brim.position.y = 1.93;
    const crown = new THREE.Mesh(G.crown, mat(0x8a5a2a));
    crown.position.y = 2.02;
    body.add(brim, crown);
  } else if (hat === "cap" && r() < 0.6) {
    const capMat = mat(pick(st.tops));
    const cap = new THREE.Mesh(G.cap, capMat);
    cap.position.y = 1.84;
    const visor = new THREE.Mesh(G.visor, capMat);
    visor.position.set(0, 1.86, 0.17);
    body.add(cap, visor);
  } else if (hat === "beanie") {
    const bm = mat(pick([0xf2f2f2, 0xd23a3a, 0x2a6ad2, 0xf2c14e]));
    const beanie = new THREE.Mesh(G.cap, bm);
    beanie.position.y = 1.86;
    beanie.scale.set(1.05, 1.2, 1.05);
    const pom = new THREE.Mesh(G.pom, mat(0xffffff));
    pom.position.y = 2.08;
    const scarf = new THREE.Mesh(G.scarf, bm);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 1.62;
    body.add(beanie, pom, scarf);
  } else if (hat === "hood" && r() < 0.5) {
    const hood = new THREE.Mesh(G.cap, top);
    hood.position.y = 1.8;
    hood.scale.set(1.25, 1.35, 1.25);
    body.add(hood);
  } else {
    const hair = new THREE.Mesh(G.hair, hairMat);
    hair.position.y = 1.82;
    body.add(hair);
  }

  // Some hold a flag or sign (glow sticks in the city).
  let flag: THREE.Mesh | undefined;
  const roll = r();
  if (kind === "city" && roll < 0.45) {
    const s = new THREE.Mesh(G.stick, glow(pick(st.flags)));
    s.position.y = -0.4;
    R.hand.add(s);
  } else if (roll < 0.3) {
    const pole = new THREE.Mesh(G.pole, mat(0xdddddd));
    pole.position.y = -0.1;
    flag = new THREE.Mesh(G.flag.clone(), glow(pick(st.flags)));
    flag.position.set(0.38, -0.55, 0);
    pole.add(flag);
    R.hand.add(pole);
    pole.rotation.x = Math.PI; // pole points up when the arm is raised
  } else if (kind === "city" && roll < 0.6) {
    const sign = new THREE.Mesh(G.sign, glow(pick(st.flags)));
    sign.position.set(0.3, -0.45, 0.1);
    R.hand.add(sign);
  }
  return { root, armL: L.shoulder, armR: R.shoulder, flag };
}

// ---- Group backdrops (behind each cluster of spectators) ----
const BD = {
  bale: new THREE.CylinderGeometry(0.55, 0.55, 1.3, 8),
  barrier: new THREE.BoxGeometry(1, 1.1, 0.12),
  strip: new THREE.BoxGeometry(1, 0.12, 0.14),
  bank: new THREE.IcosahedronGeometry(1, 0),
  post: new THREE.BoxGeometry(0.12, 1.2, 0.12),
  rail: new THREE.BoxGeometry(1, 0.1, 0.06),
  tape: new THREE.BoxGeometry(1, 0.08, 0.02),
  flagPole: new THREE.CylinderGeometry(0.05, 0.05, 5, 5),
  bigFlag: new THREE.PlaneGeometry(1.8, 1.1, 8, 1),
};

function backdrop(kind: Props, length: number, seed: number): { group: THREE.Group; flag?: THREE.Mesh } {
  const g = new THREE.Group();
  const r = seeded(seed + 0.5);
  let flag: THREE.Mesh | undefined;
  const n = Math.max(2, Math.round(length / 1.4));
  if (kind === "desert") {
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(BD.bale, mat(0xd8b860));
      b.rotation.z = Math.PI / 2;
      b.position.set(-length / 2 + i * 1.4 + 0.7, 0.55, 0);
      g.add(b);
    }
    const pole = new THREE.Mesh(BD.flagPole, mat(0xcccccc));
    pole.position.set(length / 2 + 0.5, 2.5, 0);
    flag = new THREE.Mesh(BD.bigFlag.clone(), glow(STYLE.desert.flags[Math.floor(r() * 3)]));
    flag.position.set(0.9, 1.8, 0);
    pole.add(flag);
    g.add(pole);
  } else if (kind === "city") {
    const panel = new THREE.Mesh(BD.barrier, mat(0x2a2a34));
    panel.scale.x = length;
    panel.position.y = 0.55;
    const strip = new THREE.Mesh(BD.strip, glow(r() < 0.5 ? 0xff3ea5 : 0x3ef2ff));
    strip.scale.x = length;
    strip.position.y = 1.1;
    g.add(panel, strip);
  } else if (kind === "snow") {
    const bank = new THREE.Mesh(BD.bank, mat(0xf4f8ff));
    bank.scale.set(length / 2 + 0.5, 0.7, 0.9);
    bank.position.y = 0.2;
    g.add(bank);
    for (let i = 0; i <= n; i++) {
      const p = new THREE.Mesh(BD.post, mat(0x2a2a2a));
      p.position.set(-length / 2 + (i * length) / n, 0.6, 0.8);
      g.add(p);
    }
    for (const [y, c] of [[1.0, 0xd23a3a], [0.75, 0xffffff]] as [number, number][]) {
      const tape = new THREE.Mesh(BD.tape, glow(c));
      tape.scale.x = length;
      tape.position.set(0, y, 0.8);
      g.add(tape);
    }
  } else {
    for (let i = 0; i <= n; i++) {
      const p = new THREE.Mesh(BD.post, mat(0x6a4a2a));
      p.position.set(-length / 2 + (i * length) / n, 0.6, 0);
      g.add(p);
    }
    for (const y of [0.45, 0.95]) {
      const rail = new THREE.Mesh(BD.rail, mat(0x8a6a3a));
      rail.scale.x = length;
      rail.position.y = y;
      g.add(rail);
    }
  }
  return { group: g, flag };
}

export class CrowdView {
  private views = new Map<Spectator, View>();
  private backdrops = new Map<Spectator, { group: THREE.Group; flag?: THREE.Mesh }>();
  private t = 0;

  constructor(private scene: THREE.Scene) {}

  add(people: Spectator[], kind: Props): void {
    for (const p of people) {
      const v = build(kind, p.seed);
      this.scene.add(v.root);
      this.views.set(p, v);
    }
    // One backdrop per cluster, set behind the people (away from the road).
    const used = new Set<Spectator>();
    for (const p of people) {
      if (used.has(p)) continue;
      const cluster = people.filter((q) => !used.has(q) && Math.hypot(q.x - p.x, q.z - p.z) < 10);
      cluster.forEach((q) => used.add(q));
      const cx = cluster.reduce((s, q) => s + q.x, 0) / cluster.length;
      const cz = cluster.reduce((s, q) => s + q.z, 0) / cluster.length;
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw); // facing the road
      const spread = Math.max(...cluster.map((q) => Math.abs((q.x - cx) * fz - (q.z - cz) * fx)));
      const bd = backdrop(kind, spread * 2 + 3, p.seed);
      bd.group.position.set(cx - fx * 2.4, 0, cz - fz * 2.4);
      bd.group.rotation.y = p.yaw;
      this.scene.add(bd.group);
      this.backdrops.set(p, bd);
    }
  }

  clear(): void {
    for (const v of this.views.values()) this.scene.remove(v.root);
    for (const bd of this.backdrops.values()) this.scene.remove(bd.group);
    this.views.clear();
    this.backdrops.clear();
  }

  /** Removes views for spectators no longer in the crowd. */
  sync(alive: Spectator[]): void {
    if (alive.length === this.views.size) return;
    const set = new Set(alive);
    for (const [p, v] of this.views) {
      if (!set.has(p)) {
        this.scene.remove(v.root);
        this.views.delete(p);
      }
    }
    for (const [p, bd] of this.backdrops) {
      if (!set.has(p)) {
        this.scene.remove(bd.group);
        this.backdrops.delete(p);
      }
    }
  }

  update(dt: number): void {
    this.t += dt;
    const wave = (m: THREE.Mesh, phase: number, amp: number) => {
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      const w = (m.geometry as THREE.PlaneGeometry).parameters.width;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + w / 2;
        pos.setZ(i, Math.sin(this.t * 7 + phase + x * 4) * amp * (x / w));
      }
      pos.needsUpdate = true;
    };
    for (const [p, v] of this.views) {
      const r = v.root;
      const phase = this.t * 9 + p.seed * 20;
      r.position.set(p.x, p.y, p.z);
      r.rotation.set(0, p.yaw, 0);
      if (p.state === "cheer") {
        r.position.y = Math.abs(Math.sin(phase)) * 0.22;
        v.armL.rotation.z = -(Math.PI - 0.5) + Math.sin(phase) * 0.45;
        v.armR.rotation.z = Math.PI - 0.5 - Math.sin(phase + 1) * 0.45;
      } else if (p.state === "panic") {
        r.position.y = Math.abs(Math.sin(phase * 1.6)) * 0.1;
        v.armL.rotation.z = -(Math.PI - 0.15) + Math.sin(phase * 3) * 0.15;
        v.armR.rotation.z = Math.PI - 0.15 - Math.sin(phase * 3) * 0.15;
      } else if (p.state === "flying") {
        r.rotation.set(p.spinX, p.yaw, p.spinZ);
        v.armL.rotation.z = -Math.PI * 0.8;
        v.armR.rotation.z = Math.PI * 0.8;
      } else {
        r.rotation.set(Math.PI / 2, p.yaw, 0);
        r.position.y = 0.2;
        v.armL.rotation.z = -0.3;
        v.armR.rotation.z = 0.3;
      }
      if (v.flag && (p.state === "cheer" || p.state === "panic")) wave(v.flag, p.seed * 10, 0.12);
    }
    for (const [p, bd] of this.backdrops) if (bd.flag) wave(bd.flag, p.seed * 10, 0.25);
  }
}
