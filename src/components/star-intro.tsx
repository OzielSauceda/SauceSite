"use client";

import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue,
  type PanInfo,
} from "motion/react";
import * as THREE from "three";
import dynamic from "next/dynamic";
import { SystemsDiagram } from "@/components/systems-diagram";

// Client-only: WebGL + GLTFLoader must not SSR.
const WireframeBust = dynamic(
  () => import("@/components/wireframe-bust").then((m) => m.WireframeBust),
  { ssr: false },
);

// The "i" in Oziel is rendered as the dotless Turkish ı (U+0131) so the
// letter has no dot during the intro — Steezy lands on top of it as the
// dot once the name has settled. ARIA on the h1 still announces "Oziel"
// for screen readers. Index of the dotless ı in this string is 2.
const NAME = "Ozıel Sauceda";
const I_LETTER_INDEX = 2;

// Tagline cycles through these as the trailing role; the leading
// "designer & engineer ·" stays static. Each role is shown ~3.5 s before
// crossfading into the next via a soft blur + vertical morph.
const TAGLINE_ROLES = [
  "software developer",
  "researcher",
  "sauce purveyor",
  "tinkerer",
  "prototyper",
];
const TAGLINE_CYCLE_MS = 3500;

// The laptop composition was art-directed at this viewport. Larger screens
// keep using this as the hero stage so the layout gains breathing room
// instead of stretching the name, bust, and mascot choreography apart.
const HERO_STAGE_MAX_WIDTH = 1440;
const HERO_STAGE_MAX_HEIGHT = 768;
const HERO_STAGE_LEFT_GUTTER = 0.06;
const HERO_SETTLED_Y_RATIO = -0.15;

const GOO_HOLD_MS = 700;
const MORPH_MS = 2600;
const POST_MORPH_GRACE_MS = 220;

const FLIGHT_DURATION_MS = 3600;
const SPIN_TOTAL_DEG = 1080;
const RESET_BEFORE_FLIGHT_MS = 380;

const FLIGHT_WAYPOINTS: Array<{ x: number; y: number; scale: number }> = [
  { x: 0, y: 0, scale: 1.0 },
  { x: 14, y: -20, scale: 0.55 },
  { x: 18, y: -36, scale: 0.25 },
  { x: 0, y: -42, scale: 0.2 },
  { x: -22, y: -38, scale: 0.25 },
  { x: -34, y: -14, scale: 0.55 },
  { x: -28, y: 0, scale: 1.0 },
  { x: 0, y: 0, scale: 1.0 },
  { x: 28, y: 0, scale: 1.0 },
  { x: 50, y: 6, scale: 0.6 },
  { x: 72, y: 12, scale: 0.3 },
];
const FLIGHT_SEGMENTS = FLIGHT_WAYPOINTS.length - 1;
const SWEEP_START_INDEX = 6;
const SWEEP_END_INDEX = 8;
const T_LOOP_END = SWEEP_START_INDEX / FLIGHT_SEGMENTS;
const T_SWEEP_END = SWEEP_END_INDEX / FLIGHT_SEGMENTS;

function flightWaypoint(i: number) {
  const n = FLIGHT_WAYPOINTS.length;
  if (i >= 0 && i < n) return FLIGHT_WAYPOINTS[i];
  if (i < 0) return FLIGHT_WAYPOINTS[1];
  const a = FLIGHT_WAYPOINTS[n - 1];
  const b = FLIGHT_WAYPOINTS[n - 2];
  return {
    x: 2 * a.x - b.x,
    y: 2 * a.y - b.y,
    scale: 2 * a.scale - b.scale,
  };
}

function flightPositionAt(tt: number): {
  x: number;
  y: number;
  scale: number;
} {
  const tc = tt < 0 ? 0 : tt > 1 ? 1 : tt;
  const idxF = tc * FLIGHT_SEGMENTS;
  const segIdx = Math.min(Math.floor(idxF), FLIGHT_SEGMENTS - 1);
  const u = idxF - segIdx;
  const p0 = flightWaypoint(segIdx - 1);
  const p1 = flightWaypoint(segIdx);
  const p2 = flightWaypoint(segIdx + 1);
  const p3 = flightWaypoint(segIdx + 2);
  const u2 = u * u;
  const u3 = u2 * u;
  const interp = (a: number, b: number, c: number, d: number) =>
    0.5 *
    (2 * b +
      (-a + c) * u +
      (2 * a - 5 * b + 4 * c - d) * u2 +
      (-a + 3 * b - 3 * c + d) * u3);
  return {
    x: interp(p0.x, p1.x, p2.x, p3.x),
    y: interp(p0.y, p1.y, p2.y, p3.y),
    scale: interp(p0.scale, p1.scale, p2.scale, p3.scale),
  };
}

const GOO_DROP_MS = 180;
const GOO_RESOLVE_MS = 340;

// Steezy is the name of the hero 3D star mascot rendered by StarCanvas
// below. He docks at the right edge, vertically centered with the section
// rail — beads arc around his left side, forming a single mascot+nav
// cluster on the right of the viewport. The shared constants live in
// lib/sections so the rail can position its beads relative to the same
// anchor point. Offsets are in vw / vh from viewport center.

const ANGULAR = 128;
const LATITUDE = 16;
const SIZE = 1.0;

const STAR_OUTER = 1.42;
const STAR_INNER = 0.56;

const PROFILE_RADIAL_POWER = 0.35;
const PROFILE_Z_POWER = 0.55;
const BULGE_FRONT = 0.22;
const BULGE_BACK = 0.15;

const PINK = "#ec4899";
const CYAN = "#22d3ee";
const YELLOW = "#ffd131";
const VIOLET = "#a78bfa";
const OUTLINE = "#0a0a0a";

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

const STAR_SEG = (Math.PI * 2) / 10;

function starRadius(theta: number): number {
  const TWO_PI = Math.PI * 2;
  let a = theta - Math.PI / 2;
  a = ((a % TWO_PI) + TWO_PI) % TWO_PI;
  const idx = Math.floor(a / STAR_SEG);
  const a0 = idx * STAR_SEG;
  const a1 = a0 + STAR_SEG;
  const r0 = idx % 2 === 0 ? STAR_OUTER : STAR_INNER;
  const r1 = idx % 2 === 0 ? STAR_INNER : STAR_OUTER;
  const v0x = r0 * Math.cos(a0);
  const v0y = r0 * Math.sin(a0);
  const v1x = r1 * Math.cos(a1);
  const v1y = r1 * Math.sin(a1);
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const ex = v1x - v0x;
  const ey = v1y - v0y;
  return (v0x * ey - v0y * ex) / (dx * ey - dy * ex);
}

