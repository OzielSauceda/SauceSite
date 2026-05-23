"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ---- knobs --------------------------------------------------------------
const MODEL_PATH = "/models/oziel-bust.glb";
const LINE_COLOR = "#2a2f3a"; // dark slate so lines read on the pastel hero
// Wires sit on top of the lit surface, so they only need to be delicate
// detail — too high here and the bust starts feeling skeletal again.
// Base opacity at the shoulders; the shader fades it further across the
// face/head (see faceFade in the fragment shader) so the head reads
// calmer than the body.
const LINE_OPACITY = 0.11;
// Soft lavender surface sits BEHIND the wireframe. Translucent + depth-writing
// so back-of-head wires are occluded (no skeletal bleed) but the edges still
// blend gently with the pastel hero. Reads as a soft 3D form, not a ghost.
const SURFACE_COLOR = "#f3edf8";
const SURFACE_OPACITY = 0.42;
const SURFACE_ROUGHNESS = 0.88;
const ROTATION_SPEED = 0.18; // radians/sec around Y (auto-rotation)
const SCALE = 1.0; // model uniform scale
const BG_COLOR: string | null = null; // null = transparent canvas; e.g. "#0b1020" for navy
const DRAG_SENSITIVITY = 0.008; // radians per pixel dragged
// Fixed internal render resolution -- the Three.js framebuffer is always
// this many CSS pixels regardless of viewport. The canvas is then stretched
// to fill its parent CSS box via 100%/100%, and the parent's transform:
// scale(heroStageScale) bitmap-scales the rendered output visually. This
// is what makes the bust scale identically to surrounding HTML on every
// screen -- one render per page load at a constant aspect ratio.
// MUST stay in sync with the bust div's width/height in star-intro.tsx.
const DESIGN_W = 550;
const DESIGN_H = 690;
// ------------------------------------------------------------------------

type Props = {
  className?: string;
  /** Override the default model path. */
  modelPath?: string;
  /** Override the default line color (hex/string). */
  lineColor?: string;
  /** Override the default line opacity (0..1). */
  lineOpacity?: number;
  /** Radians/sec around Y. Pass 0 to disable. */
  rotationSpeed?: number;
  /** Uniform scale applied to the loaded model. */
  scale?: number;
  /** Background color string, or null for transparent. */
  background?: string | null;
};

