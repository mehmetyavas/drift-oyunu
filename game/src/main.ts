import { Connection } from "./net/connection";
import { InputState } from "./net/inputState";
import { Keyboard } from "./net/keyboard";
import { Session, type Round } from "./net/session";
import { showPairing, hidePairing } from "./ui/pairing";
import { Hud, setRecoveryFx } from "./ui/hud";
import { ComboFx } from "./ui/comboFx";
import { comboTier } from "./ui/comboTier";
import { ExtremeHint } from "./ui/extremeHint";
import { LobbyUi } from "./ui/lobby";
import { comboFeel } from "./audio/intensity";
import { animate } from "motion";
import { createWorld } from "./render/scene";
import { RoadMesh, setRoadColors } from "./render/roadMesh";
import { biomeAt as biomeAtRaw, blendPalette, BIOME_LENGTH } from "./world/biomes";
import { Sound } from "./audio/sound";
import { surfaceAt } from "./audio/tires";
import { ChaseCamera, CAMERA_MODES, CAMERA_NAMES, type CameraMode } from "./render/carView";
import { CarModel, rearWheels } from "./render/carModel";
import { RemoteCars } from "./render/remoteCars";
import { SkidMarks, Smoke } from "./render/effects";
import { Road, BEHIND } from "./sim/road";
import { createCar, stepCar, speedOf, slipAngle, type CarInput } from "./sim/car";
import { collide } from "./sim/collide";
import { ScoreSystem } from "./sim/score";
import { Recovery } from "./sim/recovery";
import { DriftBuzz } from "./sim/driftBuzz";
import { Crowd } from "./sim/crowd";
import { Exhaust } from "./sim/exhaust";
import { PoliceForce, type PoliceUnit } from "./sim/policeForce";
import { PauseControl, type PauseState } from "./sim/pause";
import { TUNING, EXTREME } from "./sim/tuning";
import { mulberry32 } from "./sim/rng";
import { engineState } from "./audio/params";
import { CrowdView } from "./render/crowdView";
import { MODE_INFO, gridSlot } from "@drift/shared";

const SIM_DT = 1 / 60;
const BEST_KEY = "drift.best";
const CAM_KEY = "drift.camera";
/** Debug: ?biome=N starts in the Nth biome. */
const BIOME_OFFSET = Number(new URLSearchParams(location.search).get("biome") ?? 0) * BIOME_LENGTH;
const biomeAt = (s: number) => biomeAtRaw(s + BIOME_OFFSET);
/** Bumps harder than this (m/s closing speed) break the running combo. */
const COMBO_BREAK_IMPACT = 7;

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private mode */
  }
}