function gooRadius(theta: number, timeMs: number): number {
  const t = timeMs * 0.001;
  return (
    0.96 +
    0.18 * Math.sin(3 * theta + t * 1.3) +
    0.13 * Math.cos(5 * theta + t * 0.91) +
    0.09 * Math.sin(2 * theta - t * 2.1)
  );
}

function profileRadialScale(phi: number): number {
  return Math.pow(Math.sin(phi), PROFILE_RADIAL_POWER);
}

function profileZ(phi: number): number {
  const c = Math.cos(phi);
  const sign = c >= 0 ? 1 : -1;
  const bulge = c >= 0 ? BULGE_FRONT : BULGE_BACK;
  return sign * bulge * Math.pow(Math.abs(c), PROFILE_Z_POWER);
}

function buildStarGeometry(): {
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
} {
  const rings = LATITUDE + 1;
  const totalVerts = rings * ANGULAR;
  const positions = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  for (let j = 0; j < rings; j++) {
    const v = j / LATITUDE;
    for (let i = 0; i < ANGULAR; i++) {
      const u = i / ANGULAR;
      const idx = (j * ANGULAR + i) * 2;
      uvs[idx] = u;
      uvs[idx + 1] = v;
    }
  }

  const indices: number[] = [];
  for (let j = 0; j < LATITUDE; j++) {
    for (let i = 0; i < ANGULAR; i++) {
      const i2 = (i + 1) % ANGULAR;
      const a = j * ANGULAR + i;
      const b = j * ANGULAR + i2;
      const c = (j + 1) * ANGULAR + i;
      const d = (j + 1) * ANGULAR + i2;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return { geometry, positions };
}

function updateStarPositions(positions: Float32Array, morph: number, timeMs: number) {
  const eased = easeInOutCubic(morph);
  let p = 0;
  for (let j = 0; j <= LATITUDE; j++) {
    const phi = (j / LATITUDE) * Math.PI;
    const s = profileRadialScale(phi);
    const z = profileZ(phi) * SIZE;
    for (let i = 0; i < ANGULAR; i++) {
      const theta = (i / ANGULAR) * Math.PI * 2;
      const rGoo = gooRadius(theta, timeMs);
      const rStar = starRadius(theta);
      const r = rGoo * (1 - eased) + rStar * eased;
      positions[p++] = r * s * Math.cos(theta) * SIZE;
      positions[p++] = r * s * Math.sin(theta) * SIZE;
      positions[p++] = z;
    }
  }
}

function makeEye(side: 1 | -1) {
  const group = new THREE.Group();

  const SCLERA_RX = 0.215;
  const SCLERA_RY = 0.31;
  const SCLERA_RZ = 0.072;
  const IRIS_RX = 0.13;
  const IRIS_RY = 0.22;

  const tilt = side === -1 ? 0.13 : -0.13;

  const std = (color: string, roughness = 0.5) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });

  const outline = new THREE.Mesh(new THREE.SphereGeometry(1, 56, 36), std(OUTLINE, 0.55));
  outline.scale.set(SCLERA_RX * 1.12, SCLERA_RY * 1.075, SCLERA_RZ * 0.6);
  outline.rotation.z = tilt;
  group.add(outline);

  const sclera = new THREE.Mesh(new THREE.SphereGeometry(1, 56, 36), std("#ffffff", 0.4));
  sclera.scale.set(SCLERA_RX, SCLERA_RY, SCLERA_RZ);
  sclera.rotation.z = tilt;
  group.add(sclera);

  const irisGroup = new THREE.Group();
  group.add(irisGroup);

  if (side === -1) {
    const pink = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), std(PINK, 0.4));
    pink.scale.set(IRIS_RX, IRIS_RY, 0.052);
    pink.rotation.z = tilt * 0.65;
    pink.position.set(0, 0, SCLERA_RZ * 0.6);
    irisGroup.add(pink);

    const cyan = new THREE.Mesh(new THREE.SphereGeometry(1, 44, 28), std(CYAN, 0.4));
    cyan.scale.set(IRIS_RX * 0.43, IRIS_RY * 0.38, 0.048);
    cyan.position.set(0.015, -0.01, SCLERA_RZ * 0.76);
    irisGroup.add(cyan);

    const yellow = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 22), std(YELLOW, 0.42));
    yellow.scale.set(0.044, 0.071, 0.045);
    yellow.rotation.z = -0.18;
    yellow.position.set(-0.045, 0.075, SCLERA_RZ * 0.86);
    irisGroup.add(yellow);

    const shine = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), std("#ffffff", 0.28));
    shine.scale.set(0.03, 0.04, 0.038);
    shine.position.set(0.052, -0.108, SCLERA_RZ * 0.92);
    irisGroup.add(shine);
  } else {
    const pupilMass = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), std(OUTLINE, 0.5));
    pupilMass.scale.set(IRIS_RX * 0.98, IRIS_RY * 0.82, 0.055);
    pupilMass.rotation.z = tilt * 0.55;
    pupilMass.position.set(0.01, -0.014, SCLERA_RZ * 0.6);
    irisGroup.add(pupilMass);

    const cyan = new THREE.Mesh(new THREE.SphereGeometry(1, 44, 28), std(CYAN, 0.4));
    cyan.scale.set(IRIS_RX * 0.88, IRIS_RY * 0.28, 0.052);
    cyan.rotation.z = -0.22;
    cyan.position.set(-0.025, 0.105, SCLERA_RZ * 0.78);
    irisGroup.add(cyan);

    const upperPink = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 24), std(PINK, 0.4));
    upperPink.scale.set(0.049, 0.078, 0.047);
    upperPink.rotation.z = 0.32;
    upperPink.position.set(-0.058, 0.045, SCLERA_RZ * 0.88);
    irisGroup.add(upperPink);

    const lowerPink = new THREE.Mesh(new THREE.SphereGeometry(1, 44, 28), std(PINK, 0.4));
    lowerPink.scale.set(0.068, 0.083, 0.048);
    lowerPink.position.set(0.02, -0.038, SCLERA_RZ * 0.9);
    irisGroup.add(lowerPink);

    const yellow = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 22), std(YELLOW, 0.42));
    yellow.scale.set(0.027, 0.039, 0.042);
    yellow.rotation.z = -0.18;
    yellow.position.set(0.075, -0.112, SCLERA_RZ * 0.92);
    irisGroup.add(yellow);

    const shine = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), std("#ffffff", 0.28));
    shine.scale.set(0.017, 0.021, 0.038);
    shine.position.set(-0.086, -0.035, SCLERA_RZ * 0.94);
    irisGroup.add(shine);
  }

  return { group, irisGroup };
}

