"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ---- knobs --------------------------------------------------------------
const MODEL_PATH = "/models/oziel-bust.glb";
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
  /** Radians/sec around Y. Pass 0 to disable. */
  rotationSpeed?: number;
  /** Uniform scale applied to the loaded model. */
  scale?: number;
  /** Background color string, or null for transparent. */
  background?: string | null;
};

// Procedural chrome / dark-marble matcap. A matcap is just a 2D image of a
// sphere; each shaded fragment looks up its color by where its normal points
// in screen space. So this canvas IS the lighting model — we paint a soft
// studio-lit sphere once, and every face on the bust reads from it. Net
// effect: a polished, sculpted look with zero real lights in the scene.
const makeChromeMatcap = () => {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Deepest shadow color fills the whole texture first — anywhere the matcap
  // is sampled outside the painted sphere falls back to this.
  ctx.fillStyle = "#040608";
  ctx.fillRect(0, 0, size, size);

  // Clip to the sphere's silhouette — matcap is conceptually a sphere.
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();

  // Body shading: bright top → dark bottom, simulating studio light from above.
  // This is what gives the bust its main sense of volume.
  const body = ctx.createLinearGradient(0, 0, 0, size);
  body.addColorStop(0, "#e6ecf6");
  body.addColorStop(0.35, "#6a7a98");
  body.addColorStop(0.7, "#1a2238");
  body.addColorStop(1, "#040608");
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, size, size);

  // Sharp specular highlight near the top — the "polished" cue. Without
  // this the surface reads as matte, not glossy.
  const spec = ctx.createRadialGradient(
    size * 0.5,
    size * 0.18,
    0,
    size * 0.5,
    size * 0.18,
    size * 0.28,
  );
  spec.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  spec.addColorStop(0.4, "rgba(255, 255, 255, 0.25)");
  spec.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = spec;
  ctx.fillRect(0, 0, size, size);

  // Bottom rim glow in the site's accent blue — picks up the brand color
  // along the underside of the bust so it cohabits with the starfield.
  const rim = ctx.createRadialGradient(
    size * 0.5,
    size * 0.95,
    0,
    size * 0.5,
    size * 0.7,
    size * 0.55,
  );
  rim.addColorStop(0, "rgba(77, 142, 255, 0.6)");
  rim.addColorStop(0.45, "rgba(77, 142, 255, 0.14)");
  rim.addColorStop(1, "rgba(77, 142, 255, 0)");
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);

  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};

export function WireframeBust({
  className,
  modelPath = MODEL_PATH,
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

    // Matcap material — needs no scene lights. The canvas texture below IS
    // the lighting environment, baked into a 2D sphere image.
    const matcapTexture = makeChromeMatcap();
    const bustMaterial = new THREE.MeshMatcapMaterial({
      matcap: matcapTexture,
    });

    // Root that holds the loaded model; we rotate this, not the camera.
    const root = new THREE.Group();
    scene.add(root);

    // --- load model ---
    const loader = new GLTFLoader();
    let disposed = false;

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

      // Walk the scene and replace each mesh with a fresh mesh that uses
      // the shared matcap material. We bake the original world transform
      // into the clone so we don't need to keep the source hierarchy alive.
      const bustGroupLocal = new THREE.Group();
      gltf.scene.updateMatrixWorld(true);

      const meshes: THREE.Mesh[] = [];
      gltf.scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
      });

      for (const mesh of meshes) {
        const geom = mesh.geometry;
        if (!geom) continue;
        // If the source GLB lacks vertex normals the matcap lookup falls
        // back to face normals and the surface reads as facetted. Compute
        // smooth normals when missing so the chrome shading stays glossy.
        if (!geom.getAttribute("normal")) geom.computeVertexNormals();
        const surface = new THREE.Mesh(geom, bustMaterial);
        surface.applyMatrix4(mesh.matrixWorld);
        bustGroupLocal.add(surface);
      }

      // Center + auto-fit so the bust sits nicely regardless of source units.
      const box = new THREE.Box3().setFromObject(bustGroupLocal);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      // Stash bust state so refit() can re-run scale + position whenever
      // the container size changes (e.g., resize between laptop & monitor).
      bustGroup = bustGroupLocal;
      bustSize = size;
      bustCenter = center;
      refit();

      root.add(bustGroupLocal);

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
      bustMaterial.dispose();
      matcapTexture?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [modelPath, rotationSpeed, scale, background]);

  return <div ref={containerRef} className={className} />;
}