export function WireframeBust({
  className,
  modelPath = MODEL_PATH,
  lineColor = LINE_COLOR,
  lineOpacity = LINE_OPACITY,
  rotationSpeed = ROTATION_SPEED,
  scale = SCALE,
  background = BG_COLOR,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // --- renderer ---
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: background === null,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Render at the fixed design resolution (NOT the container's CSS size).
    // The `false` flag stops Three.js from setting the canvas's CSS width/
    // height -- we want CSS to stretch the canvas to fill its 550x690 parent,
    // so the parent's transform: scale() does all visual scaling.
    renderer.setSize(DESIGN_W, DESIGN_H, false);
    container.appendChild(renderer.domElement);
    // Make the canvas fill its container regardless of internal resolution.
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    // --- scene / camera ---
    const scene = new THREE.Scene();
    if (background !== null) scene.background = new THREE.Color(background);

    const camera = new THREE.PerspectiveCamera(
      32,
      DESIGN_W / DESIGN_H, // constant aspect on every screen
      0.1,
      100,
    );
    camera.position.set(0, 0, 3.6);

    // --- lights ---
    // Hemisphere fill gives a soft sky/ground gradient on the bust without
    // any harsh shadow direction. Slight cool tint on the ground side picks
    // up the lavender surface tone. The directional key adds just enough
    // form so the face doesn't look flat, positioned front-top-right to
    // catch the cheek/nose silhouette as the bust auto-rotates.
    const hemi = new THREE.HemisphereLight("#ffffff", "#d8d2e4", 0.7);
    scene.add(hemi);
    const key = new THREE.DirectionalLight("#ffffff", 0.85);
    key.position.set(2.5, 3, 2.5);
    scene.add(key);

    // Root that holds the loaded model; we rotate this, not the camera.
    const root = new THREE.Group();
    scene.add(root);

    // --- load + convert to wireframe ---
    const loader = new GLTFLoader();
    let disposed = false;

    // Animated gradient material is created inside onLoad; we keep a handle
    // out here so the tick loop can update its time uniform every frame.
    let animatedLineMaterial: THREE.ShaderMaterial | null = null;

    // Bust state shared between onLoad and handleResize so the fit can be
    // re-run when the container size changes. Null until the GLB loads.
    let bustGroup: THREE.Group | null = null;
    let bustSize: THREE.Vector3 | null = null;
    let bustCenter: THREE.Vector3 | null = null;

    // Responsive fit: derive the model scale from the camera's actual
    // visible frustum at the bust's depth, then take the tighter of the
    // width-fit and height-fit so the model never overflows either axis.
    // This is what makes the portrait look the same on a 1366x768 laptop
    // and a wide external monitor — both viewports converge on the same
    // composition instead of the width-only fit overscaling on narrow,
    // tall canvases.
    const refit = () => {
      if (!bustGroup || !bustSize || !bustCenter) return;
      const distance = camera.position.z;
      const visibleHeight =
        2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance;
      const visibleWidth = visibleHeight * camera.aspect;

      // Fill ~92% of the vertical frustum and ~84% of the horizontal one,
      // whichever is smaller. The asymmetric margins bias toward a tall
      // composition while still leaving breathing room at the shoulders.
      const desiredHeight = visibleHeight * 0.92;
      const desiredWidth = visibleWidth * 0.84;
      const scaleByHeight = desiredHeight / bustSize.y;
      const scaleByWidth = desiredWidth / bustSize.x;
      const fitScale = Math.min(scaleByHeight, scaleByWidth) * scale;
      bustGroup.scale.setScalar(fitScale);

      // Bottom-align in camera space using the scaled bounding box and the
      // real frustum bottom — no more magic -1.08 sentinel that only
      // worked for one viewport.
      const scaledHeight = bustSize.y * fitScale;
      const bottomMargin = visibleHeight * 0.02;
      const bottomY = -visibleHeight / 2 + bottomMargin;
      const centerY = bottomY + scaledHeight / 2;
      bustGroup.position.set(
        -bustCenter.x * fitScale,
        centerY - bustCenter.y * fitScale,
        -bustCenter.z * fitScale,
      );
    };

    const onLoad = (gltf: { scene: THREE.Group }) => {
      if (disposed) return;

      // Custom shader material: vertical color gradient using the hero's
      // accent palette, with a slow time-driven drift that nudges the
      // gradient stops up and down so the colors feel alive without
      // anything obviously animating.
      const lineMaterial = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: true,
        depthTest: true,
        uniforms: {
          uTime: { value: 0 },
          uMinY: { value: 0 },
          uMaxY: { value: 1 },
          uOpacity: { value: lineOpacity },
          // Hero palette
          uPink: { value: new THREE.Color("#ec4899") },
          uViolet: { value: new THREE.Color("#a78bfa") },
          uCyan: { value: new THREE.Color("#22d3ee") },
          uYellow: { value: new THREE.Color("#ffd131") },
          // Base slate the gradient blends toward so it never looks like a
          // rainbow blast. Lower mix => more colorful; higher => more slate.
          uBase: { value: new THREE.Color(lineColor) },
          uSaturation: { value: 0.55 },
        },
        vertexShader: /* glsl */ `
          varying float vY;
          varying float vX;
          void main() {
            // Use raw geometry position.x/.y (world-baked, pre-group-scale).
            vY = position.y;
            vX = position.x;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uMinY;
          uniform float uMaxY;
          uniform float uOpacity;
          uniform float uSaturation;
          uniform vec3 uPink;
          uniform vec3 uViolet;
          uniform vec3 uCyan;
          uniform vec3 uYellow;
          uniform vec3 uBase;
          varying float vY;
          varying float vX;

          // Pick the right two colors to interpolate between based on phase.
          // 4 colors -> 4 segments wrapping around: yellow -> cyan -> violet
          // -> pink -> (back to yellow).
          vec3 cyclicGradient(float phase) {
            float seg = mod(phase, 4.0);
            float f = fract(seg);
            float i = floor(seg);
            vec3 a, b;
            if (i < 0.5) { a = uYellow; b = uCyan; }
            else if (i < 1.5) { a = uCyan; b = uViolet; }
            else if (i < 2.5) { a = uViolet; b = uPink; }
            else { a = uPink; b = uYellow; }
            return mix(a, b, smoothstep(0.0, 1.0, f));
          }

          void main() {
            // 0..1 along vertical bust extent.
            float t = clamp((vY - uMinY) / (uMaxY - uMinY), 0.0, 1.0);

            // Slight horizontal warp so the gradient doesn't render as
            // flat horizontal bands -- the colors weave diagonally and
            // shift over time, giving a "consistently blending" feel.
            float warp = sin(vX * 3.2 + uTime * 0.7) * 0.06
                       + sin(vX * 5.1 - uTime * 0.45) * 0.04;

            // Phase: t maps to [0..3] across the bust (covers 3 segments),
            // plus a continuous time scroll so the colors flow upward and
            // wrap around forever.
            float phase = (t + warp) * 3.0 - uTime * 0.35;

            vec3 color = cyclicGradient(phase);

            // Blend toward slate so the wireframe still reads as
            // structural, not a saturated rainbow.
            color = mix(uBase, color, uSaturation);

            // Fade the wires across the face/head so the upper portion
            // feels calmer than the shoulders. Shoulders stay at full
            // uOpacity, head settles around 65% of that.
            float faceFade = mix(1.0, 0.65, smoothstep(0.55, 0.92, t));

            gl_FragColor = vec4(color, uOpacity * faceFade);
          }
        `,
      });
      animatedLineMaterial = lineMaterial;

      // Walk the scene, swap each mesh for LineSegments(WireframeGeometry).
      // Original meshes are made fully transparent so only the wireframe shows.
      const wireGroup = new THREE.Group();
      gltf.scene.updateMatrixWorld(true);

      const meshes: THREE.Mesh[] = [];
      gltf.scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
      });

      // Soft translucent surface sits behind the wireframe. depthWrite stays
      // on so the surface still occludes back-facing wires (no skeletal
      // bleed-through), while the low opacity lets the edges blend into the
      // pastel hero. polygonOffset nudges it back so wires don't z-fight.
      const surfaceMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(SURFACE_COLOR),
        roughness: SURFACE_ROUGHNESS,
        metalness: 0,
        transparent: true,
        opacity: SURFACE_OPACITY,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        side: THREE.FrontSide,
      });

      for (const mesh of meshes) {
        const geom = mesh.geometry;
        if (!geom) continue;

        // Solid surface clone of the mesh.
        const surface = new THREE.Mesh(geom, surfaceMaterial);
        surface.applyMatrix4(mesh.matrixWorld);
        surface.renderOrder = 0;
        wireGroup.add(surface);

        const wireGeom = new THREE.WireframeGeometry(geom);
        const lines = new THREE.LineSegments(wireGeom, lineMaterial);
        // Bake the mesh's world transform so we don't need the original hierarchy.
        lines.applyMatrix4(mesh.matrixWorld);
        lines.renderOrder = 1;
        wireGroup.add(lines);
      }

      // Center + auto-fit so the bust sits nicely regardless of source units.
      const box = new THREE.Box3().setFromObject(wireGroup);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      // Feed the gradient shader the model's Y bounds. The shader reads
      // geometry-local position.y, which lives in the same space as
      // box.min.y/box.max.y (the group's position offset doesn't alter
      // geometry-local coordinates).
      lineMaterial.uniforms.uMinY.value = box.min.y;
      lineMaterial.uniforms.uMaxY.value = box.max.y;

      // Stash bust state so refit() can re-run scale + position whenever
      // the container size changes (e.g., resize between laptop & monitor).
      bustGroup = wireGroup;
      bustSize = size;
      bustCenter = center;
      refit();

      root.add(wireGroup);

      // Async shader compile -- uses KHR_parallel_shader_compile where
      // available so the compile work happens off the main thread instead
      // of blocking the Steezy intro animation. The Promise resolves once
      // the program is linked; we don't need to await it explicitly because
      // three.js will just defer the first draw until it's ready.
      type CompileAsyncRenderer = THREE.WebGLRenderer & {
        compileAsync?: (
          scene: THREE.Object3D,
          camera: THREE.Camera,
        ) => Promise<unknown>;
      };
      const r = renderer as CompileAsyncRenderer;
      if (typeof r.compileAsync === "function") {
        r.compileAsync(scene, camera).catch(() => {
          /* compile errors will surface on first render anyway */
        });
      } else {
        renderer.compile(scene, camera);
      }
    };

    // Defer the load until the browser is idle so it doesn't fight the
    // Steezy intro animation for main-thread time. Falls back to a small
    // setTimeout where requestIdleCallback isn't available (Safari).
    const startLoad = () => {
      if (disposed) return;
      loader.load(modelPath, onLoad, undefined, (err) => {
        console.error("[WireframeBust] failed to load GLB:", err);
      });
    };
    type IdleWindow = Window & {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout: number },
      ) => number;
    };
    const w = window as IdleWindow;
    if (typeof w.requestIdleCallback === "function") {
      // 2s timeout ensures the load still fires even if the page stays busy.
      w.requestIdleCallback(startLoad, { timeout: 2000 });
    } else {
      setTimeout(startLoad, 300);
    }

    // --- interaction: drag-to-rotate (horizontal only) with inertia ---
    // Yaw is the only user-controlled axis -- the bust never tilts up or
    // down. Vertical drag is ignored on purpose. After release, the bust
    // continues spinning at the flick velocity and decelerates smoothly
    // (a "slide rotation"), then merges back into the ambient auto-spin.
    let dragYaw = 0;
    let flingVelocity = 0; // radians/sec; carried after pointer release
    let isDragging = false;
    let activePointerId: number | null = null;
    let lastDragX = 0;
    let lastDragT = 0;
    // Decay constant -- larger = stops faster. ~2.5 gives a ~1s glide for
    // typical flick speeds, which feels natural without overshooting.
    const FLING_DECAY = 6.5;

    const canvas = renderer.domElement;
    canvas.style.touchAction = "none"; // let us own gestures (no page-scroll fight)
    canvas.style.cursor = "grab";

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      activePointerId = e.pointerId;
      lastDragX = e.clientX;
      lastDragT = e.timeStamp;
      // Grabbing kills any in-flight inertia so the user has full control.
      flingVelocity = 0;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging || e.pointerId !== activePointerId) return;
      const dx = e.clientX - lastDragX;
      const dt = Math.max(0.001, (e.timeStamp - lastDragT) / 1000);
      lastDragX = e.clientX;
      lastDragT = e.timeStamp;
      const dYaw = dx * DRAG_SENSITIVITY;
      dragYaw += dYaw;
      // Smooth running estimate of instantaneous velocity (radians/sec).
      // 60/40 mix biases toward continuity so a fast flick at the end of
      // a slow drag still produces a sensible release velocity.
      const instantVel = dYaw / dt;
      flingVelocity = flingVelocity * 0.6 + instantVel * 0.4;
    };
    const endDrag = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      isDragging = false;
      activePointerId = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // capture may already be released
      }
      canvas.style.cursor = "grab";
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("lostpointercapture", endDrag);

    // --- resize ---
    // Intentionally NO ResizeObserver and NO window resize listener for
    // sizing the canvas. The whole point of this design is that the
    // Three.js framebuffer is rendered ONCE at DESIGN_W x DESIGN_H and
    // never re-rendered for a different size. CSS stretches the canvas
    // to fill its 550x690 parent box, and the parent's transform: scale()
    // bitmap-scales the rendered output visually -- exactly like the HTML
    // siblings (text, blobs, nav). camera.aspect is constant, so refit()'s
    // result is identical on every screen. The previous resize handler
    // is removed because re-running setSize/camera.aspect at the visual
    // size was what made the bust reshape across screens with different
    // aspect ratios.

    // --- animation loop ---
    let rafId = 0;
    let last = performance.now();
    let autoYaw = 0; // running auto-rotation around Y

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      autoYaw += rotationSpeed * dt;

      // Inertia: continue applying fling velocity after release, decaying
      // exponentially so the bust glides to a graceful stop instead of
      // hard-stopping the moment the pointer goes up.
      if (!isDragging && Math.abs(flingVelocity) > 0.0005) {
        dragYaw += flingVelocity * dt;
        flingVelocity *= Math.exp(-dt * FLING_DECAY);
      }

      // Final rotation = auto-spin + user drag (yaw only, X stays at 0).
      root.rotation.y = autoYaw + dragYaw;
      root.rotation.x = 0;

      // Advance the gradient shader's time so the colors drift continuously.
      if (animatedLineMaterial) {
        animatedLineMaterial.uniforms.uTime.value = now * 0.001;
      }

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    // --- cleanup ---
    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("pointercancel", endDrag);
      canvas.removeEventListener("lostpointercapture", endDrag);

      scene.traverse((obj) => {
        const anyObj = obj as THREE.Object3D & {
          geometry?: THREE.BufferGeometry;
          material?: THREE.Material | THREE.Material[];
        };
        anyObj.geometry?.dispose?.();
        const mat = anyObj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose?.();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [
    modelPath,
    lineColor,
    lineOpacity,
    rotationSpeed,
    scale,
    background,
  ]);

  return <div ref={containerRef} className={className} />;
}
