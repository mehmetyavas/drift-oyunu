import * as THREE from "three";

const SKID_MAX = 3000; // quads in the ring buffer → bounded memory

/** Tire marks for N wheels, stored in a fixed ring buffer of quads. */
export class SkidMarks {
  private pos = new Float32Array(SKID_MAX * 18);
  private geo = new THREE.BufferGeometry();
  private next = 0;
  private last: ([number, number] | null)[];

  constructor(scene: THREE.Scene, wheels: number) {
    this.last = new Array(wheels).fill(null);
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    const mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshBasicMaterial({ color: 0x1a1420, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
  }

  clear(): void {
    this.pos.fill(0);
    this.next = 0;
    this.last.fill(null);
    this.geo.attributes.position.needsUpdate = true;
  }

  /** Pass null to break the trail (not drifting). */
  update(wheels: ([number, number] | null)[]): void {
    let dirty = false;
    wheels.forEach((w, i) => {
      const prev = this.last[i];
      this.last[i] = w;
      if (!w || !prev) return;
      const dx = w[0] - prev[0], dz = w[1] - prev[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.05 || len > 5) return;
      const nx = (-dz / len) * 0.17, nz = (dx / len) * 0.17, y = 0.03;
      const q = [
        prev[0] - nx, y, prev[1] - nz, prev[0] + nx, y, prev[1] + nz, w[0] - nx, y, w[1] - nz,
        prev[0] + nx, y, prev[1] + nz, w[0] + nx, y, w[1] + nz, w[0] - nx, y, w[1] - nz,
      ];
      this.pos.set(q, this.next * 18);
      this.next = (this.next + 1) % SKID_MAX;
      dirty = true;
    });
    if (dirty) this.geo.attributes.position.needsUpdate = true;
  }
}

function puffTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

type Puff = { sprite: THREE.Sprite; age: number; life: number; vx: number; vz: number };
const SMOKE_MAX = 140;

export class Smoke {
  private puffs: Puff[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene) {
    const tex = puffTexture();
    for (let i = 0; i < SMOKE_MAX; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, color: 0xf3e3e8, transparent: true, opacity: 0, depthWrite: false, fog: true }),
      );
      sprite.visible = false;
      scene.add(sprite);
      this.puffs.push({ sprite, age: 0, life: 0, vx: 0, vz: 0 });
    }
  }

  emit(x: number, z: number, vx: number, vz: number): void {
    const p = this.puffs[this.cursor];
    this.cursor = (this.cursor + 1) % SMOKE_MAX;
    p.age = 0;
    p.life = 1 + Math.random() * 0.5;
    p.vx = vx * 0.25 + (Math.random() - 0.5) * 2;
    p.vz = vz * 0.25 + (Math.random() - 0.5) * 2;
    p.sprite.position.set(x, 0.4, z);
    p.sprite.visible = true;
  }

  update(dt: number): void {
    for (const p of this.puffs) {
      if (!p.sprite.visible) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.sprite.visible = false;
        continue;
      }
      const t = p.age / p.life;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.z += p.vz * dt;
      p.sprite.position.y += 1.2 * dt;
      p.sprite.scale.setScalar(1.2 + t * 4);
      (p.sprite.material as THREE.SpriteMaterial).opacity = 0.45 * (1 - t);
    }
  }
}
