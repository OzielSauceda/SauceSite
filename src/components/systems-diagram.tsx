"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import * as THREE from "three";
import {
  PORTRAIT_ANCHORS,
  PORTRAIT_MICRO,
  PORTRAIT_FEATURE_EDGES,
  PORTRAIT_BBOX,
} from "@/lib/oziel-portrait-points";

// Debug flag — when true, renders the source photo behind the portrait
// using the same viewport box as the node cloud, so each point can be
// nudged visually onto its actual feature. MUST be false in production.
const SHOW_PORTRAIT_REFERENCE = false;

const PINK = "#ec4899";
const CYAN = "#22d3ee";
const YELLOW = "#eab308";
const VIOLET = "#a78bfa";
const INK = "#0a0a0a";

type NodeId =
  | "interfaces"
  | "research"
  | "design"
  | "computer-science"
  | "ai"
  | "prototypes"
  | "experiments"
  | "systems";

// Where a label sits relative to its sphere's projected screen position.
// `side` selects which edge of the label sits at the anchor point (so e.g.
// `right` means the label grows rightward from the anchor); dx/dy nudge the
// anchor away from the sphere center in pixels. Labels live in screen space
// — they never rotate or tilt with the cluster — so these anchors are 2D
// pixel offsets, not 3D world offsets.
type LabelAnchor = {
  side: "left" | "right" | "top" | "bottom";
  dx: number;
  dy: number;
};

type DiagramNode = {
  id: NodeId;
  label: string;
  x: number;
  y: number;
  color: string;
  kind: "hub" | "primary" | "secondary";
  delay: number;
  labelAnchor: LabelAnchor;
};

type Edge = {
  a: NodeId;
  b: NodeId;
  delay: number;
  kind?: "primary" | "secondary";
};

// Layout — a roughly circular constellation around the hub at (72, 50).
// Primary nodes sit at 5 cardinal-ish points (top, upper-right, lower-right,
// bottom, upper-left) so the hub-wire fan reads as a clean star. Secondaries
// fill the remaining gaps (left and right of hub) without sitting on top of
// any primary wire. Label anchors push each label radially outward — away
// from the hub *and* from the wires emanating from that node — so no label
// sits on top of a wire or on the hub sphere.
const HUB: DiagramNode = {
  id: "interfaces",
  label: "Interfaces",
  x: 72,
  y: 50,
  color: PINK,
  kind: "hub",
  delay: 0.15,
  // Hub label sits to the right at the hub's y. No hub-connected wire goes
  // due-east (the 5 fan wires all go N / NE / SE / S / NW), and the systems
  // sphere is far enough right that the label has clear runway between them.
  labelAnchor: { side: "right", dx: 24, dy: 0 },
};

const NODES: DiagramNode[] = [
  HUB,
  {
    id: "research",
    label: "Research",
    x: 72,
    y: 16,
    color: VIOLET,
    kind: "primary",
    delay: 2.74,
    labelAnchor: { side: "top", dx: 0, dy: -22 },
  },
  {
    id: "design",
    label: "Design",
    x: 88,
    y: 30,
    color: PINK,
    kind: "primary",
    delay: 2.78,
    labelAnchor: { side: "right", dx: 20, dy: -4 },
  },
  {
    id: "ai",
    label: "AI",
    x: 88,
    y: 70,
    color: CYAN,
    kind: "primary",
    delay: 2.82,
    labelAnchor: { side: "right", dx: 20, dy: 4 },
  },
  {
    id: "prototypes",
    label: "Prototypes",
    x: 60,
    y: 82,
    color: YELLOW,
    kind: "primary",
    delay: 2.86,
    labelAnchor: { side: "bottom", dx: 0, dy: 22 },
  },
  {
    id: "experiments",
    label: "Experiments",
    x: 56,
    y: 30,
    color: PINK,
    kind: "primary",
    delay: 2.90,
    labelAnchor: { side: "left", dx: -20, dy: -4 },
  },
  {
    id: "computer-science",
    label: "Computer Science",
    // Offset y from ai (y:70) so the comp-sci↔ai wire isn't perfectly
    // horizontal — that wire would otherwise sit at the same y as the label.
    x: 53,
    y: 68,
    color: VIOLET,
    kind: "secondary",
    delay: 3.00,
    labelAnchor: { side: "left", dx: -22, dy: 0 },
  },
  {
    id: "systems",
    label: "Systems",
    x: 90,
    y: 50,
    color: CYAN,
    kind: "secondary",
    delay: 3.04,
    labelAnchor: { side: "right", dx: 20, dy: 0 },
  },
];

// Sphere radii in world/pixel units, in sync with the WebGL setup below.
// Used to (a) shorten edge endpoints so wires stop at the sphere surface,
// (b) size the hover hit-area, and (c) drive the WebGL geometry — single
// source of truth so all three stay aligned. During portrait phase the
// labeled spheres shrink toward `portraitAnchor` so they don't dominate
// the face built out of small micro-nodes.
const NODE_RADIUS: Record<DiagramNode["kind"], number> = {
  hub: 11,
  primary: 7.5,
  secondary: 6,
};
const NODE_RADIUS_PORTRAIT: Record<DiagramNode["kind"], number> = {
  hub: 4.2,
  primary: 3.4,
  secondary: 2.8,
};

// Deterministic scatter positions for the micro-nodes (right half of
// viewport, around the constellation area). Stable across re-renders so
// the morph doesn't reshuffle on every re-mount.
function scatterFor(index: number): { x: number; y: number } {
  // Hash-based pseudo-random (golden-ratio multipliers) — gives a roughly
  // uniform sprinkle without needing a real RNG, and the values are pure
  // functions of `index` so the scatter pose is reproducible.
  const fx = (index + 1) * 0.6180339887;
  const fy = (index + 1) * 0.7548776662;
  const rx = fx - Math.floor(fx);
  const ry = fy - Math.floor(fy);
  return {
    x: 52 + rx * 44, // 52% – 96% of viewport width
    y: 10 + ry * 86, // 10% – 96% of viewport height
  };
}

// Phase timing: the constellation finishes assembling around 3.7s after
// `visible=true` (slowest primary node at delay=2.90 + 0.7s travel). We
// hold the formed constellation briefly so the user reads it, then morph
// into the portrait. The morph itself takes 2.6s — slow enough to read as
// a swarm assembling, fast enough not to drag.
const MORPH_START_SEC = 4.4;
const MORPH_DURATION_SEC = 2.6;

