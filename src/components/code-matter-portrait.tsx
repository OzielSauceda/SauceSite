"use client";

import { useEffect, useRef } from "react";

const GLYPHS =
  "{}()[]<>/\\|=+-*&%$#@?:;.,!_01abcdefghiklmnoprstuvwxyz";

// OzzyRightSide.png is a 1254x1254 studio shot on navy. The subject sits
// slightly right-of-center, head fills the top half, shoulders bottom.
// Crop pulls in a hair from the edges so the bust sits centered in the
// canvas. We keep full vertical extent — the shoulders are what anchor
// the composition visually; cropping them off makes the head feel like
// a floating mask.
const SOURCE_CROP = {
  x: 0.02,
  y: 0.0,
  width: 0.96,
  height: 1.0,
};

// Background-detection threshold in 0–1 RGB space. Pixels whose color is
// within this Euclidean distance of the sampled corner color are treated
// as background and get no glyph. Tuned for the navy backdrop — large
// enough to swallow the subtle vignette near the corners, tight enough to
// keep dark hair (which is brown, not navy) on the subject side.
const BG_COLOR_THRESHOLD = 0.18;

type Glyph = {
  x: number;
  y: number;
  char: string;
  alpha: number;
};

type Props = {
  className?: string;
  visible: boolean;
};

function hash(n: number) {
  const x = Math.sin(n * 127.1) * 43758.5453123;
  return x - Math.floor(x);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

type Sample = { r: number; g: number; b: number; brightness: number };

function sampleArea(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
): Sample {
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(height - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
      count += 1;
    }
  }
  if (count === 0) return { r: 0, g: 0, b: 0, brightness: 0 };
  const r = rSum / count / 255;
  const g = gSum / count / 255;
  const b = bSum / count / 255;
  return {
    r,
    g,
    b,
    brightness: r * 0.299 + g * 0.587 + b * 0.114,
  };
}

// Returns the average RGB of pixels in the four corners of the source
// image — used as the "background" color. The studio shot has a uniform
// navy backdrop so any of the corners is representative.
function detectBackgroundColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { r: number; g: number; b: number } {
  const swatchSize = Math.max(8, Math.floor(Math.min(width, height) * 0.04));
  const swatches = [
    { x: swatchSize, y: swatchSize },
    { x: width - swatchSize, y: swatchSize },
    { x: swatchSize, y: height - swatchSize },
    { x: width - swatchSize, y: height - swatchSize },
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const s of swatches) {
    const sample = sampleArea(data, width, height, s.x, s.y, swatchSize);
    r += sample.r;
    g += sample.g;
    b += sample.b;
  }
  return { r: r / swatches.length, g: g / swatches.length, b: b / swatches.length };
}

