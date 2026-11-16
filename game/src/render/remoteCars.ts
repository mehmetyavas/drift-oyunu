import * as THREE from "three";
import type { PlayerInfo } from "@drift/shared";
import { CarModel } from "./carModel";
import type { RemoteTrack } from "../net/remote";

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

/** Name plate drawn on a canvas (never HTML), so player names cannot inject markup. */
function nameTag(name: string, color: number): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.font = "800 60px system-ui, sans-serif";
  const w = Math.min(500, g.measureText(name).width + 70);
  const x = (512 - w) / 2;
  g.fillStyle = "rgba(10,6,18,0.72)";
  g.beginPath();
  g.roundRect(x, 22, w, 84, 42);
  g.fill();
  g.fillStyle = hex(color);
  g.beginPath();
  g.arc(x + 40, 64, 13, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#fff";
  g.textBaseline = "middle";
  g.fillText(name, x + 62, 66, w - 76);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(4, 1, 1);
  s.position.y = 2.6;
  s.renderOrder = 10;
  return s;
}

type View = { model: CarModel; tag: THREE.Sprite; ghost: boolean | null };

/** Draws the other players' cars from their interpolated tracks. */
export class RemoteCars {
  private views = new Map<string, View>();

  constructor(private scene: THREE.Scene) {}

  /** Make sure there is exactly one model per remote player. */
  sync(players: PlayerInfo[], me: string | null): void {
    const want = new Map(players.filter((p) => p.id !== me).map((p) => [p.id, p]));
    for (const [id, v] of this.views) {
      if (!want.has(id)) {
        this.scene.remove(v.model.root);
        this.views.delete(id);
      }
    }
    for (const [id, p] of want) {
      if (this.views.has(id)) continue;
      const model = new CarModel({ paint: p.color, beam: false });
      const tag = nameTag(p.name, p.color);
      model.root.add(tag);
      model.root.visible = false;
      this.scene.add(model.root);
      this.views.set(id, { model, tag, ghost: null });
    }
  }

  clear(): void {
    this.sync([], null);
  }

  update(
    tracks: Map<string, RemoteTrack>, now: number, dt: number,
    opts: { ghost: boolean; lights: number; active: Set<string>; camera: THREE.Vector3 },
  ): void {
    for (const [id, v] of this.views) {
      const tr = tracks.get(id);
      const s = opts.active.has(id) ? tr?.sample(now) : null;
      v.model.root.visible = !!s;
      if (!s) continue;
      // Up close the plate would cover the screen; it only helps from a distance.
      v.tag.visible = Math.hypot(s.car.x - opts.camera.x, s.car.z - opts.camera.z) > 9;
      v.model.update(s.car, { steer: s.steer, brake: false, nitro: false }, dt);
      v.model.setLights(opts.lights);
      if (v.ghost !== opts.ghost) {
        v.ghost = opts.ghost;
        v.model.root.traverse((o) => {
          const mats = (o as THREE.Mesh).material;
          if (!mats || o === v.tag) return;
          for (const m of Array.isArray(mats) ? mats : [mats]) {
            const u = m.userData;
            if (u.baseOpacity === undefined) {
              u.baseOpacity = m.opacity;
              u.wasTransparent = m.transparent;
              u.baseDepthWrite = m.depthWrite;
            }
            m.transparent = opts.ghost || u.wasTransparent;
            m.opacity = opts.ghost ? u.baseOpacity * 0.38 : u.baseOpacity;
            m.depthWrite = opts.ghost ? false : u.baseDepthWrite;
            m.needsUpdate = true;
          }
        });
      }
    }
  }
}