// Compute K-nearest-neighbor edges from a set of points. Used once on
// mount to wire the portrait point-cloud into a connected mesh.
function computeNNEdges(
  pts: ReadonlyArray<{ x: number; y: number }>,
  k: number,
): Array<{ a: number; b: number }> {
  const edges: Array<{ a: number; b: number }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < pts.length; i++) {
    const nearest: Array<{ j: number; d: number }> = [];
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      const d = dx * dx + dy * dy;
      let insertAt = nearest.length;
      while (insertAt > 0 && nearest[insertAt - 1].d > d) insertAt--;
      if (insertAt >= k) continue;
      nearest.splice(insertAt, 0, { j, d });
      if (nearest.length > k) nearest.pop();
    }
    for (const candidate of nearest) {
      const j = candidate.j;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a: Math.min(i, j), b: Math.max(i, j) });
    }
  }
  return edges;
}

const NODE_BY_ID = Object.fromEntries(NODES.map((node) => [node.id, node])) as Record<
  NodeId,
  DiagramNode
>;

const EDGES: Edge[] = [
  { a: "interfaces", b: "research", delay: 3.42, kind: "primary" },
  { a: "interfaces", b: "design", delay: 3.50, kind: "primary" },
  { a: "interfaces", b: "ai", delay: 3.58, kind: "primary" },
  { a: "interfaces", b: "prototypes", delay: 3.66, kind: "primary" },
  { a: "interfaces", b: "experiments", delay: 3.74, kind: "primary" },
  { a: "computer-science", b: "ai", delay: 3.88, kind: "secondary" },
  { a: "computer-science", b: "systems", delay: 3.96, kind: "secondary" },
  { a: "research", b: "experiments", delay: 4.04, kind: "secondary" },
  { a: "design", b: "systems", delay: 4.12, kind: "secondary" },
  { a: "prototypes", b: "experiments", delay: 4.20, kind: "secondary" },
  { a: "systems", b: "prototypes", delay: 4.28, kind: "secondary" },
  { a: "research", b: "design", delay: 4.36, kind: "secondary" },
];

// Sonar pings emitted from the hub during the 3-second startup. Three
// charging rings build tension by repeatedly expanding outward and
// dissolving; the final RELEASE_PING (separate, faster, brighter) fires
// the instant the outer nodes start launching, sealing the metaphor
// that the hub is the source of everything.
const SONAR_PINGS = [
  { delay: 0.55, duration: 1.7, peakScale: 7, peakOpacity: 0.45 },
  { delay: 1.25, duration: 1.7, peakScale: 7, peakOpacity: 0.45 },
  { delay: 1.95, duration: 1.5, peakScale: 6.5, peakOpacity: 0.42 },
];

const RELEASE_PING = {
  delay: 2.74,
  duration: 0.42,
  peakScale: 20,
  peakOpacity: 0.98,
};

// Slower echo that blooms behind the primary ring for depth
const RELEASE_PING_ECHO = {
  delay: 2.78,
  duration: 0.78,
  peakScale: 14,
  peakOpacity: 0.55,
};

// Combined portrait point cloud: indices 0..NODES.length-1 are the labeled
// anchor spheres (Interfaces, Research, ...), the rest are the small
// silhouette micro-spheres. The shared index space lets us reference both
// kinds of points uniformly when building the nearest-neighbor edge mesh.
type PortraitPointRef =
  | { kind: "labeled"; nodeId: NodeId; x: number; y: number }
  | { kind: "micro"; microIndex: number; x: number; y: number };

const PORTRAIT_POINTS: ReadonlyArray<PortraitPointRef> = [
  ...NODES.map(
    (n): PortraitPointRef => ({
      kind: "labeled",
      nodeId: n.id,
      x: PORTRAIT_ANCHORS[n.id].x,
      y: PORTRAIT_ANCHORS[n.id].y,
    }),
  ),
  ...PORTRAIT_MICRO.map(
    (m, i): PortraitPointRef => ({
      kind: "micro",
      microIndex: i,
      x: m.x,
      y: m.y,
    }),
  ),
];