function colorDistance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function buildGlyphs(
  imageData: ImageData,
  targetWidth: number,
  targetHeight: number,
) {
  const glyphs: Glyph[] = [];
  const { data, width, height } = imageData;
  const scaleX = width / targetWidth;
  const scaleY = height / targetHeight;
  const bg = detectBackgroundColor(data, width, height);
  let id = 0;

  // Tight monospaced grid — needs to be dense enough that the face's
  // value structure (cheek, brow, nose, jaw) is readable from a few feet
  // away, but each glyph carries a bit more body than the previous
  // pass so the texture feels chunky/readable rather than dusty. Cell
  // height is slightly taller than width to match typical monospace
  // font metrics so glyphs don't overlap vertically.
  const cellW = Math.max(3.2, Math.min(4.8, targetWidth / 150));
  const cellH = cellW * 1.36;
  const sampleRadius = Math.max(0.9, cellW * scaleX * 0.5);

  for (let y = cellH * 0.5; y < targetHeight; y += cellH) {
    for (let x = cellW * 0.5; x < targetWidth; x += cellW) {
      const sx = x * scaleX;
      const sy = y * scaleY;
      const pixel = sampleArea(data, width, height, sx, sy, sampleRadius);

      // Background pixels (the navy backdrop) get no glyph — this is what
      // gives the portrait its silhouette. The threshold is generous so
      // the vignette/gradient near the edges of the backdrop also gets
      // masked out, leaving only the subject.
      const distFromBg = colorDistance(pixel, bg);
      if (distFromBg < BG_COLOR_THRESHOLD) {
        id += 1;
        continue;
      }

      // Gentler contrast-stretching curve than the previous pass. The
      // 0.06 black-crush was eating general hair/neck/shoulder mass
      // along with the true-black features we wanted to void out.
      // Pulling the toe down to 0.02 means only the deepest pixels
      // (pupils, mustache core, nostril, deepest hair pockets) land
      // squarely in band 0; general dark mass lifts into bands 1–2
      // where it can carry visible low-alpha texture. Highlights still
      // saturate around brightness ~0.84 so the lit side packs solid.
      const stretched = Math.max(
        0,
        Math.min(1, (pixel.brightness - 0.02) / 0.82),
      );
      const lit = Math.pow(stretched, 0.72);

      // Posterize into 8 value bands so the face has finer structure —
      // 6 bands flattened cheek/jaw into stripes; 8 preserves more of
      // the soft gradient that gives the reference its modelled look.
      const BANDS = 8;
      const band = Math.round(lit * (BANDS - 1));
      const bandT = band / (BANDS - 1);

      // Brightness-dependent dropout. Band 0 still drops over half
      // the time so true-black features (eyes, mustache core, deep
      // hair pockets) read as negative space. Band 1 lost only a
      // tenth (down from a fifth) so general dark mass — hair crown
      // and side, left-head texture, neck shadow, shoulders — keeps
      // visibly composed of glyphs instead of thinning out. From
      // band 2 up nothing drops — midtones and highlights pack solid.
      const skipChance =
        band === 0 ? 0.55 : band === 1 ? 0.1 : 0;
      if (skipChance > 0 && hash(id + 7.3) < skipChance) {
        id += 1;
        continue;
      }

      // Edge of the silhouette: only softens glyphs whose pixel is right
      // at the background threshold so the outline doesn't read as a hard
      // rectangle. Keeps the interior of the face at full alpha.
      const edgeFade = clamp((distFromBg - BG_COLOR_THRESHOLD) / 0.10, 0, 1);

      // Wider jitter (0.12 vs 0.08) so adjacent peak-band glyphs vary
      // more per-character — keeps the bright cheek/forehead patch
      // from reading as one flat block of identical glyphs.
      const jitter = (hash(id + 91.7) - 0.5) * 0.12;
      // Floor 0.18 keeps shadow glyphs visible. Rise shortened from
      // 0.85 → 0.78 so peak alpha lands a hair below 1.0 instead of
      // saturating — softens the lit-side block while keeping the
      // shadow-vs-highlight separation.
      const alphaBase =
        (0.18 + bandT * 0.78 + jitter) * (0.88 + edgeFade * 0.12);

      const charIdx = Math.floor(hash(id + x * 0.13 + y * 0.19) * GLYPHS.length);

      glyphs.push({
        x,
        y,
        char: GLYPHS[charIdx],
        alpha: clamp(alphaBase, 0, 1),
      });

      id += 1;
    }
  }

  return glyphs;
}

