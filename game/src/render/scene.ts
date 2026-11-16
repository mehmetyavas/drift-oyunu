import * as THREE from "three";
import type { Palette } from "../world/biomes";

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

export type World = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Ground + distant hills follow the car so they never end. */
  follow(x: number, z: number): void;
  /** Recolor sky, fog, ground, hills and lights. */
  applyPalette(p: Palette): void;
};

export function createWorld(container: HTMLElement): World {
  // Phones: fewer pixels keeps the frame rate up (and the battery cooler); the low-poly look hides it.
  const phone = matchMedia("(pointer: coarse)").matches;
  const renderer = new THREE.WebGLRenderer({ antialias: !phone, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, phone ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 4;
  skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext("2d")!;
  const sky = new THREE.CanvasTexture(skyCanvas);
  sky.colorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = sky;
  const fog = new THREE.Fog(0xf09a6e, 60, 420);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.5, 1500);
  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  const hemi = new THREE.HemisphereLight(0xffc9a0, 0x3b2a4a, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffa060, 1.6);
  sun.position.set(-50, 60, -30);
  scene.add(sun);

  const groundMat = new THREE.MeshLambertMaterial({ color: 0xc98a5e });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  // Distant low-poly hills on a ring around the player.
  const hills = new THREE.Group();
  const hillMat = new THREE.MeshLambertMaterial({ color: 0x8a4a6a, flatShading: true });
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + Math.random() * 0.1;
    const r = 700 + Math.random() * 150;
    const h = 60 + Math.random() * 110;
    const m = new THREE.Mesh(new THREE.ConeGeometry(90 + Math.random() * 80, h, 5), hillMat);
    m.position.set(Math.cos(a) * r, h / 2 - 5, Math.sin(a) * r);
    m.rotation.y = Math.random() * Math.PI;
    hills.add(m);
  }
  scene.add(hills);

  let lastKey = "";
  return {
    renderer,
    scene,
    camera,
    follow(x, z) {
      ground.position.x = x;
      ground.position.z = z;
      hills.position.x = x;
      hills.position.z = z;
    },
    applyPalette(p) {
      const key = `${p.skyTop}${p.skyMid}${p.skyHorizon}`;
      if (key !== lastKey) {
        lastKey = key;
        const grad = skyCtx.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0, hex(p.skyTop));
        grad.addColorStop(0.55, hex(p.skyMid));
        grad.addColorStop(1, hex(p.skyHorizon));
        skyCtx.fillStyle = grad;
        skyCtx.fillRect(0, 0, 4, 256);
        sky.needsUpdate = true;
      }
      fog.color.setHex(p.fog);
      fog.near = p.fogNear;
      fog.far = p.fogFar;
      groundMat.color.setHex(p.ground);
      hillMat.color.setHex(p.hill);
      sun.color.setHex(p.sun);
      sun.intensity = p.sunIntensity;
      hemi.color.setHex(p.hemiSky);
      hemi.groundColor.setHex(p.hemiGround);
      hemi.intensity = p.hemiIntensity;
    },
  };
}