// Portrait edge list = feature chain edges + supplemental nearest-neighbor.
// Feature chains (hair outline, jaw, brows, mustache, smile, …) give each
// silhouette a clean continuous stroke; the sparse K=1 NN pass adds a thin
// secondary mesh between features so the cloud reads as one connected
// sculpture instead of a stack of separate strokes. Dedup ensures we don't
// draw the same edge twice from both sources.
const PORTRAIT_EDGES: ReadonlyArray<{ a: number; b: number }> = (() => {
  const out: Array<{ a: number; b: number }> = [];
  const seen = new Set<string>();
  const add = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (lo === hi) return;
    const key = `${lo}-${hi}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ a: lo, b: hi });
  };
  // Feature chains — offset PORTRAIT_FEATURE_EDGES indices (which point
  // into PORTRAIT_MICRO) by NODES.length, since the labeled anchors come
  // first in PORTRAIT_POINTS.
  const microOffset = NODES.length;
  for (const e of PORTRAIT_FEATURE_EDGES) {
    add(e.a + microOffset, e.b + microOffset);
  }
  // Supplemental NN pass — K=2 creates the light triangular web in the
  // dense portrait style while the feature chains preserve recognizable
  // silhouettes for hair, brows, eyes, smile, mustache, and jaw.
  if (PORTRAIT_MICRO.length > 0) {
    for (const e of computeNNEdges(PORTRAIT_POINTS, 2)) add(e.a, e.b);
  }
  return out;
})();

export function SystemsDiagram({ visible }: { visible: boolean }) {
  if (PORTRAIT_MICRO.length === 0) return null;

  const reduce = useReducedMotion() ?? false;
  const [hovered, setHovered] = useState<NodeId | null>(null);
  const [vp, setVp] = useState({ w: 1440, h: 900 });
  const [grabbing, setGrabbing] = useState(false);

  // Rotation MotionValues — driven by useAnimationFrame for autonomous spin,
  // and overridden by pointer drag handlers when the user grabs the diagram.
  const rotateXMv = useMotionValue(0);
  const rotateYMv = useMotionValue(0);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ clientX: 0, clientY: 0, rotX: 0, rotY: 0 });
  // Sway happens around these baseline angles. The user's drag re-anchors the
  // baselines so releasing doesn't snap back to a fixed neutral pose — the
  // diagram keeps swaying gently around whatever angle they left it at.
  const baseRef = useRef({ x: 12, y: 0 });
  // WebGL canvas — the node spheres live here as real THREE.SphereGeometry
  // meshes (not CSS dots). The canvas is rendered behind the labels and the
  // SVG edges; its scene rotation is driven from the same rotateX/rotateY
  // MotionValues that drive the CSS sway, and on every WebGL tick we project
  // each sphere's world position to screen pixels and push those positions
  // into the SVG edge endpoints and the label wrapper transforms below. So
  // spheres, edges, and labels share one projected coordinate system.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoveredRef = useRef<NodeId | null>(null);
  const animStartRef = useRef<number | null>(null);
  const reduceRef = useRef(reduce);
  // Imperative refs — updated every frame from the WebGL tick. React state
  // would re-render 60×/s, so we mutate DOM attributes directly instead.
  // The label TEXT and the hover BUTTON have their own refs (separate from
  // the wrapper) because their opacity / pointer-events are gated on a
  // per-node arrival progress that the wrapper does NOT inherit — the
  // wrapper has to stay fully visible so the accent ring FX inside it can
  // still play during the launch.
  const edgeLineRefs = useRef<(SVGLineElement | null)[]>([]);
  // Separate ref array for the portrait NN edge mesh. These lines fade in
  // during the morph and lock to the moving sphere positions every frame.
  const portraitEdgeLineRefs = useRef<(SVGLineElement | null)[]>([]);
  const labelWrapperRefs = useRef<Partial<Record<NodeId, HTMLDivElement | null>>>({});
  const labelTextRefs = useRef<Partial<Record<NodeId, HTMLSpanElement | null>>>({});
  const labelButtonRefs = useRef<Partial<Record<NodeId, HTMLButtonElement | null>>>({});
  // Wrapper around the hub-centered FX (halo, sonar pings, release flash).
  // Faded out by the tick during the morph so the hub charge effects don't
  // hover over an empty space once the hub sphere has migrated to the nose
  // anchor in the portrait.
  const hubFxLayerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    hoveredRef.current = hovered;
  }, [hovered]);

  useEffect(() => {
    reduceRef.current = reduce;
  }, [reduce]);

  useEffect(() => {
    if (visible) {
      animStartRef.current = performance.now();
    } else {
      animStartRef.current = null;
    }
  }, [visible]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();

    // Match the CSS `perspective: 1200px` on the outer wrapper exactly: place
    // the camera 1200 world-units from origin and derive the FOV from the
    // current canvas height. With this, the WebGL projection matches the CSS
    // 3D projection used by the rotating label/edge layer, so spheres stay
    // visually aligned to their labels at any rotation.
    const CSS_PERSPECTIVE = 1200;
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 8000);
    camera.position.set(0, 0, CSS_PERSPECTIVE);
    camera.lookAt(0, 0, 0);

    // Lighting — key from upper-left so the specular highlight on each sphere
    // sits at roughly the same screen location as the previous CSS hotspot
    // (top-left of the dot), plus a warm rim and cool fill for depth.
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.55);
    key.position.set(-3, 4, 3.5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff9ec5, 0.55);
    rim.position.set(2.5, -1.5, -2);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xc4e9ff, 0.4);
    fill.position.set(2, -3, 2.5);
    scene.add(fill);

    // All node spheres live in this group so we can rotate the whole cluster
    // around the hub by setting group.rotation.{x,y} each frame from the
    // shared MotionValues — same pivot, same angles as the CSS layer.
    const group = new THREE.Group();
    scene.add(group);

    // Two distinct kinds of spheres share the scene:
    //   - labeled: the original 8 concept nodes. They launch from the hub
    //     into a constellation, then shrink and migrate to anchor points
    //     within the face during the portrait morph.
    //   - micro:   ~120 small spheres that trace the portrait silhouette.
    //     They appear at deterministic scatter positions, then converge
    //     into the face/shoulders during the morph.
    type LabeledItem = {
      kind: "labeled";
      node: DiagramNode;
      mesh: THREE.Mesh;
      material: THREE.MeshPhysicalMaterial;
      // Position from the original constellation layout (post-launch).
      constellationTarget: THREE.Vector3;
      // Position within the portrait silhouette (post-morph).
      portraitTarget: THREE.Vector3;
      hoverColor: THREE.Color;
      // Launch progress (hub → constellation). Used for label gating + hub
      // FX timing, and as the multiplier for sphere opacity during phase 1.
      progress: number;
      baseRadius: number;
      portraitRadius: number;
    };
    type MicroItem = {
      kind: "micro";
      microIndex: number;
      mesh: THREE.Mesh;
      material: THREE.MeshPhysicalMaterial;
      // Where the sphere sits before the morph (deterministic scatter).
      scatterTarget: THREE.Vector3;
      // Where it lands at the end of the morph (portrait silhouette point).
      portraitTarget: THREE.Vector3;
    };
    type AnyItem = LabeledItem | MicroItem;

    const labeledItems: LabeledItem[] = [];
    const microItems: MicroItem[] = [];
    // Indexed the same way as PORTRAIT_POINTS — labeled first, micro after —
    // so portrait-edge endpoints can be resolved by index alone.
    const itemsByPortraitIndex: AnyItem[] = [];
    const itemByNode = new Map<NodeId, LabeledItem>();
    const REST_COLOR = new THREE.Color(0x0a0a0c);

    // Labeled spheres — full-quality geometry, original radii at start. They
    // shrink toward `portraitRadius` during the morph so they don't visually
    // dominate the face once it forms.
    for (const node of NODES) {
      const baseRadius = NODE_RADIUS[node.kind];
      const portraitRadius = NODE_RADIUS_PORTRAIT[node.kind];
      const geometry = new THREE.SphereGeometry(baseRadius, 48, 48);
      const material = new THREE.MeshPhysicalMaterial({
        color: REST_COLOR.clone(),
        roughness: 0.32,
        metalness: 0.15,
        clearcoat: 0.9,
        clearcoatRoughness: 0.18,
        reflectivity: 0.55,
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(geometry, material);
      group.add(mesh);
      const item: LabeledItem = {
        kind: "labeled",
        node,
        mesh,
        material,
        constellationTarget: new THREE.Vector3(),
        portraitTarget: new THREE.Vector3(),
        hoverColor: new THREE.Color(node.color),
        progress: 0,
        baseRadius,
        portraitRadius,
      };
      labeledItems.push(item);
      itemByNode.set(node.id, item);
      itemsByPortraitIndex.push(item);
    }

    // Micro spheres — small, low-poly (cheap), shared geometry, per-mesh
    // material so opacity can be controlled independently during the
    // staggered fade-in. Dense portrait mode uses many more nodes, so the
    // radius stays restrained and ink-like.
    const MICRO_RADIUS = 1.65;
    const microGeometry = new THREE.SphereGeometry(MICRO_RADIUS, 10, 10);
    for (let i = 0; i < PORTRAIT_MICRO.length; i++) {
      const material = new THREE.MeshPhysicalMaterial({
        color: REST_COLOR.clone(),
        roughness: 0.4,
        metalness: 0.08,
        clearcoat: 0.6,
        clearcoatRoughness: 0.25,
        reflectivity: 0.4,
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(microGeometry, material);
      group.add(mesh);
      const item: MicroItem = {
        kind: "micro",
        microIndex: i,
        mesh,
        material,
        scatterTarget: new THREE.Vector3(),
        portraitTarget: new THREE.Vector3(),
      };
      microItems.push(item);
      itemsByPortraitIndex.push(item);
    }

    const layout = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w === 0 || h === 0) return;

      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = (2 * Math.atan(h / 2 / CSS_PERSPECTIVE) * 180) / Math.PI;
      camera.updateProjectionMatrix();

      const hubPx = (HUB.x / 100) * w;
      const hubPy = (HUB.y / 100) * h;
      group.position.set(hubPx - w / 2, -(hubPy - h / 2), 0);

      // Helper: percentage → world coordinates relative to the hub.
      const placeXY = (xPct: number, yPct: number, zWorld: number) => {
        const dx = (xPct / 100) * w - hubPx;
        const dy = -((yPct / 100) * h - hubPy);
        return { dx, dy, dz: zWorld };
      };

      for (const item of labeledItems) {
        const c = placeXY(
          item.node.x,
          item.node.y,
          item.node.kind === "hub" ? 40 : (50 - item.node.y) * 1.4,
        );
        item.constellationTarget.set(c.dx, c.dy, c.dz);
        const anchor = PORTRAIT_ANCHORS[item.node.id];
        const p = placeXY(anchor.x, anchor.y, 0);
        item.portraitTarget.set(p.dx, p.dy, p.dz);
      }

      for (const item of microItems) {
        const portrait = PORTRAIT_MICRO[item.microIndex];
        const scatter = scatterFor(item.microIndex);
        const sc = placeXY(scatter.x, scatter.y, 0);
        // Slight z jitter on the portrait side so the point-cloud reads as
        // having depth (deterministic offset so it doesn't reshuffle).
        const zJitter =
          (((item.microIndex * 73) % 17) - 8) * 1.2;
        const pt = placeXY(portrait.x, portrait.y, zJitter);
        item.scatterTarget.set(sc.dx, sc.dy, sc.dz);
        item.portraitTarget.set(pt.dx, pt.dy, pt.dz);
      }
    };

    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(canvas);

    let raf = 0;
    const targetColor = new THREE.Color();
    const ndc = new THREE.Vector3();
    const EDGE_GAP = 4;

    // Projected screen positions per portrait index — populated each frame
    // and read by both the hand-authored edge pass and the NN portrait edge
    // pass. Keyed by index into PORTRAIT_POINTS / itemsByPortraitIndex.
    const projectedByIndex = new Array<{ x: number; y: number } | null>(
      itemsByPortraitIndex.length,
    ).fill(null);
    // Lookup so the hand-authored EDGES list (keyed by NodeId) can resolve
    // an endpoint to its projected screen position via the labeled items.
    const indexByNodeId = new Map<NodeId, number>();
    for (let i = 0; i < PORTRAIT_POINTS.length; i++) {
      const p = PORTRAIT_POINTS[i];
      if (p.kind === "labeled") indexByNodeId.set(p.nodeId, i);
    }

    // Per-item current radius — used by both the WebGL scale and the SVG
    // edge-shortening so wires always stop at the visible sphere surface.
    const currentRadius = (item: AnyItem) => {
      if (item.kind === "labeled") {
        // Labeled radius is base * scale.x (scale handles morph shrink + hover).
        return item.baseRadius * item.mesh.scale.x;
      }
      return MICRO_RADIUS;
    };

    const tick = () => {
      group.rotation.x = (rotateXMv.get() * Math.PI) / 180;
      group.rotation.y = (rotateYMv.get() * Math.PI) / 180;

      const t0 = animStartRef.current;
      const reduced = reduceRef.current;
      const hov = hoveredRef.current;

      // Morph progress drives: labeled position lerp, labeled radius shrink,
      // micro position lerp, label fade-out, hand-authored edge fade-out,
      // and portrait NN edge fade-in. Single source of truth.
      let morphProgress: number;
      if (t0 == null) morphProgress = 0;
      else if (reduced) morphProgress = 1;
      else {
        const elapsed = (performance.now() - t0) / 1000;
        morphProgress = Math.max(
          0,
          Math.min(1, (elapsed - MORPH_START_SEC) / MORPH_DURATION_SEC),
        );
      }
      // Ease-in-out cubic — feels like a graceful swarm assembly.
      const easedMorph =
        morphProgress < 0.5
          ? 4 * morphProgress * morphProgress * morphProgress
          : 1 - Math.pow(-2 * morphProgress + 2, 3) / 2;

      const connectedSet = new Set<NodeId>();
      if (hov) {
        for (const e of EDGES) {
          if (e.a === hov) connectedSet.add(e.b);
          if (e.b === hov) connectedSet.add(e.a);
        }
      }

      // === Labeled spheres ===
      for (const item of labeledItems) {
        const isHub = item.node.kind === "hub";
        let launchProgress: number;
        if (t0 == null) {
          launchProgress = 0;
        } else if (reduced) {
          launchProgress = 1;
        } else {
          const elapsed = (performance.now() - t0) / 1000;
          const delay = isHub ? 0.1 : item.node.delay;
          const dur = isHub ? 0.9 : 0.7;
          launchProgress = Math.max(0, Math.min(1, (elapsed - delay) / dur));
        }
        item.progress = launchProgress;
        const easedLaunch = 1 - Math.pow(1 - launchProgress, 3);

        // Phase 1: hub (0,0,0) → constellation. Phase 2: constellation →
        // portrait. The two compose because we always start the morph lerp
        // from the *current* phase-1 result (which is constellation once
        // launch completes at ~3.7s, well before morph starts at 4.5s).
        const cx = item.constellationTarget.x * easedLaunch;
        const cy = item.constellationTarget.y * easedLaunch;
        const cz = item.constellationTarget.z * easedLaunch;
        item.mesh.position.set(
          cx + (item.portraitTarget.x - cx) * easedMorph,
          cy + (item.portraitTarget.y - cy) * easedMorph,
          cz + (item.portraitTarget.z - cz) * easedMorph,
        );

        // Sphere visibility: gated on launch progress in phase 1, stays
        // visible through and after the morph.
        item.material.opacity = launchProgress;

        // Hover color lerp (unchanged from before).
        const isHovered = hov === item.node.id;
        if (isHovered) targetColor.copy(item.hoverColor);
        else targetColor.copy(REST_COLOR);
        item.material.color.lerp(targetColor, 0.12);

        // Compose hover bump with morph shrink. Hover only applies pre-morph
        // (no hovering during/after the portrait); morph drives base scale
        // from 1 → portraitRadius/baseRadius.
        const morphScale =
          1 +
          (item.portraitRadius / item.baseRadius - 1) * easedMorph;
        const hoverBump =
          isHovered && morphProgress < 0.05 ? 1.18 : 1;
        const targetS = morphScale * hoverBump;
        const s =
          item.mesh.scale.x + (targetS - item.mesh.scale.x) * 0.15;
        item.mesh.scale.set(s, s, s);
      }

      // === Micro spheres ===
      // Appearance: opacity ramps in starting at t = MORPH_START - 1s and
      // completing by MORPH_START, so the swarm is visibly scattered before
      // it starts converging. Each micro has a tiny per-index stagger.
      for (const item of microItems) {
        let appearProgress: number;
        if (t0 == null) {
          appearProgress = 0;
        } else if (reduced) {
          appearProgress = 1;
        } else {
          const elapsed = (performance.now() - t0) / 1000;
          // Stagger appearance over ~1.5s so the swarm reads as fading in
          // rather than popping in en masse. Spread starts at 2.5s (after
          // the hub release pulse) and the last one is fully visible by
          // MORPH_START_SEC, so the scattered cloud is clearly readable
          // before it starts converging into the portrait.
          const indexStagger = (item.microIndex / PORTRAIT_MICRO.length) * 1.4;
          const start = 2.5 + indexStagger;
          appearProgress = Math.max(0, Math.min(1, (elapsed - start) / 0.55));
        }
        // Position: lerp from scatter to portrait by the shared morph value.
        const sx = item.scatterTarget.x;
        const sy = item.scatterTarget.y;
        const sz = item.scatterTarget.z;
        item.mesh.position.set(
          sx + (item.portraitTarget.x - sx) * easedMorph,
          sy + (item.portraitTarget.y - sy) * easedMorph,
          sz + (item.portraitTarget.z - sz) * easedMorph,
        );
        item.material.opacity = appearProgress;
      }

      // === Project all items to screen space ===
      group.updateMatrixWorld();
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      for (let i = 0; i < itemsByPortraitIndex.length; i++) {
        const item = itemsByPortraitIndex[i];
        ndc.setFromMatrixPosition(item.mesh.matrixWorld);
        ndc.project(camera);
        const sx = (ndc.x * 0.5 + 0.5) * cw;
        const sy = (-ndc.y * 0.5 + 0.5) * ch;
        projectedByIndex[i] = { x: sx, y: sy };

        if (item.kind === "labeled") {
          const wrap = labelWrapperRefs.current[item.node.id];
          if (wrap) {
            wrap.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
          }
          // Label gating: visible during the constellation phase, fades out
          // as the morph progresses so labels don't cover the face.
          const labelGate = smoothstep(0.82, 0.95, item.progress);
          const morphFade = 1 - smoothstep(0.05, 0.45, morphProgress);
          const isHovered = hov === item.node.id;
          const inConnected = connectedSet.has(item.node.id);
          const isHot = hov === null || isHovered || inConnected;
          const hotMult = isHot ? 1 : 0.22;
          const text = labelTextRefs.current[item.node.id];
          if (text) {
            text.style.opacity = String(labelGate * hotMult * morphFade);
          }
          const btn = labelButtonRefs.current[item.node.id];
          if (btn) {
            const enabled = item.progress > 0.9 && morphProgress < 0.3;
            btn.style.pointerEvents = enabled ? "auto" : "none";
          }
        }
      }

      // Hub-centered FX (halo, sonar pings, flash) — fade out alongside the
      // labels during the morph so they don't hover over an empty location
      // once the hub sphere has moved to the nose.
      const fxLayer = hubFxLayerRef.current;
      if (fxLayer) {
        fxLayer.style.opacity = String(
          1 - smoothstep(0.05, 0.4, morphProgress),
        );
      }

      // === Hand-authored edges (constellation, fade out during morph) ===
      const constellationEdgeFade = 1 - smoothstep(0.05, 0.4, morphProgress);
      for (let i = 0; i < EDGES.length; i++) {
        const edge = EDGES[i];
        const line = edgeLineRefs.current[i];
        if (!line) continue;
        const ai = indexByNodeId.get(edge.a);
        const bi = indexByNodeId.get(edge.b);
        if (ai == null || bi == null) continue;
        const a = projectedByIndex[ai];
        const b = projectedByIndex[bi];
        const itemA = itemByNode.get(edge.a);
        const itemB = itemByNode.get(edge.b);
        if (!a || !b || !itemA || !itemB) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.001) {
          const ux = dx / len;
          const uy = dy / len;
          const aShrink = currentRadius(itemA) + EDGE_GAP;
          const bShrink = currentRadius(itemB) + EDGE_GAP;
          line.setAttribute("x1", String(a.x + ux * aShrink));
          line.setAttribute("y1", String(a.y + uy * aShrink));
          line.setAttribute("x2", String(b.x - ux * bShrink));
          line.setAttribute("y2", String(b.y - uy * bShrink));
        }

        const arrivalGate =
          smoothstep(0.88, 1.0, itemA.progress) *
          smoothstep(0.88, 1.0, itemB.progress);

        const isDirect = hov === edge.a || hov === edge.b;
        const isHot = hov === null || isDirect;
        const base = isDirect
          ? 0.58
          : isHot
            ? edge.kind === "primary"
              ? 0.28
              : 0.15
            : 0.045;

        line.style.opacity = String(base * arrivalGate * constellationEdgeFade);
        line.setAttribute("stroke", isDirect ? PINK : INK);
        line.setAttribute(
          "stroke-width",
          String(isDirect ? 1.4 : edge.kind === "primary" ? 1 : 0.7),
        );
      }

      // === Portrait edges (feature chains + supplemental NN). Fade in
      // during the morph, overlapping the constellation-edge fadeout so
      // there's no "no edges" gap. ===
      const portraitEdgeFade = smoothstep(0.18, 0.7, morphProgress);
      for (let i = 0; i < PORTRAIT_EDGES.length; i++) {
        const e = PORTRAIT_EDGES[i];
        const line = portraitEdgeLineRefs.current[i];
        if (!line) continue;
        const a = projectedByIndex[e.a];
        const b = projectedByIndex[e.b];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.001) {
          const ux = dx / len;
          const uy = dy / len;
          const itemA = itemsByPortraitIndex[e.a];
          const itemB = itemsByPortraitIndex[e.b];
        const aShrink = currentRadius(itemA) + 0.6;
        const bShrink = currentRadius(itemB) + 0.6;
          line.setAttribute("x1", String(a.x + ux * aShrink));
          line.setAttribute("y1", String(a.y + uy * aShrink));
          line.setAttribute("x2", String(b.x - ux * bShrink));
          line.setAttribute("y2", String(b.y - uy * bShrink));
        }
        line.style.opacity = String(0.16 * portraitEdgeFade);
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      for (const item of labeledItems) {
        item.mesh.geometry.dispose();
        item.material.dispose();
      }
      for (const item of microItems) {
        item.material.dispose();
      }
      microGeometry.dispose();
      renderer.dispose();
    };
  }, [rotateXMv, rotateYMv]);

  useEffect(() => {
    const update = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);

  // Autonomous rotation — bounded multi-axis sway so the diagram reads as a
  // 3D object hovering and turning slowly in place, never going edge-on (which
  // would expose that the nodes are flat discs). Eases toward the sine target
  // so dragging interrupts cleanly and the diagram smoothly drifts back when
  // released, instead of snapping. Pauses while dragging or reduced motion.
  useAnimationFrame((t) => {
    if (draggingRef.current || reduce || !visible) return;
    // Gentle sway *around* the current baseline (updated on drag release),
    // so the diagram keeps whatever angle the user left it at instead of
    // snapping back to a fixed neutral pose. Different periods on X/Y so
    // the motion never repeats and feels organic.
    const targetY = baseRef.current.y + Math.sin(t * 0.00025) * 10;
    const targetX = baseRef.current.x + Math.sin(t * 0.00037) * 6;
    const ease = 0.045;
    rotateYMv.set(rotateYMv.get() + (targetY - rotateYMv.get()) * ease);
    rotateXMv.set(rotateXMv.get() + (targetX - rotateXMv.get()) * ease);
  });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Don't hijack presses that land on node buttons — they handle their own hover.
    if ((event.target as HTMLElement).closest("button")) return;
    draggingRef.current = true;
    setGrabbing(true);
    dragStartRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      rotX: rotateXMv.get(),
      rotY: rotateYMv.get(),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const dx = event.clientX - dragStartRef.current.clientX;
    const dy = event.clientY - dragStartRef.current.clientY;
    // ~0.4° per pixel — feels like spinning a globe
    rotateYMv.set(dragStartRef.current.rotY + dx * 0.4);
    rotateXMv.set(dragStartRef.current.rotX - dy * 0.4);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setGrabbing(false);
    // Re-anchor the autonomous sway around the angle the user just left it at,
    // so it sways *around* that pose instead of easing back to (12°, 0°).
    baseRef.current = { x: rotateXMv.get(), y: rotateYMv.get() };
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released; ignore.
    }
  };

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0 hidden overflow-visible lg:block"
      initial={false}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 0.5 }}
      // CSS `perspective` on the outer wrapper creates the 3D viewing context
      // for children. Combined with `preserve-3d` below, this lets each node's
      // translateZ render with real depth + parallax during rotation.
      style={{ perspective: "1200px" }}
    >
      {/* DEBUG OVERLAY — toggle with SHOW_PORTRAIT_REFERENCE at the top of
          this file. Renders the source photo at exactly the same viewport
          box as the portrait point cloud (PORTRAIT_BBOX from the lib), so
          every node can be visually nudged onto the right facial feature.
          MUST be false in production. */}
      {SHOW_PORTRAIT_REFERENCE && (
        <img
          src="/oziel-portrait.jpeg"
          alt=""
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            left: `${PORTRAIT_BBOX.minX}%`,
            top: `${PORTRAIT_BBOX.minY}%`,
            width: `${PORTRAIT_BBOX.maxX - PORTRAIT_BBOX.minX}%`,
            height: `${PORTRAIT_BBOX.maxY - PORTRAIT_BBOX.minY}%`,
            objectFit: "fill",
            opacity: 0.4,
            mixBlendMode: "multiply",
            zIndex: 0,
          }}
        />
      )}
      {/* WebGL layer — real 3D node spheres (THREE.SphereGeometry +
          MeshPhysicalMaterial) lit by a key/rim/fill light rig. Sits in
          front of the SVG edges but behind the labels; pointer-events
          pass straight through to the button hit areas below. */}
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      <motion.div
        className="pointer-events-auto absolute inset-0 touch-none select-none"
        style={{
          // Pivot around the hub (72%, 50%) so rotation revolves the node
          // cluster in place rather than swinging it across the screen.
          transformOrigin: `${HUB.x}% ${HUB.y}%`,
          transformStyle: "preserve-3d",
          rotateX: rotateXMv,
          rotateY: rotateYMv,
          cursor: grabbing ? "grabbing" : "grab",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* The rotating wrapper now hosts only the hub-centered accent FX
            (halo, sonar pings, release flash). Edges and node labels live
            in the screen-space overlay below this wrapper. Everything in
            this layer is faded out by the WebGL tick once the morph
            begins, because once the hub sphere has migrated to the nose
            anchor in the portrait, these effects no longer have anything
            to hover over. */}
        <div ref={hubFxLayerRef} className="absolute inset-0">
        <motion.div
          className="absolute rounded-full"
          style={{
            left: `${HUB.x}%`,
            top: `${HUB.y}%`,
            width: 92,
            height: 92,
            marginLeft: -46,
            marginTop: -46,
            background:
              "radial-gradient(circle, rgba(236,72,153,0.22), rgba(34,211,238,0.11) 42%, transparent 70%)",
            filter: "blur(5px)",
          }}
          initial={{ opacity: 0, scale: 0.12 }}
          animate={
            visible
              ? {
                  // 3-second charge: halo appears small, then breathes
                  // through two visible pulses, dims briefly to "wind
                  // up", and finally explodes wide and bright (scale
                  // 1.85, opacity 1) at the 2.79s release beat before
                  // settling into its ambient glow.
                  opacity: [0, 0.45, 0.22, 0.55, 0.22, 0.55, 0.18, 1, 0.42],
                  scale: [0.12, 0.7, 0.62, 0.95, 0.85, 1, 0.88, 1.85, 1],
                }
              : { opacity: 0, scale: 0.12 }
          }
          transition={{
            duration: reduce ? 0.01 : 3,
            delay: reduce ? 0 : 0,
            times: [0, 0.07, 0.2, 0.33, 0.5, 0.66, 0.85, 0.93, 1],
            ease: [0.16, 1, 0.3, 1],
          }}
        />

        {/* Sonar pings — concentric rings expanding outward from the
            hub during the startup. They overlap so the "charging"
            reads as continuous, building toward the release. */}
        {SONAR_PINGS.map((ping, index) => (
          <motion.span
            key={`sonar-${index}`}
            aria-hidden
            className="absolute block rounded-full border"
            style={{
              left: `${HUB.x}%`,
              top: `${HUB.y}%`,
              width: 18,
              height: 18,
              marginLeft: -9,
              marginTop: -9,
              borderColor: PINK,
              borderWidth: 1,
            }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={
              visible
                ? {
                    opacity: [0, ping.peakOpacity, 0],
                    scale: [0.6, ping.peakScale * 0.5, ping.peakScale],
                  }
                : { opacity: 0, scale: 0.6 }
            }
            transition={{
              duration: reduce ? 0.01 : ping.duration,
              delay: reduce ? 0 : ping.delay,
              times: [0, 0.45, 1],
              ease: [0.16, 1, 0.3, 1],
            }}
          />
        ))}

        {/* Release ping — fires at the same beat as the halo flash and
            the outer-node launch. Bigger, faster, brighter than the
            charging pings so it reads unmistakably as "release". */}
        <motion.span
          aria-hidden
          className="absolute block rounded-full border"
          style={{
            left: `${HUB.x}%`,
            top: `${HUB.y}%`,
            width: 18,
            height: 18,
            marginLeft: -9,
            marginTop: -9,
            borderColor: PINK,
            borderWidth: 2,
          }}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={
            visible
              ? {
                  opacity: [0, RELEASE_PING.peakOpacity, 0],
                  scale: [0.6, RELEASE_PING.peakScale * 0.3, RELEASE_PING.peakScale],
                }
              : { opacity: 0, scale: 0.6 }
          }
          transition={{
            duration: reduce ? 0.01 : RELEASE_PING.duration,
            delay: reduce ? 0 : RELEASE_PING.delay,
            times: [0, 0.28, 1],
            ease: [0.05, 0.8, 0.3, 1],
          }}
        />

        {/* Slower echo ring that blooms behind the primary release */}
        <motion.span
          aria-hidden
          className="absolute block rounded-full border"
          style={{
            left: `${HUB.x}%`,
            top: `${HUB.y}%`,
            width: 18,
            height: 18,
            marginLeft: -9,
            marginTop: -9,
            borderColor: CYAN,
            borderWidth: 1,
          }}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={
            visible
              ? {
                  opacity: [0, RELEASE_PING_ECHO.peakOpacity, 0],
                  scale: [0.6, RELEASE_PING_ECHO.peakScale * 0.4, RELEASE_PING_ECHO.peakScale],
                }
              : { opacity: 0, scale: 0.6 }
          }
          transition={{
            duration: reduce ? 0.01 : RELEASE_PING_ECHO.duration,
            delay: reduce ? 0 : RELEASE_PING_ECHO.delay,
            times: [0, 0.35, 1],
            ease: [0.16, 1, 0.3, 1],
          }}
        />

        {/* White-hot flash at hub center — the "spark" that fires the explosion */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute rounded-full"
          style={{
            left: `${HUB.x}%`,
            top: `${HUB.y}%`,
            width: 56,
            height: 56,
            marginLeft: -28,
            marginTop: -28,
            background:
              "radial-gradient(circle, rgba(255,255,255,0.97) 0%, rgba(236,72,153,0.7) 45%, transparent 72%)",
            filter: "blur(5px)",
          }}
          initial={{ scale: 0, opacity: 0 }}
          animate={
            visible
              ? { scale: [0, 0, 0, 4.5, 0], opacity: [0, 0, 0, 0.94, 0] }
              : { scale: 0, opacity: 0 }
          }
          transition={{
            duration: reduce ? 0.01 : 3,
            times: [0, 0.89, 0.91, 0.94, 1],
            ease: "easeOut",
          }}
        />
        </div>
      </motion.div>

      {/* Screen-space overlay — edges and labels live here, NEVER in the
          rotating wrapper, so labels never appear mirrored/upside-down at
          steep angles. The WebGL tick projects each sphere's world position
          to pixels every frame and pushes those positions into the SVG line
          endpoints (via edgeLineRefs) and the label wrapper transforms
          (via labelWrapperRefs). Container is pointer-events:none; the per-
          node hit-area buttons re-enable pointer events for hover. */}
      <div className="pointer-events-none absolute inset-0 overflow-visible">
        <svg
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden
        >
          {/* Edges are plain <line>s with no Framer animation. The WebGL
              tick rewrites x1/y1/x2/y2 from projected sphere positions and
              writes opacity + stroke based on per-node progress + hover —
              one source of truth, so a wire never appears while either of
              its endpoints is still collapsed near the hub. */}
          {EDGES.map((edge, index) => (
            <line
              key={`${edge.a}-${edge.b}`}
              ref={(el) => {
                edgeLineRefs.current[index] = el;
              }}
              x1={0}
              y1={0}
              x2={0}
              y2={0}
              stroke={INK}
              strokeLinecap="round"
              strokeWidth={edge.kind === "primary" ? 1 : 0.7}
              opacity={0}
            />
          ))}
          {/* Portrait edge mesh — feature-specific ordered chains (hair
              outline, jaw, brows, mustache, smile, …) plus a sparse K=1
              nearest-neighbor pass that stitches the chains together.
              Endpoints + opacity are written by the WebGL tick from the
              same projected positions as the spheres so wires stay glued
              to moving nodes during the morph. */}
          {PORTRAIT_EDGES.map((edge, index) => (
            <line
              key={`p-${edge.a}-${edge.b}`}
              ref={(el) => {
                portraitEdgeLineRefs.current[index] = el;
              }}
              x1={0}
              y1={0}
              x2={0}
              y2={0}
              stroke={INK}
              strokeLinecap="round"
              strokeWidth={0.45}
              opacity={0}
            />
          ))}
        </svg>

        {NODES.map((node) => {
          const isHub = node.kind === "hub";
          const isHovered = hovered === node.id;
          const radius = NODE_RADIUS[node.kind];
          const labelInner = labelInnerStyle(node.labelAnchor);
          // Hit area = sphere radius + a comfortable hover ring. The dim
          // state for non-hovered labels (the 0.22 multiplier) is applied
          // by the WebGL tick, not React — so React only needs to size the
          // hit area, not toggle visibility.
          const hitSize = isHovered ? radius * 2 + 14 : radius * 2 + 8;
          return (
            <div
              key={node.id}
              ref={(el) => {
                labelWrapperRefs.current[node.id] = el;
              }}
              className="absolute left-0 top-0 will-change-transform"
              style={{
                // Set off-screen until the first projection tick fills in
                // the real transform; prevents a flash at (0,0) on mount.
                transform: "translate3d(-9999px, -9999px, 0)",
              }}
            >
              {/* Arrival accent FX — radiate outward from the projected sphere
                  position. They live in screen space so they don't tilt with
                  the cluster. Skipped for hub since the hub has its own
                  charge/release halo system in the rotating wrapper. */}
              {!isHub && (
                <>
                  <motion.span
                    aria-hidden
                    className="pointer-events-none absolute left-0 top-0 block rounded-full"
                    style={{
                      width: radius * 6,
                      height: radius * 6,
                      marginLeft: -(radius * 3),
                      marginTop: -(radius * 3),
                      background: `radial-gradient(circle, ${node.color}99 0%, ${node.color}22 55%, transparent 70%)`,
                      filter: "blur(4px)",
                    }}
                    initial={{ scale: 0.3, opacity: 0 }}
                    animate={
                      visible
                        ? { scale: [0.3, 2.4], opacity: [0.95, 0] }
                        : { scale: 0.3, opacity: 0 }
                    }
                    transition={{
                      delay: reduce ? 0 : node.delay + 0.52,
                      duration: 0.65,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  />
                  <motion.span
                    aria-hidden
                    className="pointer-events-none absolute left-0 top-0 block rounded-full border"
                    style={{
                      width: radius * 2,
                      height: radius * 2,
                      marginLeft: -radius,
                      marginTop: -radius,
                      borderColor: node.color,
                      borderWidth: 1.5,
                    }}
                    initial={{ scale: 1, opacity: 0 }}
                    animate={
                      visible
                        ? { scale: [1, 4], opacity: [0.8, 0] }
                        : { scale: 1, opacity: 0 }
                    }
                    transition={{
                      delay: reduce ? 0 : node.delay + 0.54,
                      duration: 0.5,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  />
                  <motion.span
                    aria-hidden
                    className="pointer-events-none absolute left-0 top-0 block rounded-full border"
                    style={{
                      width: radius * 2,
                      height: radius * 2,
                      marginLeft: -radius,
                      marginTop: -radius,
                      borderColor: node.color,
                      borderWidth: 1,
                    }}
                    initial={{ scale: 1, opacity: 0 }}
                    animate={
                      visible
                        ? { scale: [1, 5.5], opacity: [0.32, 0] }
                        : { scale: 1, opacity: 0 }
                    }
                    transition={{
                      delay: reduce ? 0 : node.delay + 0.68,
                      duration: 0.68,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  />
                </>
              )}

              {/* Hit area for hover — centered on the projected sphere
                  position, sized to cover the visible sphere plus a small
                  hover ring. Pointer-events start disabled and the WebGL
                  tick enables them once the sphere is past 90% progress,
                  so launching nodes can't be hovered. */}
              <button
                ref={(el) => {
                  labelButtonRefs.current[node.id] = el;
                }}
                type="button"
                tabIndex={-1}
                onPointerEnter={() => setHovered(node.id)}
                onPointerLeave={() =>
                  setHovered((current) => (current === node.id ? null : current))
                }
                aria-label={node.label}
                className="absolute left-0 top-0 cursor-default border-0 bg-transparent p-0"
                style={{
                  width: hitSize,
                  height: hitSize,
                  marginLeft: -hitSize / 2,
                  marginTop: -hitSize / 2,
                  borderRadius: "50%",
                  pointerEvents: "none",
                }}
              />

              {/* Label — screen-space, never rotated. Opacity is owned by
                  the WebGL tick (gated on this node's arrival progress and
                  the current hover state); everything else (color, font
                  weight, letter-spacing) stays React-driven because those
                  only change on hover, not every frame. */}
              <span
                ref={(el) => {
                  labelTextRefs.current[node.id] = el;
                }}
                className="absolute whitespace-nowrap font-mono uppercase transition-[color,font-weight,letter-spacing] duration-300"
                style={{
                  ...labelInner,
                  color: isHovered || isHub ? INK : "rgba(10,10,10,0.62)",
                  fontSize: isHub ? 11 : 10,
                  fontWeight: isHovered || isHub ? 650 : 500,
                  letterSpacing: isHovered || isHub ? "0.24em" : "0.18em",
                  opacity: 0,
                }}
              >
                {node.label}
              </span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// Hermite smoothstep — 0 below edge0, 1 above edge1, smooth in between.
// Used as the visibility gate for labels and edges so things fade in
// (rather than pop) as their underlying nodes finish arriving.
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Map a label anchor into a CSS style placed on the inner label span. The
// span's containing div is positioned at the projected sphere center, so
// these offsets are measured from that center.
function labelInnerStyle(anchor: LabelAnchor): CSSProperties {
  const { side, dx, dy } = anchor;
  switch (side) {
    case "right":
      return {
        left: dx,
        top: dy,
        transform: "translateY(-50%)",
      };
    case "left":
      return {
        left: dx,
        top: dy,
        transform: "translate(-100%, -50%)",
      };
    case "top":
      return {
        left: dx,
        top: dy,
        transform: "translate(-50%, -100%)",
      };
    case "bottom":
      return {
        left: dx,
        top: dy,
        transform: "translateX(-50%)",
      };
  }
}