function StarCanvas({
  rotationY,
  mouseX,
  mouseY,
  eyeTrackEnabled,
  onMorphDone,
}: {
  rotationY: MotionValue<number>;
  mouseX: MotionValue<number>;
  mouseY: MotionValue<number>;
  eyeTrackEnabled: boolean;
  onMorphDone: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onMorphDoneRef = useRef(onMorphDone);
  const eyeTrackRef = useRef(eyeTrackEnabled);

  useEffect(() => {
    onMorphDoneRef.current = onMorphDone;
  }, [onMorphDone]);

  useEffect(() => {
    eyeTrackRef.current = eyeTrackEnabled;
  }, [eyeTrackEnabled]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0, 5.6);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    host.appendChild(renderer.domElement);

    const root = new THREE.Group();
    scene.add(root);

    const { geometry, positions } = buildStarGeometry();
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#050505"),
      roughness: 0.65,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    root.add(mesh);

    const eyes = new THREE.Group();
    eyes.visible = false;
    const leftEye = makeEye(-1);
    const rightEye = makeEye(1);
    leftEye.group.position.set(-0.24 * SIZE, 0.13 * SIZE, BULGE_FRONT * SIZE - 0.03);
    rightEye.group.position.set(0.24 * SIZE, 0.13 * SIZE, BULGE_FRONT * SIZE - 0.03);
    leftEye.group.scale.setScalar(0.82);
    rightEye.group.scale.setScalar(0.82);
    eyes.add(leftEye.group);
    eyes.add(rightEye.group);
    const leftIris = leftEye.irisGroup;
    const rightIris = rightEye.irisGroup;
    root.add(eyes);

    scene.add(new THREE.AmbientLight("#ffffff", 1.1));

    const key = new THREE.DirectionalLight("#ffffff", 1.4);
    key.position.set(2.6, 3.2, 4.5);
    scene.add(key);

    const fill = new THREE.DirectionalLight("#dfe6f2", 0.7);
    fill.position.set(-3.4, -1.4, 2.2);
    scene.add(fill);

    const rim = new THREE.DirectionalLight("#ffffff", 0.6);
    rim.position.set(-1.6, 2.4, -3.8);
    scene.add(rim);

    let latestRotation = rotationY.get();
    const unsubRotation = rotationY.on("change", (v) => {
      latestRotation = v;
    });
    let latestMouseX = mouseX.get();
    let latestMouseY = mouseY.get();
    const unsubMouseX = mouseX.on("change", (v) => {
      latestMouseX = v;
    });
    const unsubMouseY = mouseY.on("change", (v) => {
      latestMouseY = v;
    });

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const start = performance.now();
    let frame = 0;
    let morphCompleteFired = false;
    let morphDoneAt = 0;
    let hoverStart = 0;
    let nextBlinkAt = 0;
    let blinkStartedAt = 0;
    const BLINK_MS = 140;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = performance.now();
      const elapsed = now - start;
      const morphRaw = (elapsed - GOO_HOLD_MS) / MORPH_MS;
      const m = clamp01(morphRaw);

      updateStarPositions(positions, m, elapsed);
      (geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      geometry.computeVertexNormals();

      const glossT = smoothstep(0.32, 0.92, m);
      material.roughness = 0.88 - 0.06 * glossT;

      const eyeReveal = smoothstep(0.4, 0.95, m);
      const eyeBlink = smoothstep(0.58, 0.92, m);
      let idleBlink = 1;
      if (m >= 1) {
        if (nextBlinkAt === 0) nextBlinkAt = now + 2200 + Math.random() * 4000;
        if (blinkStartedAt === 0 && now >= nextBlinkAt) {
          blinkStartedAt = now;
        }
        if (blinkStartedAt > 0) {
          const bt = (now - blinkStartedAt) / BLINK_MS;
          if (bt >= 1) {
            blinkStartedAt = 0;
            nextBlinkAt = now + 3500 + Math.random() * 5500;
          } else {
            const phase = bt < 0.5 ? bt * 2 : (1 - bt) * 2;
            idleBlink = 1 - phase * 0.94;
          }
        }
      }
      if (eyeReveal > 0.001) {
        eyes.visible = true;
        const scaleY = eyeReveal * (0.18 + 0.82 * eyeBlink) * idleBlink;
        eyes.scale.set(eyeReveal, scaleY, eyeReveal);
        eyes.position.z = -0.24 * (1 - eyeReveal);

        let targetIrisX = 0;
        let targetIrisY = 0;
        if (eyeTrackRef.current && m >= 1) {
          const rect = renderer.domElement.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const ccx = rect.left + rect.width / 2;
            const ccy = rect.top + rect.height / 2;
            const halfW = window.innerWidth / 2 || 1;
            const halfH = window.innerHeight / 2 || 1;
            const nx = Math.max(-1, Math.min(1, (latestMouseX - ccx) / halfW));
            const ny = Math.max(-1, Math.min(1, (latestMouseY - ccy) / halfH));
            targetIrisX = nx * 0.035;
            targetIrisY = -ny * 0.035;
          }
        }
        const lerp = 0.14;
        leftIris.position.x += (targetIrisX - leftIris.position.x) * lerp;
        leftIris.position.y += (targetIrisY - leftIris.position.y) * lerp;
        rightIris.position.x += (targetIrisX - rightIris.position.x) * lerp;
        rightIris.position.y += (targetIrisY - rightIris.position.y) * lerp;
      } else {
        eyes.visible = false;
        eyes.position.z = -0.24;
      }

      const breathAmp = m < 1 ? 0.018 * (1 - m * 0.6) : 0.028;
      const breath = 1 + Math.sin(now * 0.0019) * breathAmp;
      root.scale.set(breath, breath, breath);
      if (m >= 1) {
        if (hoverStart === 0) hoverStart = now;
        const elapsed = now - hoverStart;
        const ramp = Math.min(1, elapsed / 900);
        const eased = ramp * ramp * (3 - 2 * ramp);
        root.position.y = Math.sin(elapsed * 0.0015) * 0.085 * eased;
      } else {
        root.position.y = 0;
      }
      root.rotation.y = THREE.MathUtils.degToRad(latestRotation);
      root.rotation.z = 0;
      root.rotation.x = 0;

      renderer.render(scene, camera);

      if (m >= 1 && !morphCompleteFired) {
        morphCompleteFired = true;
        morphDoneAt = now;
      }
      if (morphCompleteFired && now - morphDoneAt >= POST_MORPH_GRACE_MS) {
        onMorphDoneRef.current();
        morphDoneAt = Infinity;
      }
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      unsubRotation();
      unsubMouseX();
      unsubMouseY();
      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement);
      }
      scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((mat) => mat.dispose());
      });
      renderer.dispose();
    };
  }, [rotationY]);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className="pointer-events-none absolute inset-0"
    />
  );
}

