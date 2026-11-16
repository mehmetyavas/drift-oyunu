import { rollFromGravity, steerFromRoll, lowPass } from "@drift/shared";

const MODE_KEY = "drift.touchMode";
const INVERT_KEY = "drift.touchInvert";
/** Degrees of phone rotation for full lock (same feel as the Expo controller). */
const TILT_RANGE = 25;

type Mode = "tilt" | "buttons";
type MotionPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

/** Phones and tablets: play directly in the browser. ?touch=1 forces it on for testing. */
export function isTouchDevice(): boolean {
  const forced = new URLSearchParams(location.search).get("touch");
  if (forced !== null) return forced !== "0";
  return matchMedia("(pointer: coarse)").matches && "ontouchstart" in window;
}

function load(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function save(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

type Opts = { onCamera(): void; onMenu(): void };

/**
 * On-screen controls for playing on the phone itself: tilt (or ◀ ▶) to steer, FREN / NİTRO pedals,
 * camera and menu buttons. Multi-touch via pointer events; nothing here scrolls or zooms the page.
 */
export class TouchControls {
  readonly enabled = isTouchDevice();
  /** True once the player has touched a control or tilted (starts the game like a key press). */
  used = false;
  private mode: Mode = (load(MODE_KEY) as Mode) === "buttons" ? "buttons" : "tilt";
  private invert = load(INVERT_KEY) === "1";
  private held = new Map<string, Set<number>>();
  private roll: number | null = null;
  private center: number | null = null;
  private tiltSteer = 0;
  private motionSeen = false;
  private root = document.getElementById("touch")!;
  private modeBtn!: HTMLButtonElement;
  private steerKnob!: HTMLElement;

  constructor(private opts: Opts) {
    if (!this.enabled) return;
    document.documentElement.classList.add("touch");
    this.build();
    addEventListener("devicemotion", (e) => this.onMotion(e));
    // No motion events after a while (desktop browser, blocked sensor): fall back to buttons.
    setTimeout(() => {
      if (!this.motionSeen && this.mode === "tilt" && !isIOS()) this.setMode("buttons");
    }, 1500);
    this.setMode(this.mode);
  }

  private hold(id: string, el: HTMLElement): void {
    const set = new Set<number>();
    this.held.set(id, set);
    const on = (e: PointerEvent) => {
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId); // keep the press even if the finger slides off the button
      } catch {
        /* pointer already gone */
      }
      set.add(e.pointerId);
      el.classList.add("on");
      this.used = true;
    };
    const off = (e: PointerEvent) => {
      set.delete(e.pointerId);
      if (!set.size) el.classList.remove("on");
    };
    el.addEventListener("pointerdown", on);
    el.addEventListener("pointerup", off);
    el.addEventListener("pointercancel", off);
    el.addEventListener("lostpointercapture", off);
  }

  private btn(cls: string, label: string, aria: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = label;
    b.setAttribute("aria-label", aria);
    b.type = "button";
    return b;
  }

  private build(): void {
    const left = this.btn("tc-pad tc-left", "◀", "Sola");
    const right = this.btn("tc-pad tc-right", "▶", "Sağa");
    const brake = this.btn("tc-pedal tc-brake", "FREN", "Fren");
    const nitro = this.btn("tc-pedal tc-nitro", "NİTRO", "Nitro");
    const cam = this.btn("tc-small tc-cam", "🎥", "Kamera değiştir");
    const menu = this.btn("tc-small tc-menu", "☰", "Menü");
    this.modeBtn = this.btn("tc-small tc-mode", "", "Direksiyon modu");
    const center = this.btn("tc-small tc-center", "🎯", "Direksiyonu ortala");
    const flip = this.btn("tc-small tc-flip", "↔", "Yönü çevir");
    this.steerKnob = document.createElement("div");
    this.steerKnob.className = "tc-wheel";
    this.steerKnob.setAttribute("aria-hidden", "true");
    this.hold("left", left);
    this.hold("right", right);
    this.hold("brake", brake);
    this.hold("nitro", nitro);
    cam.addEventListener("click", () => this.opts.onCamera());
    menu.addEventListener("click", () => this.opts.onMenu());
    this.modeBtn.addEventListener("click", () => this.setMode(this.mode === "tilt" ? "buttons" : "tilt"));
    center.addEventListener("click", () => (this.center = this.roll));
    flip.addEventListener("click", () => {
      this.invert = !this.invert;
      save(INVERT_KEY, this.invert ? "1" : "0");
    });
    const top = document.createElement("div");
    top.className = "tc-top";
    top.append(menu, cam, this.modeBtn, center, flip);
    const rot = document.createElement("div");
    rot.className = "tc-rotate";
    rot.textContent = "📱↻ Daha iyi sürüş için telefonu yan çevir";
    this.root.replaceChildren(top, left, right, this.steerKnob, brake, nitro, rot);
    this.root.addEventListener("contextmenu", (e) => e.preventDefault());
    // First touch anywhere: go fullscreen and try to lock landscape (Android; iOS ignores both).
    const immerse = () => {
      const d = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
      try {
        const p = d.requestFullscreen?.({ navigationUI: "hide" }) ?? d.webkitRequestFullscreen?.();
        Promise.resolve(p)
          .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape"))
          .catch(() => {});
      } catch {
        /* not allowed here */
      }
    };
    addEventListener("pointerdown", immerse, { once: true });
  }

  private async setMode(m: Mode): Promise<void> {
    if (m === "tilt") {
      const DM = (window as unknown as { DeviceMotionEvent?: MotionPermission }).DeviceMotionEvent;
      if (DM?.requestPermission) {
        // iOS: must be asked from a tap. If this call is not from one, the mode button asks again.
        try {
          if ((await DM.requestPermission()) !== "granted") m = "buttons";
        } catch {
          m = "buttons";
        }
      }
    }
    this.mode = m;
    save(MODE_KEY, m);
    this.root.dataset.mode = m;
    this.modeBtn.textContent = m === "tilt" ? "📱" : "🕹️";
    this.modeBtn.setAttribute("aria-label", m === "tilt" ? "Eğerek sürüş açık — düğmelere geç" : "Düğmeyle sürüş açık — eğerek sürüşe geç");
    this.center = this.roll;
  }

  private onMotion(e: DeviceMotionEvent): void {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null) return;
    this.motionSeen = true;
    // Rotation in the screen plane, from gravity; corrected for the current landscape side.
    const angle = (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number;
    let r = rollFromGravity(g.x, g.y) + angle;
    if (isIOS()) r = -r; // Safari reports gravity with the opposite sign
    this.roll = this.roll === null ? r : this.roll + lowPass(0, ((r - this.roll + 540) % 360) - 180, 0.5);
    if (this.center === null) this.center = this.roll;
    const s = steerFromRoll(this.roll, this.center, { range: TILT_RANGE });
    this.tiltSteer = s * (this.invert ? -1 : 1);
    if (this.mode === "tilt" && Math.abs(this.tiltSteer) > 0.15) this.used = true;
  }

  private pressed(id: string): boolean {
    return (this.held.get(id)?.size ?? 0) > 0;
  }

  read(): { steer: number; brake: boolean; nitro: boolean } {
    const buttons = (this.pressed("right") ? 1 : 0) - (this.pressed("left") ? 1 : 0);
    const steer = this.mode === "tilt" && this.motionSeen ? (buttons || this.tiltSteer) : buttons;
    if (this.steerKnob) this.steerKnob.style.transform = `translateX(-50%) rotate(${(steer * 90).toFixed(1)}deg)`;
    return { steer, brake: this.pressed("brake"), nitro: this.pressed("nitro") };
  }

  /** Short buzz on Android (iOS Safari has no vibration API). */
  vibrate(kind: "comboUp" | "comboEnd" | "reset" | "drift"): void {
    if (!this.enabled || !("vibrate" in navigator)) return;
    const pattern = { comboUp: 25, comboEnd: [20, 40, 30], reset: 120, drift: 8 }[kind];
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  }
}