async function boot() {
  const { wsUrl } = (await (await fetch("/config.json")).json()) as { wsUrl: string };
  const conn = new Connection(wsUrl);
  const input = new InputState();
  const kb = new Keyboard();
  let controllerConnected = false;
  showPairing(wsUrl, conn.pair);

  const session = new Session(conn, {
    lobby: () => {
      lobbyUi.onLobby();
      remoteCars.sync(session.players, session.me);
      if (!session.inRoom) remoteCars.clear();
    },
    round: (r) => startRound(r),
    results: () => lobbyUi.onResults(),
    error: (code) => lobbyUi.onError(code),
  });
  const lobbyUi = new LobbyUi(session);

  conn.onMessage((m) => {
    if (m.t === "pair") {
      if (!controllerConnected) showPairing(wsUrl, m.code);
    } else if (m.t === "peer" && m.role === "controller") {
      controllerConnected = m.connected;
      m.connected ? hidePairing() : showPairing(wsUrl, conn.pair);
    } else if (m.t === "input") input.apply(m, performance.now());
    else if (m.t === "calibrate") input.requestCalibrate();
    else if (m.t === "toggleMode") toggleExtreme();
    else if (m.t === "camera") nextCamera();
  });

  // Extreme mode: faster car, sharper upcoming road, double points. In a room it is a room setting.
  let extreme = false;
  const badge = document.getElementById("extreme")!;
  const vignetteEl = document.getElementById("vignette")!;
  const linesEl = document.getElementById("lines")!;
  const xhintEl = document.getElementById("xhint")!;
  const camNameEl = document.getElementById("camName")!;
  const xhint = new ExtremeHint();
  let feelM = 0;
  let bankedCount = 0;
  let hintShown = false;
  function setExtreme(on: boolean) {
    extreme = on;
    score.pointsScale = extreme ? 2 : 1;
    badge.style.display = extreme ? "block" : "none";
  }
  function toggleExtreme() {
    if (session.inRoom) {
      hud.showBiome("EXTREME ODADAN AYARLANIR");
      return;
    }
    setExtreme(!extreme);
    hud.showBiome(extreme ? "EXTREME MOD" : "NORMAL MOD");
  }
  addEventListener("keydown", (e) => {
    if (e.key === "e" || e.key === "E") toggleExtreme();
    else if (e.key === "c" || e.key === "C") nextCamera();
  });

  const world = createWorld(document.getElementById("app")!);
  let seed = (Math.random() * 2 ** 31) | 0;
  const roadStyle = (s: number) => {
    const st = biomeAt(s).a.road;
    return extreme ? { curvatureScale: Math.min(1, st.curvatureScale * 1.3), straightChance: st.straightChance * 0.6 } : st;
  };
  let road = new Road(seed, roadStyle);
  const crowd = new Crowd(road.halfWidth);
  const crowdView = new CrowdView(world.scene);
  (window as unknown as { __crowd: Crowd }).__crowd = crowd; // debug handle
  const roadMesh = new RoadMesh(
    world.scene,
    road.halfWidth,
    seed,
    (s) => {
      const b = biomeAt(s);
      return (b.t > 0.5 ? b.b : b.a).id;
    },
    (pts, kind) => {
      if (pts[0].s < 150) return; // keep the start clear
      const rand = mulberry32(seed ^ (Math.floor(pts[0].s) * 7919));
      crowdView.add(crowd.spawnChunk(pts, rand, kind === "city" ? 1 : 0.7), kind);
      if (pts[0].s > 300 && rand() < 0.12) police.park(pts[12], road.halfWidth);
    },
  );
  const exhaust = new Exhaust();
  const police = new PoliceForce();
  // Debug handles (used by browser checks).
  Object.assign(window, { __police: police, __alert: () => police.alert(car, road), __car: () => car, __session: session });
  const policeViews = new Map<PoliceUnit, CarModel>();
  const policeFx = document.getElementById("police")!;
  let prevPoliceDist = Infinity;
  let closingSmooth = 0;

  const sound = new Sound();
  const soundBtn = document.getElementById("sound")!;
  const startSound = () => {
    sound.start();
    soundBtn.style.display = "none";
  };
  soundBtn.addEventListener("click", startSound);
  addEventListener("pointerdown", startSound);
  addEventListener("keydown", (e) => {
    if (e.key === "m" || e.key === "M") sound.toggleMute();
    else startSound();
  });
  let carS = 0;
  let biomeIndex = -1;
  let prevSpeed = 0;
  let onRoad = true;
  roadMesh.addPoints(road.ensureAhead(0));

  let carView = new CarModel();
  world.scene.add(carView.root);
  const remoteCars = new RemoteCars(world.scene);
  const chase = new ChaseCamera(world.camera);
  const savedCam = load(CAM_KEY) as CameraMode | null;
  if (savedCam && CAMERA_MODES.includes(savedCam)) chase.setMode(savedCam);
  let camTimer: ReturnType<typeof setTimeout> | undefined;
  function nextCamera() {
    const m = chase.next();
    store(CAM_KEY, m);
    camNameEl.textContent = `🎥 ${CAMERA_NAMES[m]}`;
    camNameEl.style.opacity = "1";
    clearTimeout(camTimer);
    camTimer = setTimeout(() => (camNameEl.style.opacity = "0"), 1400);
  }
  const skids = new SkidMarks(world.scene, 2);
  const smoke = new Smoke(world.scene);
  const hud = new Hud();
  const combo = new ComboFx();
  let score = new ScoreSystem(Number(load(BEST_KEY)) || 0);
  let recovery = new Recovery();
  const buzz = new DriftBuzz();

  let car = createCar(0, 4, 0, 0);
  let started = false;
  const pause = new PauseControl();
  let pauseState: PauseState = { running: true, paused: false, countdown: null };
  const countdownEl = document.getElementById("countdown")!;
  let lastCountdown: number | null = null;
  // rAF stops while the tab is hidden, so enter the paused state from the event itself.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && !session.racing) pauseState = pause.update(0, { inputOk: false, visible: false, keyboard: false });
  });
  let goUntil = 0;
  let usedController = false;
  let acc = 0;
  let last = performance.now();
  let lastStatus = 0;
  let lastBoard = 0;
  let smokeTick = 0;
  let wasFinished = false;
  let standings: ReturnType<Session["standings"]> = [];
  let current: CarInput = { steer: 0, brake: false, nitro: false };

  const haptic = (kind: "comboUp" | "comboEnd" | "reset" | "drift") => conn.send({ t: "haptic", kind });

  /** A multiplayer round: everybody gets the same seed, so the same road, scenery and crowd. */
  function startRound(r: Round) {
    seed = r.seed;
    setExtreme(r.extreme);
    road = new Road(seed, roadStyle);
    roadMesh.reset(seed);
    crowd.people = [];
    crowdView.clear();
    police.units = [];
    skids.clear();
    recovery = new Recovery();
    score = new ScoreSystem(score.best);
    score.pointsScale = extreme ? 2 : 1;
    combo.lost();
    sound.setCombo(0);
    const me = session.players.find((p) => p.id === session.me);
    world.scene.remove(carView.root);
    carView = new CarModel({ paint: me?.color });
    world.scene.add(carView.root);
    const slot = gridSlot(Math.max(0, r.grid.indexOf(session.me ?? "")));
    car = createCar(slot.x, slot.z, 0, 0);
    roadMesh.addPoints(road.ensureAhead(0));
    carS = 0;
    biomeIndex = -1;
    wasFinished = false;
    chase.snap();
    started = true;
    pauseState = { running: true, paused: false, countdown: null };
    remoteCars.sync(session.players, session.me);
    if (session.racing) lobbyUi.onRound();
    hud.showBiome(MODE_INFO[r.mode].name.toUpperCase());
  }

  function simStep(now: number) {
    let stale = false;
    if (kb.active && !lobbyUi.visible) current = kb.read();
    else {
      const r = input.read(now, SIM_DT);
      stale = r.stale;
      current = r;
    }
    input.consumeCalibrate(); // calibration happens on the phone; nothing to do here
    const mp = session.racing;
    if (!started) {
      started = kb.active || !stale;
      hud.message(started ? null : "Başlamak için telefonu bağla ya da ok tuşlarına bas");
      if (!started) return;
    }
    if (!kb.active && !stale) usedController = true;

    if (mp) {
      // Multiplayer never pauses: the room keeps going, a dropped phone just lets go of the wheel.
      pauseState = { running: true, paused: false, countdown: null };
      hud.message(stale && usedController && !kb.active ? "Kontrolcü bağlantısı koptu" : null);
      if (session.countdown(now) > 0) {
        session.sendState(now, car, 0, 0, 0, 1, carS);
        return; // on the grid
      }
    } else {
      // Pause when the phone drops (or the tab is hidden); 3-2-1 when it comes back.
      pauseState = pause.update(SIM_DT, {
        inputOk: !stale,
        visible: !document.hidden,
        keyboard: kb.active || !usedController,
      });
      hud.message(pauseState.paused ? "Duraklatıldı — kontrolcü bağlantısı bekleniyor" : null);
      if (!pauseState.running) return;
    }

    car = stepCar(car, current, SIM_DT, extreme ? EXTREME : TUNING);

    // Other players: bump off them unless this is a ghost round.
    if (mp && session.round && MODE_INFO[session.round.mode].collisions) {
      let hardest = 0;
      for (const id of session.racers) {
        if (id === session.me) continue;
        const s = session.tracks.get(id)?.sample(now);
        if (!s) continue;
        const hit = collide(car, s.car);
        if (hit) {
          car = hit.car;
          hardest = Math.max(hardest, hit.impact);
        }
      }
      if (hardest > 2) {
        chase.shake(Math.min(1.2, 0.15 + hardest * 0.06));
        if (hardest > COMBO_BREAK_IMPACT && score.pending > 0 && !MODE_INFO[session.round.mode].race) {
          combo.lost();
          sound.setCombo(0);
          score.cancelCombo();
        }
        if (hardest > COMBO_BREAK_IMPACT) {
          sound.crash();
          haptic("reset");
        }
      }
    }

    // Spectators: a hit launches them, slows the car hard and costs the combo.
    const hits = crowd.update(SIM_DT, car);
    if (hits.length) {
      const k = Math.max(0.35, 0.7 - 0.1 * (hits.length - 1));
      car = { ...car, vx: car.vx * k, vz: car.vz * k, drifting: false };
      combo.lost();
      sound.setCombo(0);
      score.cancelCombo();
      sound.crash();
      police.alert(car, road);
      chase.shake(0.6 + 0.15 * hits.length);
      haptic("reset");
    }

    police.update(SIM_DT, car, road);
    const rec = recovery.update(SIM_DT, car, road);
    if (rec.car !== car) chase.snap();
    car = rec.car;
    if (rec.started) {
      combo.lost();
      sound.setCombo(0);
      score.cancelCombo();
      sound.whoosh();
      haptic("reset");
    }

    if (!recovery.active) {
      const before = { total: score.total, mult: score.multiplier };
      for (const e of score.update(SIM_DT, car.drifting, slipAngle(car), speedOf(car))) {
        if (e === "comboUp") {
          combo.up(score.multiplier);
          const f = comboFeel(score.multiplier);
          chase.shake(f.shake);
          chase.punch(f.fovPunch);
          sound.setCombo(score.multiplier, true);
        }
        if (e === "comboEnd") {
          combo.bank(score.total - before.total, before.mult);
          sound.setCombo(0);
          bankedCount++;
        }
        haptic(e);
        if (e === "comboUp") sound.ding(score.multiplier);
        if (e === "comboEnd") store(BEST_KEY, String(score.best));
      }
    }

    if (buzz.update(SIM_DT, car.drifting && !recovery.active)) haptic("drift");

    const wheels = rearWheels(car);
    skids.update(car.drifting && !recovery.active ? wheels : [null, null]);
    if (car.drifting && ++smokeTick % 2 === 0) for (const [x, z] of wheels) smoke.emit(x, z, car.vx, car.vz);

    const near = road.nearest(car.x, car.z);
    const s = near.point.s;
    onRoad = near.distance <= road.halfWidth + 0.5;
    carS = s;
    roadMesh.addPoints(road.ensureAhead(s));
    road.trimBehind(s);
    roadMesh.trim(s - BEHIND);
    crowd.trim(s - BEHIND - 50);
    crowdView.sync(crowd.people);

    if (mp) session.sendState(now, car, current.steer, score.total, score.pending, score.multiplier, carS);
  }

  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc >= SIM_DT) {
      simStep(now);
      acc -= SIM_DT;
    }

    carView.root.visible = chase.showCar;
    carView.update(car, current, dt);
    smoke.update(dt);
    chase.update(car, dt, current.nitro);
    world.follow(car.x, car.z);
    const biome = biomeAt(carS);
    const pal = blendPalette(biome.a.palette, biome.b.palette, biome.t);
    world.applyPalette(pal);
    setRoadColors(pal.asphalt, pal.paint);
    const lightLevel = Math.min(1, Math.max(0, (1.15 - pal.sunIntensity) / 0.45));
    carView.setLights(lightLevel);
    if (biome.index !== biomeIndex) {
      biomeIndex = biome.index;
      hud.showBiome(biome.a.name);
    }
    const spd = speedOf(car);
    const accelerating = (spd - prevSpeed) / Math.max(dt, 1e-3) > 0.8 || current.nitro;
    prevSpeed = spd;

    // Countdown overlay: 3, 2, 1, BAŞLA! — from the pause logic, or the shared multiplayer start.
    const mpLeft = session.racing ? session.countdown(now) : 0;
    const count = mpLeft > 0 ? Math.ceil(mpLeft) : pauseState.countdown;
    if (count !== null) countdownEl.textContent = String(count);
    else if (lastCountdown !== null) goUntil = now + 700;
    if (count === null && now < goUntil) countdownEl.textContent = "BAŞLA!";
    countdownEl.style.display = count !== null || now < goUntil ? "flex" : "none";
    lastCountdown = count;

    sound.update(spd, accelerating, current.nitro, car.drifting && !recovery.active, slipAngle(car), started && pauseState.running && mpLeft <= 0,
      surfaceAt(onRoad, (biome.t > 0.5 ? biome.b : biome.a).id));

    // Exhaust: pops/flames on shifts and lift-off, throttle blip on downshifts.
    if (started) {
      const ex = exhaust.update(dt, engineState(spd, accelerating, current.nitro));
      if (ex.blip) sound.blip();
      for (let i = 0; i < ex.pops; i++) {
        sound.pop();
        carView.backfire();
      }
    }

    // Other players.
    const inRound = session.phase === "racing" && session.round !== null;
    remoteCars.update(session.tracks, now, dt, {
      ghost: inRound && !MODE_INFO[session.round!.mode].collisions,
      lights: lightLevel,
      active: inRound || session.phase === "results" ? session.racers : new Set(),
      camera: world.camera.position,
    });
    if (session.finished && !wasFinished) {
      wasFinished = true;
      hud.showBiome("🏁 BİTİŞ!");
    }

    // Police: one model per unit, driven by the sim; light bars flash once they are chasing.
    for (const u of police.units) {
      let view = policeViews.get(u);
      if (!view) {
        view = new CarModel({ paint: 0x15151c, police: true, beam: false });
        world.scene.add(view.root);
        policeViews.set(u, view);
      }
      view.update(u.car, { steer: 0, brake: false, nitro: false }, dt);
      view.setLights(lightLevel * 0.5);
      view.flashBar(now / 1000 + (u.lane > 0 ? 0.33 : 0), u.state !== "parked");
    }
    for (const [u, view] of policeViews) {
      if (!police.units.includes(u)) {
        world.scene.remove(view.root);
        policeViews.delete(u);
      }
    }
    const pd = police.nearestDistance(car);
    const closing = pd === Infinity || prevPoliceDist === Infinity ? 0 : (prevPoliceDist - pd) / Math.max(dt, 1e-3);
    prevPoliceDist = pd;
    const lvl = police.sirenLevel(car);
    closingSmooth += (Math.max(-40, Math.min(40, closing)) - closingSmooth) * Math.min(1, 1.5 * dt);
    sound.siren(lvl, 343 / (343 - closingSmooth));
    const blue = Math.floor(now / 250) % 2 === 0;
    policeFx.style.opacity = (lvl * 0.8).toFixed(2);
    policeFx.style.boxShadow = blue
      ? "inset 140px 0 120px -60px #2a5aff, inset -40px 0 80px -60px #ff1a2a"
      : "inset -140px 0 120px -60px #ff1a2a, inset 40px 0 80px -60px #2a5aff";

    // Crowd: animate, and roar louder the more cheering people are close by.
    crowdView.update(dt);
    let cheering = 0;
    for (const p of crowd.people) {
      if (p.state === "cheer" && Math.abs(p.x - car.x) < 45 && Math.abs(p.z - car.z) < 45) cheering++;
    }
    sound.crowd(Math.min(1, cheering / 12));
    setRecoveryFx(world.renderer.domElement, recovery.active ? recovery.progress : 0);
    combo.update(score.pending, score.multiplier, score.comboTimeLeft());
    hud.update(combo.displayedTotal, Math.max(score.best, score.total), score.pending, score.multiplier, speedOf(car) * 3.6);

    // Live standings (5 Hz is plenty for DOM work).
    if (now - lastBoard > 200) {
      lastBoard = now;
      if (inRound && session.racers.has(session.me ?? "")) {
        standings = session.standings({ score: score.total + score.pending * score.multiplier, s: carS });
        lobbyUi.updateBoard(standings, session.round!.mode, session.timeLeft(now), carS);
      } else {
        standings = [];
        lobbyUi.updateBoard([], null, null, 0);
      }
    }

    // Combo atmosphere: vignette + speed lines grow with the multiplier.
    const feelTarget = score.pending > 0 ? score.multiplier : 0;
    feelM += (feelTarget - feelM) * Math.min(1, 4 * dt);
    const feel = comboFeel(feelM);
    vignetteEl.style.opacity = (feel.vignette * 0.85).toFixed(3);
    vignetteEl.style.setProperty("--c", comboTier(Math.max(1, Math.round(feelM))).color);
    linesEl.style.opacity = (feel.lines * 0.7).toFixed(3);

    // Suggest extreme mode once (solo only).
    const wantHint = xhint.update(dt, { extremeUsed: extreme, banked: bankedCount }) && started && !session.inRoom;
    if (wantHint !== hintShown) {
      hintShown = wantHint;
      xhintEl.style.display = "block";
      animate(xhintEl, wantHint ? { opacity: [0, 1], y: [40, 0], scale: [0.8, 1] } : { opacity: 0, y: 20 }, { duration: 0.4 });
      if (wantHint) animate(xhintEl, { scale: [1, 1.06, 1] }, { duration: 1.2, repeat: Infinity, delay: 0.4 });
    }

    if (now - lastStatus > 200) {
      lastStatus = now;
      const rankInfo = standings.length ? { rank: standings.findIndex((r) => r.me) + 1, players: standings.length } : {};
      conn.send({ t: "status", score: score.total, combo: Math.round(score.pending), multiplier: score.multiplier, extreme, ...rankInfo });
    }
    world.renderer.render(world.scene, world.camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot();