type LetterState = "hidden" | "goo" | "formed";

export function StarIntro() {
  const [morphDone, setMorphDone] = useState(false);
  const [clicked, setClicked] = useState(false);
  const [skipped, setSkipped] = useState(false);
  // When true, the name container's animate transitions snap with no
  // duration so we can pre-position the name at its settled upper-left
  // spot before the skip cascade reveals the letters there.
  const [instantNameShift, setInstantNameShift] = useState(false);
  const [letterStates, setLetterStates] = useState<LetterState[]>(() =>
    Array.from(NAME).map(() => "hidden"),
  );
  const [nameSettled, setNameSettled] = useState(false);
  const flightControlsRef = useRef<ReturnType<typeof animate> | null>(null);
  const spinControlsRef = useRef<ReturnType<typeof animate> | null>(null);
  const [mascotMode, setMascotMode] = useState(false);
  const [selectorMode, setSelectorMode] = useState(false);
  // Index into TAGLINE_ROLES — the trailing role in the tagline cycles
  // through these after the intro settles, so it doesn't compete with the
  // intro for attention.
  const [roleIndex, setRoleIndex] = useState(0);
  const letterRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const nameContainerRef = useRef<HTMLDivElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const [heroMetrics, setHeroMetrics] = useState({
    viewportWidth: 0,
    viewportHeight: 0,
    nameWidth: 0,
  });
  const viewportWidth = heroMetrics.viewportWidth || HERO_STAGE_MAX_WIDTH;
  const viewportHeight = heroMetrics.viewportHeight || HERO_STAGE_MAX_HEIGHT;
  const heroStageWidth = HERO_STAGE_MAX_WIDTH;
  const heroStageHeight = HERO_STAGE_MAX_HEIGHT;
  // Use Math.max so the artboard COVERS the viewport (fills the larger
  // dimension) instead of FITTING inside it. With Math.min the artboard
  // letterboxes whichever axis is over-budget -- and because typical
  // laptop and monitor viewports limit on different axes, two screens
  // see the bust at different proportional gaps from the edges. Math.max
  // eliminates letterboxing: artboard width always equals viewport width
  // on landscape displays, so proportional positions match exactly.
  const heroStageScale = Math.max(
    viewportWidth / HERO_STAGE_MAX_WIDTH,
    viewportHeight / HERO_STAGE_MAX_HEIGHT,
  );
  const heroStageLeft =
    (viewportWidth - HERO_STAGE_MAX_WIDTH * heroStageScale) / 2;
  const heroStageTop =
    (viewportHeight - HERO_STAGE_MAX_HEIGHT * heroStageScale) / 2;

  // Compute Steezy's vw/vh offset (from the section's center) to land
  // squarely on the dotless ı's dot position. Returns null while the DOM
  // isn't ready yet (initial render, before the h1 has measured).
  const computeIDotTarget = () => {
    const iEl = letterRefs.current[I_LETTER_INDEX];
    const sectionEl = sectionRef.current;
    if (!iEl || !sectionEl) return null;
    const iRect = iEl.getBoundingClientRect();
    const sectionRect = sectionEl.getBoundingClientRect();
    // Dot sits in the upper portion of the letter box — 8% from the top
    // is a good visual fit for a star sitting where a normal dot would.
    const iCenterX = iRect.left + iRect.width / 2;
    const iDotY = iRect.top + iRect.height * 0.08;
    const sectionCenterX = sectionRect.left + sectionRect.width / 2;
    const sectionCenterY = sectionRect.top + sectionRect.height / 2;
    return {
      vw: ((iCenterX - sectionCenterX) / window.innerWidth) * 100,
      vh: ((iDotY - sectionCenterY) / window.innerHeight) * 100,
    };
  };

  // Warm the wireframe-bust JS chunk + three.js bits during the intro so
  // by the time `nameSettled` flips and the dynamic <WireframeBust /> tries
  // to load, the chunk is already in cache. Removes a chunk-fetch + parse
  // spike from the moment the user clicks Skip.
  useEffect(() => {
    void import("@/components/wireframe-bust");
  }, []);

  // Hold the user at the top until the intro finishes — without this they
  // can scroll past Steezy mid-morph and never see the name reveal. The
  // intro-active class on <html> is toggled by globals.css to lock body
  // overflow and fade out the section rail until selectorMode flips on.
  useEffect(() => {
    document.documentElement.classList.add("intro-active");
    return () => {
      document.documentElement.classList.remove("intro-active");
    };
  }, []);
  useEffect(() => {
    if (selectorMode) {
      document.documentElement.classList.remove("intro-active");
      // Signal to the page shell that the intro is done so it can mount the
      // section rail. Custom event keeps Steezy decoupled from page.tsx.
      window.dispatchEvent(new CustomEvent("steezy:intro-done"));
    }
  }, [selectorMode]);

  useEffect(() => {
    if (!letterStates.every((s) => s === "formed")) return;
    const t = setTimeout(() => setNameSettled(true), 450);
    return () => clearTimeout(t);
  }, [letterStates]);

  useEffect(() => {
    const measure = () => {
      const next = {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        nameWidth: nameContainerRef.current?.offsetWidth ?? 0,
      };
      setHeroMetrics((prev) =>
        prev.viewportWidth === next.viewportWidth &&
        prev.viewportHeight === next.viewportHeight &&
        prev.nameWidth === next.nameWidth
          ? prev
          : next,
      );
    };

    measure();
    window.addEventListener("resize", measure);
    const ro =
      nameContainerRef.current && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    if (nameContainerRef.current) ro?.observe(nameContainerRef.current);

    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!nameSettled) return;
    const t = setTimeout(() => setMascotMode(true), 400);
    return () => clearTimeout(t);
  }, [nameSettled]);

  // Cycle the trailing tagline role on a timer once mascot mode is active.
  useEffect(() => {
    if (!selectorMode) return;
    const id = window.setInterval(() => {
      setRoleIndex((i) => (i + 1) % TAGLINE_ROLES.length);
    }, TAGLINE_CYCLE_MS);
    return () => clearInterval(id);
  }, [selectorMode]);

  useEffect(() => {
    if (!mascotMode) return;
    const t = setTimeout(() => setSelectorMode(true), 450);
    return () => clearTimeout(t);
  }, [mascotMode]);

  const rotationY = useMotionValue(0);
  const flightXVw = useMotionValue(0);
  const flightYVh = useMotionValue(0);
  const flightScale = useMotionValue(1);
  const flightOpacity = useMotionValue(1);
  const flightRotateZ = useMotionValue(0);
  const flightX = useTransform(flightXVw, (v) => `${v}vw`);
  const flightY = useTransform(flightYVh, (v) => `${v}vh`);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  useEffect(() => {
    mouseX.set(window.innerWidth / 2);
    mouseY.set(window.innerHeight / 2);
  }, [mouseX, mouseY]);

  useEffect(() => {
    if (clicked) return;
    const handle = (e: PointerEvent) => {
      mouseX.set(e.clientX);
      mouseY.set(e.clientY);
    };
    window.addEventListener("pointermove", handle);
    return () => window.removeEventListener("pointermove", handle);
  }, [clicked, mouseX, mouseY]);

  // After the intro completes, Steezy materializes as the dot of the ı in
  // "Oziel". We wait for the name's upper-left shift (1.4s) to settle
  // before measuring — measuring mid-shift gives a position that's stale
  // by the time Steezy lands. Skip path hits this with mascotMode set
  // immediately, so its wait is longer; the click path already paid 400ms
  // between nameSettled and mascotMode, so a shorter wait suffices.
  useEffect(() => {
    if (!mascotMode) return;

    let cancelled = false;
    const anims: Array<ReturnType<typeof animate>> = [];

    // Hide Steezy during the wait. Skip path already snapped him to 0
    // opacity inside the skip useEffect (no awkward lingering at his
    // intro position while the name jumps to upper-left). Click path may
    // still have him faintly visible at the end of the flight sweep, so
    // ease him the rest of the way out.
    if (!skipped && flightOpacity.get() > 0) {
      anims.push(
        animate(flightOpacity, 0, { duration: 0.28, ease: "easeOut" }),
      );
    }

    // Click path needs to wait through the 1.4s name shift; skip path
    // already snapped the name into place and just needs the per-letter
    // cascade (~700ms) to finish.
    const waitMs = skipped ? 850 : 1100;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      const target = computeIDotTarget();
      if (!target) return;

      // Steezy plummets from ~28vh above the i, grows from nothing,
      // spins through 2 full rotations on the way down, and overshoots
      // the landing point by a hair before settling. Reads as "I'm
      // dotting the i" rather than a plain fade-in.
      flightXVw.set(target.vw);
      flightYVh.set(target.vh - 28);
      flightScale.set(0);
      flightRotateZ.set(0);

      anims.push(
        animate(flightOpacity, 1, { duration: 0.35, ease: "easeOut" }),
      );
      anims.push(
        animate(flightScale, 0.13, {
          duration: 0.55,
          ease: [0.16, 1, 0.3, 1],
        }),
      );
      anims.push(
        animate(flightYVh, target.vh, {
          duration: 0.85,
          // Smooth deceleration into the dot — no overshoot, just a
          // clean drop that decelerates as it lands.
          ease: [0.16, 1, 0.3, 1],
        }),
      );
      const rotTarget =
        Math.round((rotationY.get() + 720) / 360) * 360;
      anims.push(
        animate(rotationY, rotTarget, {
          duration: 0.85,
          ease: [0.16, 1, 0.3, 1],
        }),
      );
    }, waitMs);

    return () => {
      cancelled = true;
      clearTimeout(t);
      anims.forEach((a) => a.stop());
    };
  }, [
    mascotMode,
    skipped,
    flightXVw,
    flightYVh,
    flightScale,
    flightOpacity,
    flightRotateZ,
    rotationY,
  ]);

  // Window resize: re-snap Steezy onto the dot. The ı's screen position
  // can shift if the user resizes the browser, since the name layout is
  // responsive. Skip during the click-flight sweep so we don't fight that
  // animation mid-flight.
  useEffect(() => {
    if (!selectorMode) return;
    const reposition = () => {
      if (clicked && flightOpacity.get() < 0.9) return;
      const target = computeIDotTarget();
      if (!target) return;
      flightXVw.set(target.vw);
      flightYVh.set(target.vh);
    };
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [selectorMode, clicked, flightOpacity, flightXVw, flightYVh]);

// Idle: every few seconds Steezy does a quick playful spin then settles
  // facing forward again. Pauses during the click-triggered flight.
  useEffect(() => {
    if (!selectorMode) return;
    if (clicked) return;

    let cancelled = false;
    let timeoutId: number | null = null;
    let activeControls: ReturnType<typeof animate> | null = null;

    const scheduleNext = () => {
      if (cancelled) return;
      const delay = 17000 + Math.random() * 6000;
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        const current = rotationY.get();
        const spins = 2 + Math.floor(Math.random() * 2);
        const direction = Math.random() < 0.5 ? 1 : -1;
        const target =
          Math.round(current / 360) * 360 + direction * spins * 360;
        activeControls = animate(rotationY, target, {
          duration: 0.95 + Math.random() * 0.25,
          ease: [0.22, 1, 0.36, 1],
        });
        activeControls.then(() => {
          if (!cancelled) scheduleNext();
        });
      }, delay);
    };

    scheduleNext();

    return () => {
      cancelled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      activeControls?.stop();
    };
  }, [selectorMode, clicked, rotationY]);

  useEffect(() => {
    if (!skipped) return;
    flightControlsRef.current?.stop();
    spinControlsRef.current?.stop();
    flightControlsRef.current = null;
    spinControlsRef.current = null;

    // 1) Snap the name container instantly to its settled upper-left
    //    position. No shift animation — letters will spawn AT that final
    //    spot rather than appearing in the middle and then sliding.
    //    Steezy gets snapped invisible at the same beat so he doesn't
    //    linger at his intro center position while the name moves.
    setInstantNameShift(true);
    setNameSettled(true);
    flightOpacity.set(0);

    // 2) Wait for the DOM to apply the new transform before measuring
    //    letter positions. Two animation frames is enough for React +
    //    motion to commit. Then run the same per-letter hidden → goo →
    //    formed cascade the click-flight uses, paced by each letter's
    //    real x position.
    const timers: number[] = [];
    let cancelled = false;

    const startCascade = () => {
      if (cancelled) return;
      const screenCenterX = window.innerWidth / 2;
      const positions = letterRefs.current.map((el) => {
        if (!el) return Number.POSITIVE_INFINITY;
        const rect = el.getBoundingClientRect();
        return (
          ((rect.left + rect.width / 2 - screenCenterX) /
            window.innerWidth) *
          100
        );
      });
      const valid = positions.filter(
        (p) => p !== Number.POSITIVE_INFINITY,
      );
      const minVw = valid.length > 0 ? Math.min(...valid) : 0;
      const maxVw = valid.length > 0 ? Math.max(...valid) : 1;
      const span = maxVw - minVw || 1;
      const SWEEP_MS = 520;

      positions.forEach((pos, idx) => {
        if (pos === Number.POSITIVE_INFINITY) return;
        const progress = (pos - minVw) / span;
        const gooAt = progress * SWEEP_MS;
        const formedAt = gooAt + GOO_DROP_MS;
        timers.push(
          window.setTimeout(() => {
            setLetterStates((cur) => {
              if (cur[idx] !== "hidden") return cur;
              const n = cur.slice();
              n[idx] = "goo";
              return n;
            });
          }, gooAt),
        );
        timers.push(
          window.setTimeout(() => {
            setLetterStates((cur) => {
              if (cur[idx] === "formed") return cur;
              const n = cur.slice();
              n[idx] = "formed";
              return n;
            });
          }, formedAt),
        );
      });
    };

    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(startCascade);
      timers.push(raf2);
    });
    timers.push(raf1);

    return () => {
      cancelled = true;
      timers.forEach((t) => {
        clearTimeout(t);
        cancelAnimationFrame(t);
      });
    };
  }, [skipped, flightOpacity]);

  useEffect(() => {
    if (!clicked) return;

    let positions: number[] | null = null;
    let triggering = false;
    const resolveTimers: number[] = [];

    const measureAndStart = () => {
      const screenCenterX = window.innerWidth / 2;
      positions = letterRefs.current.map((el) => {
        if (!el) return Number.POSITIVE_INFINITY;
        const rect = el.getBoundingClientRect();
        return (
          ((rect.left + rect.width / 2 - screenCenterX) / window.innerWidth) *
          100
        );
      });
      triggering = true;
    };

    const startTimer = window.setTimeout(
      measureAndStart,
      RESET_BEFORE_FLIGHT_MS + FLIGHT_DURATION_MS * T_LOOP_END,
    );

    const unsub = flightXVw.on("change", (vw) => {
      if (!triggering || !positions) return;
      setLetterStates((prev) => {
        let changed = false;
        const next = prev.slice();
        for (let i = 0; i < prev.length; i++) {
          if (prev[i] === "hidden" && vw >= positions![i]) {
            next[i] = "goo";
            changed = true;
            const idx = i;
            const t = window.setTimeout(() => {
              setLetterStates((cur) => {
                if (cur[idx] !== "goo") return cur;
                const n = cur.slice();
                n[idx] = "formed";
                return n;
              });
            }, GOO_DROP_MS);
            resolveTimers.push(t);
          }
        }
        return changed ? next : prev;
      });
    });

    return () => {
      clearTimeout(startTimer);
      resolveTimers.forEach((t) => clearTimeout(t));
      unsub();
    };
  }, [clicked, flightXVw]);

  const handleMorphDone = () => {
    setMorphDone((done) => done || true);
  };

  const handleTap = () => {
    if (selectorMode) {
      // Steezy is mascot-only — tapping him plays a quick playful spin so
      // there's still a satisfying reaction, without him claiming nav duty.
      const cur = rotationY.get();
      const target = Math.round(cur / 360) * 360 + 360;
      animate(rotationY, target, { duration: 0.75, ease: [0.22, 1, 0.36, 1] });
      return;
    }
    if (!morphDone || clicked) return;
    setClicked(true);
    const cur = rotationY.get();
    const resetTarget = Math.round(cur / 360) * 360;
    animate(rotationY, resetTarget, {
      duration: RESET_BEFORE_FLIGHT_MS / 1000,
      ease: [0.16, 1, 0.3, 1],
    });
    setTimeout(() => {
      if (skipped) return;
      spinControlsRef.current = animate(rotationY, resetTarget + SPIN_TOTAL_DEG, {
        duration: FLIGHT_DURATION_MS / 1000,
        ease: "linear",
      });
      flightControlsRef.current = animate(0, 1, {
        duration: FLIGHT_DURATION_MS / 1000,
        ease: "linear",
        onUpdate: (t) => {
          const pos = flightPositionAt(t);
          const x = pos.x;
          const y = pos.y;
          const scale = pos.scale;
          let opacity = 1;
          if (t > T_SWEEP_END) {
            const et = (t - T_SWEEP_END) / (1 - T_SWEEP_END);
            opacity = et < 0.7 ? 1 : 1 - (et - 0.7) / 0.3;
          }

          const dts = 0.006;
          const tA = Math.max(0.0001, t - dts);
          const tB = Math.min(0.9999, t + dts);
          const pA = flightPositionAt(tA);
          const pB = flightPositionAt(tB);
          const dxPx = ((pB.x - pA.x) * window.innerWidth) / 100;
          const dyPx = ((pB.y - pA.y) * window.innerHeight) / 100;
          if (Math.hypot(dxPx, dyPx) > 0.001) {
            const targetDeg =
              (Math.atan2(dyPx, dxPx) * 180) / Math.PI + 90;
            const curDeg = flightRotateZ.get();
            let delta = targetDeg - curDeg;
            while (delta > 180) delta -= 360;
            while (delta < -180) delta += 360;
            let next = curDeg + delta * 0.18;
            if (t < 0.06) next = next * (t / 0.06);
            flightRotateZ.set(next);
          }

          flightXVw.set(x);
          flightYVh.set(y);
          flightScale.set(scale);
          flightOpacity.set(opacity);
        },
      });
    }, RESET_BEFORE_FLIGHT_MS);
  };

  const handlePan = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (selectorMode) return;
    if (clicked || !morphDone) return;
    rotationY.set(rotationY.get() + info.delta.x * 0.75);
  };

  const handlePanEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (selectorMode) return;
    if (clicked || !morphDone) return;
    if (Math.abs(info.velocity.x) < 40) return;
    animate(rotationY, rotationY.get(), {
      type: "inertia",
      velocity: info.velocity.x * 0.9,
      power: 0.85,
      timeConstant: 850,
      restDelta: 0.4,
    });
  };

  const settledNameX =
    heroMetrics.viewportWidth > 0 && heroMetrics.nameWidth > 0
      ? Math.min(
          144,
          Math.max(
            80,
            Math.min(heroMetrics.viewportWidth, HERO_STAGE_MAX_WIDTH) *
              HERO_STAGE_LEFT_GUTTER,
          ),
        ) -
        (HERO_STAGE_MAX_WIDTH - heroMetrics.nameWidth) / 2
      : "-18vw";
  const settledNameY =
    heroStageHeight * HERO_SETTLED_Y_RATIO;
  const heroStageStyle = {
    width: HERO_STAGE_MAX_WIDTH,
    height: HERO_STAGE_MAX_HEIGHT,
    left: heroStageLeft,
    top: heroStageTop,
    transform: `scale(${heroStageScale})`,
    transformOrigin: "top left",
  };

  return (
    <section
      ref={sectionRef}
      className="relative h-screen w-full overflow-hidden bg-neutral-50"
    >
      {/* Blob container scales with the hero so the pastel atmosphere stays
          proportional to the rest of the composition on every screen. The
          scale grows blobs outward from the viewport center; the section's
          overflow-hidden clips any spill at the edges. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{
          transform: `scale(${heroStageScale})`,
          transformOrigin: "50% 50%",
        }}
      >
        <motion.div
          className="absolute -top-24 -right-32 h-[36rem] w-[36rem] rounded-full opacity-[0.32] blur-3xl"
          style={{ background: PINK, willChange: "transform" }}
          animate={{
            x: [0, -180, 70, -130, 40, 0],
            y: [0, 110, -50, 130, -30, 0],
            scale: [1, 1.14, 0.92, 1.08, 0.98, 1],
          }}
          transition={{
            duration: 22,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
        <motion.div
          className="absolute top-1/3 left-[8%] h-[32rem] w-[32rem] rounded-full opacity-[0.26] blur-3xl"
          style={{ background: CYAN, willChange: "transform" }}
          animate={{
            x: [0, 160, -70, 120, -40, 0],
            y: [0, -120, 80, -40, 60, 0],
            scale: [1, 0.9, 1.15, 0.96, 1.06, 1],
          }}
          transition={{
            duration: 26,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
        <motion.div
          className="absolute -bottom-24 right-[18%] h-[28rem] w-[28rem] rounded-full opacity-[0.22] blur-3xl"
          style={{ background: YELLOW, willChange: "transform" }}
          animate={{
            x: [0, -150, 90, -60, 40, 0],
            y: [0, -90, 110, -130, 50, 0],
            scale: [1, 1.1, 0.94, 1.16, 0.98, 1],
          }}
          transition={{
            duration: 30,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
        <motion.div
          className="absolute top-1/4 right-1/3 h-[22rem] w-[22rem] rounded-full opacity-[0.18] blur-3xl"
          style={{ background: VIOLET, willChange: "transform" }}
          animate={{
            x: [0, 100, -80, 60, -30, 0],
            y: [0, 70, -90, 40, -60, 0],
            scale: [1, 1.08, 0.9, 1.12, 1, 1],
          }}
          transition={{
            duration: 28,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </div>
      {/* Main 3D visual: wireframe bust on the right, behind the name+text.
          MOUNTED FROM PAGE LOAD so all the heavy work (GLTF parse,
          WireframeGeometry build, shader compile, GPU upload) finishes
          during the Steezy intro. When `nameSettled` flips, the bust
          fades in over already-warm GPU buffers -- no spike at that moment.
          The load itself is wrapped in requestIdleCallback inside the
          component, so it slots into idle gaps between Steezy's frames.
          Hidden on mobile so the phone layout stays clean. */}
      {/* Bust is INSIDE heroStageStyle (the 1440x768 artboard with
          transform: scale(heroStageScale) applied). That means the bust,
          name, blobs, and everything else in the artboard all scale by
          the same single factor on every screen -- the page is laid out
          once at the design reference (1440x768) and the browser scales
          the whole composition to fit the viewport. Whatever you see at
          1440x768 IS what shows up scaled on a 1920x947 monitor, just
          bigger. Tune width/height (design-space px) to resize the bust;
          tune right/bottom to reposition. */}
      <motion.div
        aria-hidden
        className="absolute z-[2] hidden sm:block"
        style={{
          ...heroStageStyle,
          pointerEvents: nameSettled ? undefined : "none",
        }}
        initial={false}
        animate={{
          opacity: nameSettled ? 1 : 0,
          filter: nameSettled ? "blur(0px)" : "blur(8px)",
        }}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
      >
        <div
          className="pointer-events-auto absolute"
          style={{
            right: 150,
            bottom: 30,
            width: 550,
            height: 690,
          }}
        >
          <WireframeBust className="h-full w-full" />
        </div>
      </motion.div>
      <SystemsDiagram visible={selectorMode} />
      {!selectorMode && (
        <button
          type="button"
          onClick={() => setSkipped(true)}
          disabled={skipped}
          aria-label="Skip intro"
          style={{
            transform: `scale(${heroStageScale})`,
            transformOrigin: "top right",
          }}
          className={`absolute top-6 right-6 z-30 rounded-full border border-neutral-300 bg-neutral-50/70 px-4 py-2 text-sm font-medium text-neutral-600 backdrop-blur-sm transition-all duration-300 hover:border-neutral-900 hover:text-neutral-900 ${
            skipped ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          Skip
        </button>
      )}
      <div
        className="pointer-events-none absolute z-20 flex items-center justify-center"
        style={heroStageStyle}
      >
        <motion.div
          ref={nameContainerRef}
          className="relative flex flex-col items-start"
          initial={false}
          animate={
            nameSettled
              ? { x: settledNameX, y: settledNameY, scale: 1.15 }
              : { x: 0, y: 0, scale: 1 }
          }
          transition={
            instantNameShift
              ? { duration: 0 }
              : { duration: 1.4, ease: [0.16, 1, 0.3, 1] }
          }
          style={{ transformOrigin: "50% 50%" }}
          onAnimationComplete={() => {
            // Snap Steezy onto the (possibly new) ı dot position any
            // time the name container finishes animating — covers HMR
            // and any future name-layout tweaks without restarting the
            // intro. Initial intro already drops him here, so this is
            // a cheap no-op for first paint.
            if (!mascotMode) return;
            const t = computeIDotTarget();
            if (!t) return;
            animate(flightXVw, t.vw, {
              duration: 0.45,
              ease: [0.16, 1, 0.3, 1],
            });
            animate(flightYVh, t.vh, {
              duration: 0.45,
              ease: [0.16, 1, 0.3, 1],
            });
          }}
        >
        <h1
          aria-label="Oziel Sauceda"
          className="flex text-4xl font-semibold tracking-tight whitespace-nowrap select-none sm:text-6xl md:text-7xl lg:text-8xl"
        >
          {Array.from(NAME).map((char, i) => {
            const state = letterStates[i];
            const wobble = ((i * 137) % 11) - 5;
            const target =
              state === "hidden"
                ? {
                    opacity: 0,
                    scaleX: 0.3,
                    scaleY: 0.3,
                    y: 18,
                    rotate: wobble * 1.6,
                    filter: "blur(12px) saturate(1)",
                    color: PINK,
                  }
                : state === "goo"
                  ? {
                      opacity: 1,
                      scaleX: 1.55,
                      scaleY: 0.42,
                      y: 14,
                      rotate: wobble,
                      filter: "blur(5px) saturate(1.6)",
                      color: PINK,
                    }
                  : {
                      opacity: 1,
                      scaleX: 1,
                      scaleY: 1,
                      y: 0,
                      rotate: 0,
                      filter: "blur(0px) saturate(1)",
                      color: "#0a0a0a",
                    };
            const SPRING = { type: "spring" as const, stiffness: 360, damping: 15, mass: 0.75 };
            const ROT_SPRING = { type: "spring" as const, stiffness: 220, damping: 12, mass: 0.7 };
            const formedTransition = {
              scaleX: SPRING,
              scaleY: SPRING,
              y: SPRING,
              rotate: ROT_SPRING,
              color: { duration: 0.42, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
              filter: { duration: 0.32, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
              opacity: { duration: 0.2 },
            };
            return (
              <span key={i} className="relative inline-block">
                {state !== "hidden" && (
                  <motion.span
                    aria-hidden
                    className="pointer-events-none absolute rounded-full"
                    style={{
                      left: "50%",
                      top: "55%",
                      width: 18,
                      height: 18,
                      marginLeft: -9,
                      marginTop: -9,
                      background: PINK,
                      mixBlendMode: "multiply",
                      zIndex: 0,
                    }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={
                      state === "goo"
                        ? { scale: 1.2, opacity: 0.55 }
                        : { scale: 6.5, opacity: 0 }
                    }
                    transition={
                      state === "formed"
                        ? { duration: 0.62, ease: [0.16, 1, 0.3, 1] }
                        : { duration: 0.14, ease: "easeOut" }
                    }
                  />
                )}
                <motion.span
                  ref={(el) => {
                    letterRefs.current[i] = el;
                  }}
                  className="relative inline-block"
                  style={{
                    transformOrigin: "50% 100%",
                    willChange: "transform, filter, opacity, color",
                    zIndex: 1,
                  }}
                  initial={false}
                  animate={target}
                  transition={
                    state === "formed"
                      ? formedTransition
                      : { duration: GOO_DROP_MS / 1000, ease: "easeOut" }
                  }
                >
              {char === " " ? " " : char}
                </motion.span>
              </span>
            );
          })}
        </h1>
        <motion.p
          className="mt-2 self-start pl-1 text-[10px] font-medium uppercase tracking-[0.32em] text-neutral-500 sm:text-xs"
          initial={false}
          animate={{
            opacity: nameSettled ? 1 : 0,
            y: nameSettled ? 0 : 8,
          }}
          transition={{
            duration: 0.9,
            delay: nameSettled ? 0.6 : 0,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          designer &amp; engineer ·{" "}
          <span className="relative inline-block align-baseline">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={TAGLINE_ROLES[roleIndex]}
                initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                className="inline-block"
              >
                {TAGLINE_ROLES[roleIndex]}
              </motion.span>
            </AnimatePresence>
          </span>
        </motion.p>
        <motion.div
          className="absolute top-full left-0 mt-8 max-w-xl pl-1"
          initial={false}
          animate={{
            opacity: nameSettled ? 1 : 0,
            y: nameSettled ? 0 : 8,
          }}
          transition={{
            duration: 1.1,
            delay: nameSettled ? 1.0 : 0,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          <span
            aria-hidden
            className="mb-5 block h-px w-10 bg-neutral-400"
          />
          <p className="text-base leading-relaxed text-neutral-800 sm:text-lg">
            I build tools and interfaces that take{" "}
            <span className="font-medium text-neutral-900">
              dense ideas
            </span>{" "}
            seriously — without flattening them for the sake of looking
            simple.
          </p>
          <p className="mt-4 text-sm italic leading-relaxed text-neutral-500 sm:text-[15px]">
            Sometimes that&apos;s a research interface. Sometimes a
            product. Sometimes a small experiment. Sometimes it&apos;s{" "}
            <span
              className="not-italic font-semibold"
              style={{ color: "#ec4899" }}
            >
              sauce
            </span>
            .
          </p>
        </motion.div>
        </motion.div>
      </div>


      <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
        <motion.div
          style={{
            x: flightX,
            y: flightY,
            rotate: flightRotateZ,
            scale: flightScale,
            opacity: flightOpacity,
            willChange: clicked ? "transform, opacity" : undefined,
          }}
        >
          <motion.div
            className={`pointer-events-auto ${
              selectorMode
                ? "cursor-pointer"
                : morphDone && !clicked
                  ? "cursor-grab active:cursor-grabbing"
                  : ""
            }`}
            style={{
              transformOrigin: "50% 50%",
              touchAction: "none",
              willChange: morphDone ? "transform" : undefined,
            }}
            onPan={handlePan}
            onPanEnd={handlePanEnd}
            onTap={handleTap}
          >
            <div className="relative h-56 w-56 sm:h-64 sm:w-64">
              <StarCanvas
                rotationY={rotationY}
                mouseX={mouseX}
                mouseY={mouseY}
                eyeTrackEnabled={!clicked}
                onMorphDone={handleMorphDone}
              />
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