export function CodeMatterPortrait({ className, visible }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visibleRef = useRef(visible);

  // Keep the rAF loop reading the latest visibility without re-running
  // the main setup effect — re-running would rebuild glyphs from the
  // source image every time `visible` flipped, which is slow.
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const image = new Image();
    let resizeObserver: ResizeObserver | null = null;
    let rafId = 0;
    let ready = false;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const snap = (v: number) => Math.round(v * dpr) / dpr;

    // Cached glyph array + measurements. buildGlyphs samples the source
    // image at every cell — expensive — so we only rebuild on resize.
    // The rAF tick reads from this cache and just re-tints + re-paints
    // each glyph per frame during a shine.
    let cachedGlyphs: Glyph[] = [];
    let cachedDx = 0;
    let cachedDy = 0;
    let cachedDrawW = 0;
    let cachedDrawH = 0;
    let cachedW = 0;
    let cachedH = 0;
    let cachedFont = "";

    // Shine cadence: a highlight band sweeps over the portrait every
    // ~6 seconds, taking ~1.9s per sweep. Initial delay gives the
    // viewer a beat to read the static portrait first.
    const SHINE_DURATION_MS = 1900;
    const SHINE_GAP_MS = 6200;
    const SHINE_INITIAL_DELAY_MS = 1200;
    let shineStartAt = 0;
    let nextShineAt = 0;
    let shineInitialized = false;

    // Shine geometry — re-rolled each cycle so the glint can come from
    // any direction (L→R, R→L, top→bottom, any diagonal) rather than
    // always tracing the same path. Defaults match the previous fixed
    // direction so the first frame, before any cycle has fired, isn't
    // a discontinuity. shineMinProj/shineMaxProj cover the full canvas
    // for the current direction so the band fully enters and exits.
    let shineUx = 0.876;
    let shineUy = 0.482;
    let shineMinProj = 0;
    let shineMaxProj = 0;

    const startShine = (now: number) => {
      shineStartAt = now;
      // Step the angle by a large random rotation (between 120° and
      // 240°) from the previous direction. Pure-random angles can land
      // close to the prior sweep two cycles in a row and feel
      // repetitive; this guarantees each new sweep visibly comes from
      // a different side without scripting specific presets.
      const prevAngle = Math.atan2(shineUy, shineUx);
      const stepMin = (2 * Math.PI) / 3;
      const stepRange = (2 * Math.PI) / 3;
      const angle = prevAngle + stepMin + Math.random() * stepRange;
      shineUx = Math.cos(angle);
      shineUy = Math.sin(angle);
      // Project the four canvas corners onto the axis to find the
      // sweep range — the band needs to enter from one side and exit
      // the other regardless of which angle came out of the roll.
      const projs = [
        0,
        cachedDrawW * shineUx,
        cachedDrawH * shineUy,
        cachedDrawW * shineUx + cachedDrawH * shineUy,
      ];
      shineMinProj = Math.min(...projs);
      shineMaxProj = Math.max(...projs);
    };

    const rebuild = () => {
      const host = canvas.parentElement;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      // Pin the canvas's CSS box to the same integer pixel size as the
      // backing buffer (after dpr). Otherwise `h-full w-full` lets the
      // CSS size be whatever the parent rounds to, while the backing
      // buffer is sized from `rect.width * dpr` — any 0.x px mismatch
      // makes the browser resample on display = blur.
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cropX = image.naturalWidth * SOURCE_CROP.x;
      const cropY = image.naturalHeight * SOURCE_CROP.y;
      const cropW = image.naturalWidth * SOURCE_CROP.width;
      const cropH = image.naturalHeight * SOURCE_CROP.height;
      const cropAspect = cropW / cropH;

      const drawH = Math.min(height, width / cropAspect);
      const drawW = drawH * cropAspect;
      const dx = (width - drawW) / 2;
      const dy = height - drawH;

      const sampleW = 820;
      const sampleH = Math.round(sampleW / cropAspect);
      const sampler = document.createElement("canvas");
      sampler.width = sampleW;
      sampler.height = sampleH;
      const sampleCtx = sampler.getContext("2d", { willReadFrequently: true });
      if (!sampleCtx) return;
      sampleCtx.clearRect(0, 0, sampleW, sampleH);
      sampleCtx.drawImage(
        image,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        sampleW,
        sampleH,
      );
      const imageData = sampleCtx.getImageData(0, 0, sampleW, sampleH);
      cachedGlyphs = buildGlyphs(imageData, drawW, drawH);
      cachedDx = dx;
      cachedDy = dy;
      cachedDrawW = drawW;
      cachedDrawH = drawH;
      cachedW = width;
      cachedH = height;
      const fontSize = Math.max(4.6, Math.min(6.8, drawW / 138));
      cachedFont = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    };

    // shineT ∈ [0,1] sweeps a diagonal band of brightened glyphs across
    // the portrait; null = static baseline pass. The shine is computed
    // per-glyph and rendered into the same canvas — no overlay, no
    // filter, no shadowBlur, no parent transform — so the glyphs stay
    // crisp through the animation. It also "respects the silhouette"
    // for free: we only modulate cells that already have a glyph (the
    // background was never written), so the shine traces the bust
    // shape, not a rectangle.
    const drawFrame = (shineT: number | null) => {
      if (!ready) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cachedW, cachedH);
      ctx.save();
      ctx.translate(Math.round(cachedDx), Math.round(cachedDy));
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fontKerning = "none";
      ctx.font = cachedFont;
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;

      // Sweep the band along the axis (shineUx, shineUy) — direction is
      // re-rolled by startShine() each cycle. shineMinProj/MaxProj were
      // pre-computed from the four canvas corners so the band slides
      // fully across regardless of which angle was picked.
      let shineProj = -Infinity;
      let bandWidth = 0;
      if (shineT !== null) {
        bandWidth = cachedDrawW * 0.18;
        const sweepRange = shineMaxProj - shineMinProj + 2 * bandWidth;
        shineProj = shineMinProj - bandWidth + sweepRange * shineT;
      }

      for (const glyph of cachedGlyphs) {
        const a = glyph.alpha;
        const whiteShift = Math.max(0, (a - 0.3) / 0.7);
        let r = 232 + 23 * whiteShift;
        let g = 242 + 13 * whiteShift;
        const b = 255;
        let drawAlpha = a;

        if (shineT !== null) {
          const proj = glyph.x * shineUx + glyph.y * shineUy;
          const dist = Math.abs(proj - shineProj);
          if (dist < bandWidth) {
            const s = 1 - dist / bandWidth;
            const sEased = s * s * (3 - 2 * s);
            // Push the glyph toward pure white at the band center and
            // lift its alpha — gives the "mirror glint" feel without
            // changing which character is drawn (so it's not jittery).
            r += (255 - r) * sEased * 0.85;
            g += (255 - g) * sEased * 0.85;
            drawAlpha = Math.min(1, a + sEased * 0.32);
          }
        }

        ctx.fillStyle = `rgba(${Math.round(r)}, ${Math.round(g)}, ${b}, ${drawAlpha})`;
        ctx.fillText(glyph.char, snap(glyph.x), snap(glyph.y));
      }

      ctx.restore();
    };

    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      if (!ready) return;
      // Skip all canvas work while the portrait wrapper is faded out
      // (intro state). Cheap idle: one ref read per frame.
      if (!visibleRef.current) {
        // Reset the schedule so the first shine doesn't fire
        // immediately or mid-sweep on the next reveal.
        shineInitialized = false;
        return;
      }

      if (!shineInitialized) {
        shineInitialized = true;
        nextShineAt = now + SHINE_INITIAL_DELAY_MS;
        shineStartAt = 0;
      }

      if (shineStartAt === 0 && now >= nextShineAt) {
        // Roll a fresh direction for this cycle so the next glint comes
        // from a different side than the last one.
        startShine(now);
      }

      if (shineStartAt > 0) {
        const t = (now - shineStartAt) / SHINE_DURATION_MS;
        if (t < 1) {
          // Smooth ease-in-out — the highlight accelerates into and
          // out of view rather than crossing at constant speed.
          const eased = t * t * (3 - 2 * t);
          drawFrame(eased);
        } else {
          // Shine finished — paint the baseline once so the boosted
          // alpha doesn't get left as the last-drawn state.
          drawFrame(null);
          shineStartAt = 0;
          nextShineAt = now + SHINE_GAP_MS;
        }
      }
    };

    image.onload = () => {
      rebuild();
      ready = true;
      drawFrame(null);
      const host = canvas.parentElement;
      if (host) {
        resizeObserver = new ResizeObserver(() => {
          rebuild();
          drawFrame(null);
        });
        resizeObserver.observe(host);
      }
      rafId = requestAnimationFrame(tick);
    };
    image.src = "/OzzyRightSide.png";

    return () => {
      resizeObserver?.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div className={className} aria-hidden>
      <canvas ref={canvasRef} className="relative h-full w-full" />
    </div>
  );
}
