import * as THREE from "three";
import { speedOf, type CarState } from "../sim/car";
import { TUNING } from "../sim/tuning";

export type CameraMode = "chase" | "far" | "hood" | "bumper" | "heli" | "tv";
export const CAMERA_MODES: CameraMode[] = ["chase", "far", "hood", "bumper", "heli", "tv"];
export const CAMERA_NAMES: Record<CameraMode, string> = {
  chase: "TAKİP KAMERASI",
  far: "UZAK TAKİP",
  hood: "KAPUT KAMERASI",
  bumper: "TAMPON KAMERASI",
  heli: "HELİKOPTER",
  tv: "TV KAMERASI",
};

/** Per-mode framing. Offsets are in the car's frame: back (−) / forward (+), height. */
type Rig = {
  back: number; height: number; lookAhead: number; lookHeight: number;
  /** 0 = follow the heading exactly, 1 = follow the travel direction. */
  travelBlend: number;
  /** Position smoothing rate (1/s); Infinity = rigid mount. */
  stiffness: number;
  baseFov: number;
  /** Hide the player's own car (cameras inside/under the body). */
  hideCar: boolean;
};

const RIGS: Record<Exclude<CameraMode, "tv">, Rig> = {
  chase: { back: -8.5, height: 3.6, lookAhead: 6, lookHeight: 1.2, travelBlend: 0.55, stiffness: 10, baseFov: 62, hideCar: false },
  far: { back: -14, height: 5.6, lookAhead: 10, lookHeight: 1.0, travelBlend: 0.45, stiffness: 7, baseFov: 58, hideCar: false },
  hood: { back: 0.55, height: 1.42, lookAhead: 30, lookHeight: 1.0, travelBlend: 0, stiffness: Infinity, baseFov: 70, hideCar: false },
  bumper: { back: 2.45, height: 0.62, lookAhead: 30, lookHeight: 0.7, travelBlend: 0, stiffness: Infinity, baseFov: 74, hideCar: true },
  heli: { back: -18, height: 26, lookAhead: 14, lookHeight: 0, travelBlend: 0.3, stiffness: 4, baseFov: 55, hideCar: false },
};

/** Roadside TV camera: plants itself ahead of the car and pans as it goes by. */
const TV_LEAD = 70;
const TV_SIDE = 16;
const TV_RESET = 45;

export class ChaseCamera {
  mode: CameraMode = "chase";
  private shakeAmt = 0;
  private punchAmt = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private init = false;
  private tvSpot: THREE.Vector3 | null = null;
  private tvSide = 1;

  constructor(private cam: THREE.PerspectiveCamera) {}

  /** Narrow the FOV briefly (degrees) — pulls the player in on a combo. */
  punch(deg: number): void {
    this.punchAmt = Math.max(this.punchAmt, deg);
  }
  /** Camera shake (metres of jitter, decays quickly). */
  shake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  setMode(m: CameraMode): void {
    this.mode = m;
    this.tvSpot = null;
    this.init = false;
  }

  next(): CameraMode {
    this.setMode(CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length]);
    return this.mode;
  }

  /** Whether the player's own car should be drawn in this mode. */
  get showCar(): boolean {
    return this.mode === "tv" || !RIGS[this.mode].hideCar;
  }

  update(c: CarState, dt: number, nitro: boolean): void {
    const speed = speedOf(c);
    const vh = speed > 1 ? Math.atan2(c.vx, c.vz) : c.heading;
    let d = vh - c.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));

    let wantPos: THREE.Vector3, wantLook: THREE.Vector3, baseFov: number, stiffness: number;
    if (this.mode === "tv") {
      const fx = Math.sin(vh), fz = Math.cos(vh);
      const along = this.tvSpot ? (this.tvSpot.x - c.x) * fx + (this.tvSpot.z - c.z) * fz : -Infinity;
      if (!this.tvSpot || along < -TV_RESET || Math.hypot(this.tvSpot.x - c.x, this.tvSpot.z - c.z) > TV_LEAD * 2) {
        this.tvSide = -this.tvSide;
        this.tvSpot = new THREE.Vector3(c.x + fx * TV_LEAD - fz * TV_SIDE * this.tvSide, 2.2, c.z + fz * TV_LEAD + fx * TV_SIDE * this.tvSide);
        this.init = false;
      }
      wantPos = this.tvSpot.clone();
      wantLook = new THREE.Vector3(c.x, 0.9, c.z);
      const dist = this.tvSpot.distanceTo(new THREE.Vector3(c.x, 2.2, c.z));
      baseFov = THREE.MathUtils.clamp(2 * Math.atan(9 / dist) * THREE.MathUtils.RAD2DEG, 14, 60); // zoom to keep the car framed
      stiffness = Infinity;
    } else {
      const r = RIGS[this.mode];
      const h = c.heading + d * r.travelBlend;
      const fx = Math.sin(h), fz = Math.cos(h);
      wantPos = new THREE.Vector3(c.x + fx * r.back, r.height, c.z + fz * r.back);
      wantLook = new THREE.Vector3(c.x + fx * (r.back + r.lookAhead), r.lookHeight, c.z + fz * (r.back + r.lookAhead));
      baseFov = r.baseFov;
      stiffness = r.stiffness;
    }

    const k = !this.init || stiffness === Infinity ? 1 : 1 - Math.exp(-stiffness * dt);
    this.init = true;
    this.pos.lerp(wantPos, k);
    this.look.lerp(wantLook, k);
    this.cam.position.copy(this.pos);
    if (this.shakeAmt > 0.01) {
      const s = this.mode === "hood" || this.mode === "bumper" ? 0.35 : 1;
      this.cam.position.x += (Math.random() - 0.5) * this.shakeAmt * s;
      this.cam.position.y += (Math.random() - 0.5) * this.shakeAmt * s;
      this.shakeAmt *= Math.exp(-6 * dt);
    }
    this.cam.lookAt(this.look);
    const speedFov = this.mode === "tv" ? 0 : Math.max(0, speed - TUNING.cruiseSpeed * 0.6) * 0.45 + (nitro ? 8 : 0);
    const fov = Math.min(92, baseFov + speedFov);
    this.cam.fov += (fov - this.punchAmt - this.cam.fov) * Math.min(1, (this.punchAmt > 0.5 || this.mode === "tv" ? 12 : 3) * dt);
    this.punchAmt *= Math.exp(-3.5 * dt);
    this.cam.updateProjectionMatrix();
  }

  snap(): void {
    this.init = false;
    this.tvSpot = null;
  }
}
