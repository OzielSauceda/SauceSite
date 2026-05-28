"use client";

import { useEffect, useRef } from "react";

const GLYPHS =
  "{}()[]<>/\\|=+-*&%$#@?:;.,!_01abcdefghiklmnoprstuvwxyz";

// Code-token stream used to populate each cell's resting character.
// Random sampling from GLYPHS produced too-even distribution of
// brackets/operators; the reference image looks like real source code
// because real code has more letters than brackets, semicolons at
// line ends, etc. Sampling from this stream preserves that natural
// distribution while still using the same character pool. Each row of
// the portrait reads a shifted slice of this stream so adjacent rows
// look like consecutive lines of source rather than random soup.
const CODE_STREAM =
  "const fn=(x,y)=>{let a=x*y;return a+1;};" +
  "if(a<b){for(i=0;i<n;i++){arr.push(i);}}" +
  "var obj={key:val,n:0};while(p){q.r(s);}" +
  "function map(arr,fn){return arr.reduce((acc,x)=>{acc.push(fn(x));return acc;},[]);}" +
  "class A{constructor(n){this.n=n;}get(){return this.n;}set(v){this.n=v;}}" +
  "export default A;import{x,y}from'./z';" +
  "async function foo(){await bar();}try{baz();}catch(e){log(e);}" +
  "let p=[1,2,3].map(n=>n*n).filter(n=>n>0);" +
  "switch(k){case 0:return a;case 1:return b;default:return c;}" +
  "const{a,b,c}=obj;const[x,...rest]=arr;void 0;null;true;false;" +
  "interface T{id:number;name:string;}type U=Partial<T>;enum E{A,B,C}";

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

// Detail sampling. Smaller area averages preserve thin facial features
// like eyelids, pupils, and the lip crease without changing the final
// color palette or glow treatment.
const DETAIL_GRID_COLUMNS = 150;
const DETAIL_SAMPLE_RADIUS_SCALE = 0.38;
const DETAIL_CONTRAST_MIN = 0.065;
const DETAIL_CONTRAST_RANGE = 0.14;

// Band-0 dropout, scaled by local contrast. Smooth dark zones (eye
// sockets, lip interior, mustache shadow body) drop nearly all
// glyphs so they read as real negative space — like the reference
// image, which defines features by *absence* of characters, not by
// dim ones. Sharp edges (eyelash line, lip boundary, nostril rim)
// keep most glyphs so features stay defined. The huge spread between
// these two values is what gives eyes/lips real definition.
const VOID_DROPOUT_SMOOTH = 0.95; // low-contrast → near-total void
const VOID_DROPOUT_EDGE = 0.18; // sharp edge → keep most chars

// Lit-side dark feature detection. The brightness curve places the
// lit-side eyebrow into mid bands because the light hitting it lifts
// its absolute brightness — but it's still meaningfully darker than
// the surrounding forehead skin, so it should read as a void feature.
// Without this, the lit eyebrow renders at skin-tone alpha and
// effectively disappears (the previous bug). We sample at two wider
// vertical offsets and take the brightest neighbor; if the cell is
// this much darker than that neighbor, we reclassify it into band 0
// so the existing void-dropout carves it out like the eyes/lips.
//
// Threshold must stay high enough that only strong dark features (the
// eyebrow vs lit forehead, delta ~0.3+) get reclassified to void. Lower
// values (0.18 caught it) also void the soft eyelid and under-eye
// shadows, which collapses brow+eye into a hollow socket and makes the
// eyes read as scary. 0.28 keeps the eyebrow but spares those soft
// shadows so the lit eyelid separation survives.
const WIDE_DARK_OFFSET_A_SCALE = 2.5;
const WIDE_DARK_OFFSET_B_SCALE = 4.5;
const WIDE_DARK_EDGE_THRESHOLD = 0.28;
// Upper band gate for the wide-dark void reclassification. The lit
// eyebrow sits in mid bands (light lifts it but it's still darker than
// forehead), so it must stay eligible. The lit upper eyelid between the
// brow and the eye is genuinely bright — but it's darker than the even
// brighter forehead above it, so without this gate the wide-dark check
// voided it too, fusing the brow into the eye with no lit gap (the eyes
// read as heavy/stern). Exempting bright cells keeps the eyelid as
// glyphs so the brow stays a thin band and the calm half-lidded
// separation from the reference survives.
const WIDE_DARK_BAND_CEILING = 4;

// Eye-region carve-out. The portrait renders dark features as the
// *absence* of glyphs — correct for brows, mustache, hair, nostrils.
// But this subject's eyes are dark and low-lidded, so that same rule
// turns them into pure-black holes that read as hollow/uncanny, while
// the reference photo still shows a visible eyeball, iris, and lit lid.
// This box (normalized 0–1 over the drawn face, tuned to
// OzzyRightSide.png) is the ONLY place that rule is relaxed: inside it
// we skip the lit-dark void reclassification and keep far more glyphs in
// the dark band, so the eyes gain dim internal structure instead of a
// void. Everything outside the box is rendered identically to before.
// DEBUG_FEATURE_REGIONS renders only the carve-out boxes to calibrate them.
const EYE_REGION = { x0: 0.4, x1: 0.71, y0: 0.35, y1: 0.45 };
// Mouth/mustache carve-out. Same problem as the eyes: the dark mustache +
// lip line collapse into one black mass, so the lit lower lip separation
// vanishes. Inside this box we relax the void rule and stretch local
// contrast so the lit lip lifts off the dark mustache. Box is kept ABOVE
// the chin so it doesn't disturb the chin/jaw contour. Tuned to
// OzzyRightSide.png.
const MOUTH_REGION = { x0: 0.41, x1: 0.67, y0: 0.5, y1: 0.61 };
const FEATURE_VOID_DROPOUT_SMOOTH = 0.45; // vs 0.95 outside — keep feature form
// Local contrast stretch inside the eye box. The eye's own brightness
// range (dark pupil/lash → bright sclera/catchlight) is narrow and sits
// in the low-mid range, so the global curve renders the whole eye as a
// flat dark patch and the white sclera vanishes. A pre-pass measures the
// eye's actual low/high brightness (robust percentiles, so a stray bright
// or dark pixel doesn't blow out the range) and the main pass stretches
// each eye cell across the full scale: the sclera/catchlight read bright
// and the pupil reads dark — the white-area-vs-pupil separation.
const EYE_STRETCH_LO_PCT = 0.18; // maps to dark (pupil) end
const EYE_STRETCH_HI_PCT = 0.9; // maps to bright (sclera) end
// Floor for the eye's dark end. Mapping the pupil/lash to ~0 made the eye
// a void again under the global tonal contrast (hollow sockets). Lifting
// the dark end keeps a dim-but-visible pupil while the sclera still reads
// bright, so the eye has form instead of a black hole.
const EYE_STRETCH_FLOOR = 0.14;
// Catchlight recovery. The tiny specular reflection in the eye is far
// brighter than the iris around it but gets averaged away. Where the peak
// brightness in an eye cell is high AND much brighter than the cell
// average (a specular spot, not flat-lit skin), we render that cell as a
// white spark — the highlight that makes an eye read as alive.
// OPTION 2 — sharper catchlight. Tighter thresholds so only the brightest,
// most-specular cells (the actual reflection) become sparks, instead of a
// diffuse spread of bright cells that read as no catchlight at all.
const EYE_CATCHLIGHT_PEAK = 0.62; // min peak luminance to count as specular
const EYE_CATCHLIGHT_CONTRAST = 0.28; // peak must exceed cell avg by this
const EYE_CATCHLIGHT_RADIUS_SCALE = 1.6;

// OPTION 1 — rim light on the shadow-side silhouette. Cells near the
// background boundary (edgeFade below this) get a brightness floor at draw
// time so the contour reads against black. The lit-side edge already
// exceeds the floor, so only the dark side is firmed up.
const RIM_EDGE_THRESHOLD = 0.6;
const RIM_MIN_ALPHA = 0.42;
const RIM_R = 92;
const RIM_G = 178;
const RIM_B = 236;
// Mouth dark end isn't lifted as far as the eyes — the mustache should
// stay genuinely dark; we only need the lit lip to lift off it.
const MOUTH_STRETCH_FLOOR = 0.08;
const DEBUG_FEATURE_REGIONS = false;

// Per-band glyph alpha. Indexed by the 8-band posterized brightness
// value. Wider gaps at the dark end (B1→B2, B2→B3) give dark midtone
// features like lips, nostrils, and nose-bridge separation from the
// surrounding mustache/eye shadow; tighter gaps at the top keep the
// lit-side block from fragmenting into stripes.
const BAND_ALPHAS = [0.18, 0.30, 0.48, 0.62, 0.71, 0.80, 0.88, 0.96];

// Color-saturation alpha boost. The luminance-only path collapses
// lips (red), irises (colored), and skin (tan) into similar bands
// whenever their brightness is similar — features visible to the eye
// in the source vanish in the portrait. This boost lifts the alpha
// of color-distinct pixels so red/colored features pop from neutral
// neighbors. Max boost is capped so the lit cheek doesn't over-glow.
const COLOR_SAT_REF = 0.25; // chroma value that hits max boost
const COLOR_SAT_BOOST = 0.15; // up to +15% alpha at max chroma

// Reference-style highlight texture. The source inspiration has bright
// white regions that stop reading as individual characters and become a
// dense woven code texture. Keep this as a second pass limited to the
// brightest cells so midtones stay clean and readable.
const MICROTEXT_FONT_SCALE = 0.46;
const MICROTEXT_ALPHA = 0.22;
const MICROTEXT_MIN_STRENGTH = 0.08;

// Sub-grid sampling for micro-text. Each highlight cell stores a 3×3
// grid of brightness deltas (relative to cell average). When rendering
// the micro-text mini-line, each char looks up the sub-cell it falls
// into and modulates its alpha — brighter sub-cells get more emphasis,
// darker sub-cells get dimmed. Result: features smaller than the main
// cell (eyelid edges, cheekbone falloff, brow-to-hair transition) get
// carried by the micro-text instead of being averaged away.
const SUB_GRID_SIZE = 3;
const SUB_GRID_ALPHA_MOD = 0.7; // ±70% alpha at max sub-contrast
const SUB_GRID_NORM_RANGE = 0.18; // brightness delta that hits ±1

type Glyph = {
  id: number;
  x: number;
  y: number;
  char: string;
  alpha: number;
  microStrength: number;
  // Eye catchlight: render this cell as a white spark (the specular
  // reflection in the eye). Set only for a few cells inside the eye box.
  catchlight?: boolean;
  // Silhouette-edge cell. Gets a brightness floor at draw time so the
  // outline stays defined on the shadow side instead of dissolving into
  // the black background. Only the dark side is affected (the lit edge is
  // already brighter than the floor).
  rim?: boolean;
  // Sub-grid brightness deltas (3×3 = 9 values, row-major), relative
  // to the cell average and normalized to roughly [-1, 1]. Only
  // populated for cells where micro-text will render — undefined for
  // the rest to save memory. Used by the micro-text pass to modulate
  // per-char alpha so features smaller than the main cell still read.
  subGrid?: Float32Array;
  // ms from reveal start at which this glyph first appears as
  // flickering noise. Before this it's not drawn at all (background
  // shows through), which is what produces the sparse-noise opening.
  spawnTime: number;
  // ms from reveal start at which this glyph stops flickering and
  // locks to its final character at full alpha. Brighter glyphs lock
  // earlier so the portrait resolves silhouette → highlights →
  // midtones → shadow detail.
  lockTime: number;
};

type Props = {
  className?: string;
  // Duration in ms over which the portrait performs its decode
  // reveal. Pass 0 (or omit) to render the final stable portrait on
  // the first frame — used for reduced-motion.
  revealMs?: number;
};

// Per-glyph flicker behavior during the reveal.
const REVEAL_START_DELAY_MS = 140; // lets the sparse decode frame register
const REVEAL_FLICKER_ALPHA = 0.5; // glyph dimming while still flickering
const REVEAL_LOCK_FADE_MS = 90; // alpha lerp from flicker → full once locked
const REVEAL_FLICKER_PERIOD_MS = 55; // how often each glyph rolls a new char
const REVEAL_SPAWN_SPREAD_MS = 320;

// Idle shimmer — once the entrance has settled, a small pool of
// glyphs visibly drifts off the portrait at constant velocity
// (zero-g space drift). Outgoing chars push radially outward from
// the bust centroid; incoming chars arrive from a random direction
// and travel inward to take the cell. A tiny perpendicular sine
// wobble gives each char a subtle "tumbling" quality so the motion
// doesn't read as a sterile straight line. Trajectory params are
// precomputed at each state transition; the drift pass evaluates
// them per-frame.
const SHIMMER_SLOT_COUNT = 8;
const SHIMMER_OUTGOING_MS = 1500;
const SHIMMER_INCOMING_MS = 1500;
const SHIMMER_GAP_MIN_MS = 1800;
const SHIMMER_GAP_RANGE_MS = 3500; // total gap: 1.8–5.3 s
const SHIMMER_DRIFT_FACTOR = 0.55; // drift distance = fraction of drawH
// Wobble amplitude (fraction of driftDistance) and frequency
// (cycles per phase duration). Kept small so the motion reads as
// "drifting" rather than "vibrating."
const SHIMMER_WOBBLE_AMP = 0.03;
const SHIMMER_WOBBLE_FREQ = 1.4;
const SHIMMER_START_AFTER_SETTLE_MS = 400;

// Post-decode glow. Once every band has locked we ramp into a
// Tron-style luminous state: glyphs are tinted toward white-hot
// cyan-white, their alpha is boosted, and TWO halo passes (tight +
// wide) are composited in 'lighter' mode so overlapping halos add
// up into real bloom. Bright cores additively clip to pure white,
// dim glyphs glow saturated cyan, exactly like Tron's edge lighting.
// All of this avoids ctx.shadowBlur and CSS filters, which the
// portrait crispness rules forbid.
const GLOW_RAMP_MS = 600;
// Two halo scales — the tight pass gives the inner-edge brightness,
// the wide pass gives the soft outer falloff that reads as bloom.
const GLOW_HALO_TIGHT_SCALE = 1.45;
const GLOW_HALO_WIDE_SCALE = 2.0;
// Halo alphas applied under 'lighter' compositing — they accumulate
// where halos overlap, so these can be much higher than ordinary
// blending without washing out.
const GLOW_HALO_TIGHT_ALPHA = 0.55;
const GLOW_HALO_WIDE_ALPHA = 0.3;
// Only genuinely lit glyphs bloom. At 0.2 nearly every glyph on the face
// cleared this, so overlapping halos summed across the dense field into a
// uniform bright floor (the shadow side got lit by its neighbors' glow) —
// the main cause of the flat "even sheet" look. Raising it concentrates
// bloom on the highlights, letting the shadow side fall dark.
const GLOW_HALO_MIN_ALPHA = 0.36; // skip halo for glyphs dimmer than this
// Main-glyph alpha gets boosted in the glow state so bright cores
// can additively clip to pure white through the halos. Tapered by
// brightness at draw time (see draw pass) so it lifts dim glyphs without
// clamping the whole lit range to a single flat 1.0 opacity.
const GLOW_ALPHA_BOOST = 1.45;
// Per-glyph color targets at glow=1, lerped against the current palette by
// the glow factor. Dim glyphs now land at a genuinely DARK deep cyan (not
// bright cyan) so luminance — not just opacity — carries the lit/shadow
// modeling; bright glyphs reach white-hot. All three channels ramp so
// shadows actually darken instead of staying pinned at full blue.
const GLOW_TINT_DIM_R = 66;
const GLOW_TINT_DIM_G = 146;
const GLOW_TINT_DIM_B = 198;
const GLOW_TINT_BRIGHT_R = 252;
const GLOW_TINT_BRIGHT_G = 253;
const GLOW_TINT_BRIGHT_B = 255;
// Halo colors — tight pass is brighter cyan (close to the glyph
// itself), wide pass is deeper blue (the outer falloff).
const GLOW_HALO_TIGHT_COLOR = "100, 210, 255";
const GLOW_HALO_WIDE_COLOR = "50, 170, 255";

// When a shine is sweeping, halos along the band swell — the wide
// halo more than the tight one so the outer bloom visibly bulges
// as the scanline passes, reading as "extra light dumped into the
// bloom" rather than just a per-glyph brightness twitch.
const SHINE_HALO_TIGHT_BOOST = 1.1;
const SHINE_HALO_WIDE_BOOST = 1.6;



function hash(n: number) {
  const x = Math.sin(n * 127.1) * 43758.5453123;
  return x - Math.floor(x);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// Tonal contrast. The sampling curve (pow 0.72) lifts shadows and the
// glow makes every glyph glow, which together flatten the face into a
// uniform cyan silhouette — the photo's lit-vs-shadow modeling is lost.
// This linear contrast around a pivot is applied to each glyph's
// band-alpha at draw time: lit areas push brighter, shadow areas recede
// toward black. Applied in both the bloom and main passes so shadow
// glyphs stop blooming too. Tuned empirically against OzzyRightSide.png.
const TONE_PIVOT = 0.52;
const TONE_GAIN = 1.32;
function toneContrast(a: number) {
  return clamp((a - TONE_PIVOT) * TONE_GAIN + TONE_PIVOT, 0, 1);
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

// Brightest single-pixel luminance within an area. Averaging blends a
// tiny specular highlight into its dark surroundings; in the eye region we
// use this to recover the catchlight (the small bright reflection in the
// eye) that the cell average loses.
function samplePeakBrightness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
) {
  let maxB = 0;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(height - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      const bb =
        (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
      if (bb > maxB) maxB = bb;
    }
  }
  return maxB;
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

function sampleLocalContrast(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  offset: number,
) {
  const samples = [
    sampleArea(data, width, height, cx, cy, radius).brightness,
    sampleArea(data, width, height, cx - offset, cy, radius).brightness,
    sampleArea(data, width, height, cx + offset, cy, radius).brightness,
    sampleArea(data, width, height, cx, cy - offset, radius).brightness,
    sampleArea(data, width, height, cx, cy + offset, radius).brightness,
  ];
  return Math.max(...samples) - Math.min(...samples);
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
  const cellW = Math.max(3.2, Math.min(4.6, targetWidth / DETAIL_GRID_COLUMNS));
  const cellH = cellW * 1.36;
  const sampleRadius = Math.max(0.75, cellW * scaleX * DETAIL_SAMPLE_RADIUS_SCALE);
  const detailOffset = Math.max(1, cellW * scaleX * 0.85);

  // Pre-pass: measure a feature box's own brightness range so the main
  // pass can stretch local contrast inside it (see EYE_STRETCH_*). Cheap —
  // buildGlyphs only runs on resize and each box is a small fraction of the
  // grid. Robust percentiles so a stray bright/dark pixel can't blow out
  // the range. Returns [lo, hi].
  const measureRange = (
    region: { x0: number; x1: number; y0: number; y1: number },
  ): [number, number] => {
    const bris: number[] = [];
    const rx0 = region.x0 * targetWidth;
    const rx1 = region.x1 * targetWidth;
    const ry0 = region.y0 * targetHeight;
    const ry1 = region.y1 * targetHeight;
    for (let y = cellH * 0.5; y < targetHeight; y += cellH) {
      if (y < ry0 || y > ry1) continue;
      for (let x = cellW * 0.5; x < targetWidth; x += cellW) {
        if (x < rx0 || x > rx1) continue;
        bris.push(
          sampleArea(data, width, height, x * scaleX, y * scaleY, sampleRadius)
            .brightness,
        );
      }
    }
    if (bris.length <= 4) return [0, 1];
    bris.sort((a, b) => a - b);
    const lo = bris[Math.floor(EYE_STRETCH_LO_PCT * (bris.length - 1))];
    let hi = bris[Math.floor(EYE_STRETCH_HI_PCT * (bris.length - 1))];
    if (hi - lo < 0.05) hi = lo + 0.05;
    return [lo, hi];
  };
  const [eyeLo, eyeHi] = measureRange(EYE_REGION);
  const [mouthLo, mouthHi] = measureRange(MOUTH_REGION);

  for (let y = cellH * 0.5; y < targetHeight; y += cellH) {
    for (let x = cellW * 0.5; x < targetWidth; x += cellW) {
      const sx = x * scaleX;
      const sy = y * scaleY;
      const pixel = sampleArea(data, width, height, sx, sy, sampleRadius);
      const localContrast = sampleLocalContrast(
        data,
        width,
        height,
        sx,
        sy,
        sampleRadius,
        detailOffset,
      );
      // Background pixels (the navy backdrop) get no glyph — this is what
      // gives the portrait its silhouette. The threshold is generous so
      // the vignette/gradient near the edges of the backdrop also gets
      // masked out, leaving only the subject.
      const distFromBg = colorDistance(pixel, bg);
      if (distFromBg < BG_COLOR_THRESHOLD) {
        id += 1;
        continue;
      }

      // Normalized cell position over the drawn face — used to test the
      // feature-region carve-outs so only the eyes/mouth get relaxed.
      const nx = x / targetWidth;
      const ny = y / targetHeight;
      const inEyeRegion =
        nx >= EYE_REGION.x0 &&
        nx <= EYE_REGION.x1 &&
        ny >= EYE_REGION.y0 &&
        ny <= EYE_REGION.y1;
      const inMouthRegion =
        nx >= MOUTH_REGION.x0 &&
        nx <= MOUTH_REGION.x1 &&
        ny >= MOUTH_REGION.y0 &&
        ny <= MOUTH_REGION.y1;
      const inFeatureRegion = inEyeRegion || inMouthRegion;

      // Calibration: render ONLY the feature boxes so placement is obvious.
      if (DEBUG_FEATURE_REGIONS && !inFeatureRegion) {
        id += 1;
        continue;
      }

      // Inside the eye box, stretch the cell across the eye's own measured
      // brightness range so the bright sclera separates from the dark pupil
      // instead of averaging into one flat patch. The dark end lands on a
      // floor (not 0) so the pupil stays dim-visible rather than a hollow
      // void; the bright end lands near the top of the global window.
      let isCatchlight = false;
      let effBrightness = pixel.brightness;
      if (inEyeRegion) {
        const eyeT = clamp((pixel.brightness - eyeLo) / (eyeHi - eyeLo), 0, 1);
        effBrightness = EYE_STRETCH_FLOOR + eyeT * (0.84 - EYE_STRETCH_FLOOR);
        // Recover the catchlight: a small specular peak much brighter than
        // the cell average. Force it bright so it renders as a white spark.
        const eyePeak = samplePeakBrightness(
          data,
          width,
          height,
          sx,
          sy,
          sampleRadius * EYE_CATCHLIGHT_RADIUS_SCALE,
        );
        if (
          eyePeak >= EYE_CATCHLIGHT_PEAK &&
          eyePeak - pixel.brightness >= EYE_CATCHLIGHT_CONTRAST
        ) {
          isCatchlight = true;
          effBrightness = 0.95;
        }
      } else if (inMouthRegion) {
        const mouthT = clamp(
          (pixel.brightness - mouthLo) / (mouthHi - mouthLo),
          0,
          1,
        );
        effBrightness =
          MOUTH_STRETCH_FLOOR + mouthT * (0.84 - MOUTH_STRETCH_FLOOR);
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
        Math.min(1, (effBrightness - 0.02) / 0.82),
      );
      const lit = Math.pow(stretched, 0.72);

      // Posterize into 8 value bands so the face has finer structure —
      // 6 bands flattened cheek/jaw into stripes; 8 preserves more of
      // the soft gradient that gives the reference its modelled look.
      const BANDS = 8;
      const band = Math.round(lit * (BANDS - 1));

      // Brightness-dependent dropout for band 0 (the darkest band).
      // The reference image defines features (eyes, lips, nostrils)
      // by *absence* of code, not by dim code. We now follow that:
      // smooth dark zones drop ~95% of glyphs → real negative space.
      // Sharp dark edges keep ~82% of glyphs → feature outlines stay
      // defined. localContrast picks which side a cell lands on; the
      // wide gap between the two dropouts is what carves recognizable
      // eye/lip shapes out of the dark mass.
      const detailProtection = clamp(
        (localContrast - DETAIL_CONTRAST_MIN) / DETAIL_CONTRAST_RANGE,
        0,
        1,
      );

      // Wide vertical sampling — catches lit-side dark features
      // (eyebrow, lash, lip line) that catch enough light to lift
      // into a mid band but still read as darker than surrounding
      // skin. The narrow localContrast above stops inside the feature
      // when its thickness exceeds detailOffset, which is why the
      // lit eyebrow used to render at skin alpha and vanish. Two
      // offsets at ~2.5× and ~4.5× detailOffset cover typical brow
      // and lash thicknesses; we take the brightest vertical
      // neighbor across both. If the cell is at least
      // WIDE_DARK_EDGE_THRESHOLD darker than that neighbor we
      // reclassify it into band 0 so the existing void-dropout
      // carves it out like the eyes and mustache.
      const wideOffA = detailOffset * WIDE_DARK_OFFSET_A_SCALE;
      const wideOffB = detailOffset * WIDE_DARK_OFFSET_B_SCALE;
      let widestNeighborBri = pixel.brightness;
      const wUpA = sampleArea(data, width, height, sx, sy - wideOffA, sampleRadius).brightness;
      const wDnA = sampleArea(data, width, height, sx, sy + wideOffA, sampleRadius).brightness;
      const wUpB = sampleArea(data, width, height, sx, sy - wideOffB, sampleRadius).brightness;
      const wDnB = sampleArea(data, width, height, sx, sy + wideOffB, sampleRadius).brightness;
      if (wUpA > widestNeighborBri) widestNeighborBri = wUpA;
      if (wDnA > widestNeighborBri) widestNeighborBri = wDnA;
      if (wUpB > widestNeighborBri) widestNeighborBri = wUpB;
      if (wDnB > widestNeighborBri) widestNeighborBri = wDnB;
      const wideDarkEdge = widestNeighborBri - pixel.brightness;
      // Inside a feature box we never force a cell into the void band — the
      // eyeball/lid and lit-lip mid-tones must survive so the feature reads.
      const isLitDarkFeature =
        !inFeatureRegion &&
        band > 0 &&
        band <= WIDE_DARK_BAND_CEILING &&
        wideDarkEdge > WIDE_DARK_EDGE_THRESHOLD;
      const workingBand = isLitDarkFeature ? 0 : band;

      // Feature cells use a much gentler void floor so the dark parts keep
      // dim glyphs instead of dropping out to pure black.
      const voidSmooth = inFeatureRegion
        ? FEATURE_VOID_DROPOUT_SMOOTH
        : VOID_DROPOUT_SMOOTH;
      const skipChance =
        workingBand === 0
          ? voidSmooth - (voidSmooth - VOID_DROPOUT_EDGE) * detailProtection
          : 0;
      if (
        !(DEBUG_FEATURE_REGIONS && inFeatureRegion) &&
        skipChance > 0 &&
        hash(id + 7.3) < skipChance
      ) {
        id += 1;
        continue;
      }

      // Feature-edge alpha boost. Band-0 cells with high local
      // contrast (eyebrow, mustache edge, eyelash) survived the
      // dropout because they're sharp edges — but they were still
      // drawing at band-0 alpha (0.18), too dim to read against
      // black. Bump their effective band so the feature is visible.
      // Threshold 0.5 means only genuinely high-contrast edges get
      // the boost; smooth dark mass stays at band-0 dimness.
      const effectiveBand =
        workingBand === 0 && detailProtection > 0.5 ? 2 : workingBand;

      // Edge of the silhouette: only softens glyphs whose pixel is right
      // at the background threshold so the outline doesn't read as a hard
      // rectangle. Keeps the interior of the face at full alpha.
      const edgeFade = clamp((distFromBg - BG_COLOR_THRESHOLD) / 0.10, 0, 1);
      // Silhouette-edge cell — gets a rim brightness floor at draw time so
      // the shadow-side contour doesn't dissolve into the background.
      const rim = edgeFade < RIM_EDGE_THRESHOLD;

      // Wider jitter (0.12 vs 0.08) so adjacent peak-band glyphs vary
      // more per-character — keeps the bright cheek/forehead patch
      // from reading as one flat block of identical glyphs.
      const jitter = (hash(id + 91.7) - 0.5) * 0.12;
      // Tuned per-band alpha. A linear bandT→alpha ramp gave only
      // ~0.11 alpha separation between adjacent dark bands, which
      // collapsed lips/nose-bridge into the surrounding mustache
      // shadow. This curve widens the gap at the dark end (band 1→2
      // jumps 0.18, band 2→3 jumps 0.14) so dark midtone features
      // read as distinct, while bright bands stay closely-packed so
      // the lit-side block doesn't fragment into stripes.
      //
      // Color-saturation boost: chroma = max(rgb) − min(rgb) measures
      // how far the pixel is from neutral gray. Lips are red but
      // similar in brightness to skin; without this boost they'd
      // share a band with surrounding skin and vanish. Bright glyphs
      // already near 1.0 get clamped by the final alpha cap, so the
      // boost only affects dark/midtone colored features.
      const chroma =
        Math.max(pixel.r, pixel.g, pixel.b) -
        Math.min(pixel.r, pixel.g, pixel.b);
      const colorBoost =
        1 + Math.min(1, chroma / COLOR_SAT_REF) * COLOR_SAT_BOOST;
      const alphaBase =
        (BAND_ALPHAS[effectiveBand] + jitter) *
        (0.88 + edgeFade * 0.12) *
        colorBoost;

      const finalAlpha =
        DEBUG_FEATURE_REGIONS && inFeatureRegion ? 1 : clamp(alphaBase, 0, 1);
      const microStrength =
        clamp((band - 4.7) / 2.3, 0, 1) *
        clamp((finalAlpha - 0.68) / 0.28, 0, 1);

      // Sub-grid sampling — only for cells the micro-text pass will
      // touch. Samples a 3×3 grid of source pixels inside the cell,
      // stores each as a brightness delta from the cell average. The
      // micro-text render reads these to modulate per-char alpha, so
      // sub-cell features like eyelid edges actually read instead of
      // getting averaged into the cell mean.
      let subGrid: Float32Array | undefined = undefined;
      if (microStrength >= MICROTEXT_MIN_STRENGTH) {
        subGrid = new Float32Array(SUB_GRID_SIZE * SUB_GRID_SIZE);
        const cellWInSource = cellW * scaleX;
        const cellHInSource = cellH * scaleY;
        const subRadius = Math.max(
          0.6,
          (cellWInSource / SUB_GRID_SIZE) * 0.45,
        );
        for (let sy_i = 0; sy_i < SUB_GRID_SIZE; sy_i++) {
          const tY = (sy_i + 0.5) / SUB_GRID_SIZE - 0.5;
          for (let sx_i = 0; sx_i < SUB_GRID_SIZE; sx_i++) {
            const tX = (sx_i + 0.5) / SUB_GRID_SIZE - 0.5;
            const subPixel = sampleArea(
              data,
              width,
              height,
              sx + tX * cellWInSource,
              sy + tY * cellHInSource,
              subRadius,
            );
            subGrid[sy_i * SUB_GRID_SIZE + sx_i] = clamp(
              (subPixel.brightness - pixel.brightness) / SUB_GRID_NORM_RANGE,
              -1,
              1,
            );
          }
        }
      }
      // Code-stream character: each row reads a shifted excerpt of
      // CODE_STREAM, so adjacent cells in a row read like sequential
      // characters of a line of source, and adjacent rows read like
      // consecutive lines. Gives the natural letter/symbol distribution
      // of real code instead of even-weighted random ASCII.
      const rowIdx = Math.round(y / cellH);
      const colIdx = Math.round(x / cellW);
      const rowShift = Math.floor(hash(rowIdx * 7.3 + 0.5) * CODE_STREAM.length);
      const charIdx = (rowShift + colIdx) % CODE_STREAM.length;

      // Lock-time band: brighter glyphs lock earlier so the reveal
      // resolves highlights first, then midtones, then shadow detail.
      // Jitter inside each band so an entire band doesn't snap in
      // unison — it ripples in.
      let lockTime: number;
      if (finalAlpha > 0.75) {
        lockTime = 260 + hash(id + 23.1) * 200; // ~260–460 ms (highlights)
      } else if (finalAlpha > 0.5) {
        lockTime = 460 + hash(id + 41.7) * 300; // ~460–760 ms (midtones)
      } else {
        lockTime = 760 + hash(id + 67.3) * 250; // ~760–1010 ms (shadow)
      }

      // Spawn time: ~30% of glyphs appear immediately as sparse
      // noise; the rest fade in over the first few hundred ms forming the
      // full silhouette before any band starts locking.
      const spawnRoll = hash(id + 13.9);
      const spawnTime =
        spawnRoll < 0.3 ? 0 : hash(id + 31.7) * REVEAL_SPAWN_SPREAD_MS;

      glyphs.push({
        id,
        x,
        y,
        char: CODE_STREAM[charIdx],
        alpha: finalAlpha,
        microStrength,
        subGrid,
        spawnTime,
        lockTime,
        catchlight: isCatchlight,
        rim,
      });

      id += 1;
    }
  }

  return { glyphs, cellW, cellH };
}

export function CodeMatterPortrait({
  className,
  revealMs = 0,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const revealMsRef = useRef(revealMs);

  // Keep the rAF loop reading the latest reveal duration without
  // re-running the main setup effect — rebuilding glyphs from the
  // source image on every prop change would be slow.
  useEffect(() => {
    revealMsRef.current = revealMs;
  }, [revealMs]);

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
    let cachedCellW = 0;
    let cachedCellH = 0;
    let cachedFont = "";
    let cachedHaloFontTight = "";
    let cachedHaloFontWide = "";
    let cachedMicroFont = "";
    let cachedMicroOffsetX = 0;
    let cachedMicroOffsetY = 0;

    // Shine cadence: a highlight band sweeps over the portrait every
    // ~6 seconds, taking ~1.9s per sweep. The very first shine is
    // scheduled to land just after the reveal completes when one is
    // running — that pulse becomes the "glint" beat in the decode
    // entrance instead of a separate later accent.
    const SHINE_DURATION_MS = 1900;
    const SHINE_GAP_MS = 6200;
    const SHINE_INITIAL_DELAY_MS_DEFAULT = 1200;
    const SHINE_AFTER_REVEAL_MS = 150;

    // Reveal clock. Set in image.onload so the reveal begins at the
    // first frame the canvas actually has something to paint.
    let revealStart = 0;
    let shineStartAt = 0;
    let nextShineAt = 0;
    let shineInitialized = false;

    // Idle shimmer slots. A slot picks a random glyph, drifts the
    // current character outward off the portrait, then drifts a new
    // character back in from the same off-canvas direction. After
    // the new char arrives the slot commits it permanently, waits a
    // randomized gap, and re-fires on a different glyph.
    // Initialization is deferred until after the decode + glow ramp
    // settle so the shimmer doesn't fight the entrance.
    type ShimmerState = "idle" | "outgoing" | "incoming";
    type ShimmerSlot = {
      state: ShimmerState;
      glyphIdx: number;
      startAt: number; // phase start
      endAt: number; // phase end (or, when idle, next-start time)
      oldChar: string;
      newChar: string;
      // Trajectory params, recomputed at every state transition.
      // Position relative to glyph cell at normalized phase time t:
      //   offX = offX0 + velX*t + perpDx*wobble(t)
      //   offY = offY0 + velY*t + perpDy*wobble(t)
      // where wobble(t) = wobbleAmp * sin(2π*WOBBLE_FREQ*t + wobblePhase)
      offX0: number;
      offY0: number;
      velX: number;
      velY: number;
      // Unit perpendicular to motion direction — the sine wobble
      // pushes the glyph this way for an organic "tumble."
      perpDx: number;
      perpDy: number;
      wobbleAmp: number; // pixel amplitude
      wobblePhase: number; // radians offset into the sine cycle
    };
    const shimmerSlots: ShimmerSlot[] = [];
    for (let i = 0; i < SHIMMER_SLOT_COUNT; i++) {
      shimmerSlots.push({
        state: "idle",
        glyphIdx: -1,
        startAt: 0,
        endAt: Number.POSITIVE_INFINITY, // gated until shimmerInitialized
        oldChar: "",
        newChar: "",
        offX0: 0,
        offY0: 0,
        velX: 0,
        velY: 0,
        perpDx: 0,
        perpDy: 0,
        wobbleAmp: 0,
        wobblePhase: 0,
      });
    }
    let shimmerInitialized = false;

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
      const built = buildGlyphs(imageData, drawW, drawH);
      cachedGlyphs = built.glyphs;
      cachedCellW = built.cellW;
      cachedCellH = built.cellH;
      cachedDx = dx;
      cachedDy = dy;
      cachedDrawW = drawW;
      cachedDrawH = drawH;
      cachedW = width;
      cachedH = height;
      const fontSize = Math.max(4.6, Math.min(6.8, drawW / 138));
      const fontStack =
        "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      cachedFont = `${fontSize}px ${fontStack}`;
      cachedHaloFontTight = `${fontSize * GLOW_HALO_TIGHT_SCALE}px ${fontStack}`;
      cachedHaloFontWide = `${fontSize * GLOW_HALO_WIDE_SCALE}px ${fontStack}`;
      cachedMicroFont = `${fontSize * MICROTEXT_FONT_SCALE}px ${fontStack}`;
      cachedMicroOffsetX = fontSize * 0.48;
      cachedMicroOffsetY = fontSize * 0.58;
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

      // Reveal state — when active, per-glyph spawn/lock timing
      // gates each glyph's character and alpha. Brighter bands lock
      // first; dim glyphs flicker through random chars until their
      // lock time arrives. Outside the reveal window everything
      // draws at its final stable state.
      const ms = revealMsRef.current;
      const now = performance.now();
      const sinceReveal =
        revealStart > 0 ? now - revealStart : Number.POSITIVE_INFINITY;
      const revealActive =
        ms > 0 && sinceReveal < ms + REVEAL_LOCK_FADE_MS;
      const flickerTick = Math.floor(now / REVEAL_FLICKER_PERIOD_MS);

      // Glow factor — ramps from 0 → 1 over GLOW_RAMP_MS once the
      // last band has locked. When the portrait is rendered without a
      // reveal (reduced motion / ms = 0), glow is at full from frame 1.
      let glow = 0;
      if (ms === 0) {
        glow = 1;
      } else if (revealStart > 0) {
        const decodeDoneAt = ms + REVEAL_LOCK_FADE_MS;
        if (sinceReveal >= decodeDoneAt) {
          const gt = Math.min(
            1,
            (sinceReveal - decodeDoneAt) / GLOW_RAMP_MS,
          );
          glow = gt * gt * (3 - 2 * gt);
        }
      }

      // Shimmer state — set of cell indices that are currently in
      // the outgoing/incoming animation. Their cell position is
      // skipped in the halo + main passes; a separate drift pass
      // below draws the moving char at its current offset.
      const shimmeringSet = new Set<number>();
      for (const slot of shimmerSlots) {
        if (slot.state === "outgoing" || slot.state === "incoming") {
          shimmeringSet.add(slot.glyphIdx);
        }
      }

      // Bloom passes — two larger halo passes drawn with 'lighter'
      // (additive) compositing so where halos overlap they actually
      // add up into real bloom, and where bright glyphs land on top
      // of bright halos the channels clip to pure white. Wide pass
      // is drawn first so the tight pass paints over its center and
      // delivers the brighter inner edge. Skipped while the reveal
      // is still flickering — unstable noise frames shouldn't grow a
      // halo.
      const glowBloomActive = glow > 0 && !revealActive;
      if (glowBloomActive) {
        ctx.globalCompositeOperation = "lighter";

        ctx.font = cachedHaloFontWide;
        const wideScale = GLOW_HALO_WIDE_ALPHA * glow;
        for (let i = 0; i < cachedGlyphs.length; i++) {
          if (shimmeringSet.has(i)) continue;
          const glyph = cachedGlyphs[i];
          const tonedAlpha = toneContrast(glyph.alpha);
          if (tonedAlpha < GLOW_HALO_MIN_ALPHA) continue;
          // Square the tone so bloom concentrates on the highlights and
          // falls off fast through the midtones — stops the dense field
          // from summing into a uniform bright floor.
          let a = tonedAlpha * tonedAlpha * wideScale;
          if (shineT !== null) {
            const proj = glyph.x * shineUx + glyph.y * shineUy;
            const dist = Math.abs(proj - shineProj);
            if (dist < bandWidth) {
              const s = 1 - dist / bandWidth;
              const sEased = s * s * (3 - 2 * s);
              a *= 1 + sEased * SHINE_HALO_WIDE_BOOST;
            }
          }
          ctx.fillStyle = `rgba(${GLOW_HALO_WIDE_COLOR}, ${a})`;
          ctx.fillText(glyph.char, snap(glyph.x), snap(glyph.y));
        }

        ctx.font = cachedHaloFontTight;
        const tightScale = GLOW_HALO_TIGHT_ALPHA * glow;
        for (let i = 0; i < cachedGlyphs.length; i++) {
          if (shimmeringSet.has(i)) continue;
          const glyph = cachedGlyphs[i];
          const tonedAlpha = toneContrast(glyph.alpha);
          if (tonedAlpha < GLOW_HALO_MIN_ALPHA) continue;
          let a = tonedAlpha * tonedAlpha * tightScale;
          if (shineT !== null) {
            const proj = glyph.x * shineUx + glyph.y * shineUy;
            const dist = Math.abs(proj - shineProj);
            if (dist < bandWidth) {
              const s = 1 - dist / bandWidth;
              const sEased = s * s * (3 - 2 * s);
              a *= 1 + sEased * SHINE_HALO_TIGHT_BOOST;
            }
          }
          ctx.fillStyle = `rgba(${GLOW_HALO_TIGHT_COLOR}, ${a})`;
          ctx.fillText(glyph.char, snap(glyph.x), snap(glyph.y));
        }

        ctx.font = cachedFont;
        // Main pass stays under 'lighter' so bright glyph cores
        // additively combine with the halos underneath instead of
        // overwriting them.
      }

      for (let i = 0; i < cachedGlyphs.length; i++) {
        const glyph = cachedGlyphs[i];
        let drawChar = glyph.char;
        let a = glyph.alpha;

        if (revealActive) {
          if (sinceReveal < glyph.spawnTime) {
            // Pre-spawn — leave this cell blank so the opening frame
            // reads as sparse noise rather than a full grid.
            continue;
          }
          if (sinceReveal < glyph.lockTime) {
            // Flicker phase: random character, alpha dimmed so the
            // unlocked glyphs sit visibly behind the locked ones.
            const pseudo = (glyph.id * 1009 + flickerTick * 31) >>> 0;
            drawChar = GLYPHS[pseudo % GLYPHS.length];
            a = glyph.alpha * REVEAL_FLICKER_ALPHA;
          } else if (
            sinceReveal <
            glyph.lockTime + REVEAL_LOCK_FADE_MS
          ) {
            // Lock-in fade: real character now, alpha lerps from
            // flicker-dim up to full so the snap doesn't pop.
            const t =
              (sinceReveal - glyph.lockTime) / REVEAL_LOCK_FADE_MS;
            a =
              glyph.alpha *
              (REVEAL_FLICKER_ALPHA + (1 - REVEAL_FLICKER_ALPHA) * t);
          }
        } else if (shimmeringSet.has(i)) {
          // Cell is mid-shimmer — the character has drifted out of
          // its slot and the drift pass below will draw it at its
          // current offset. Skip the at-cell draw so the bust shows
          // a transient gap where the swap is happening.
          continue;
        } else {
          // Tonal contrast on the stable display value: lit areas push
          // brighter, shadow areas recede toward black, restoring the
          // photo's light/shadow modeling. Skipped during the reveal
          // flicker, which sets its own transient dimming above.
          a = toneContrast(a);
        }

        const whiteShift = Math.max(0, (a - 0.3) / 0.7);
        let r = 232 + 23 * whiteShift;
        let g = 242 + 13 * whiteShift;
        let b = 255;
        let drawAlpha = a;

        if (glow > 0) {
          // Luminance travels with tone: shadow glyphs land at a deep dim
          // cyan, highlights reach white-hot. All three channels ramp so
          // shadows genuinely darken (alpha alone, over black and under
          // additive bloom, could not separate lit from shadow).
          const targetR =
            GLOW_TINT_DIM_R +
            (GLOW_TINT_BRIGHT_R - GLOW_TINT_DIM_R) * whiteShift;
          const targetG =
            GLOW_TINT_DIM_G +
            (GLOW_TINT_BRIGHT_G - GLOW_TINT_DIM_G) * whiteShift;
          const targetB =
            GLOW_TINT_DIM_B +
            (GLOW_TINT_BRIGHT_B - GLOW_TINT_DIM_B) * whiteShift;
          r = r + (targetR - r) * glow;
          g = g + (targetG - g) * glow;
          b = b + (targetB - b) * glow;
          // Taper the boost by brightness: dim glyphs still get the full
          // boost so they glow through the halos, but bright glyphs get
          // ~no boost so the lit range keeps distinct opacity instead of
          // every band clamping to a single flat 1.0.
          const boost =
            1 + (GLOW_ALPHA_BOOST - 1) * glow * (1 - whiteShift);
          drawAlpha = Math.min(1, drawAlpha * boost);
        }

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

        // Rim light (OPTION 1): keep the silhouette edge visible so the
        // shadow side doesn't dissolve into the black background. It's a
        // floor, so the already-bright lit-side edge is unaffected — only
        // the dark side is lifted into a faint defining rim.
        if (glyph.rim && !revealActive) {
          if (drawAlpha < RIM_MIN_ALPHA) drawAlpha = RIM_MIN_ALPHA;
          if (r < RIM_R) r = RIM_R;
          if (g < RIM_G) g = RIM_G;
          if (b < RIM_B) b = RIM_B;
        }

        // Catchlight spark: force pure white at full strength so the eye's
        // specular reflection reads as a bright point of life. Only a few
        // cells per eye carry this flag.
        if (glyph.catchlight && !revealActive) {
          r = 255;
          g = 255;
          b = 255;
          drawAlpha = Math.min(1, Math.max(drawAlpha, 0.95));
        }

        ctx.fillStyle = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${drawAlpha})`;
        ctx.fillText(drawChar, snap(glyph.x), snap(glyph.y));
      }

      // Highlight microtexture pass. The reference image's brightest
      // areas read as *tiny lines of code text* flowing across the
      // face — not scattered marks. Each bright cell renders a short
      // horizontal mini-line of consecutive characters from
      // CODE_STREAM, jittered vertically so different cells' lines
      // sit at slightly different heights (stacks of code rather than
      // a single grid row). This is the texture that makes the
      // reference look like dense code instead of a glyph mosaic.
      if (glowBloomActive) {
        ctx.font = cachedMicroFont;
        const microCharSpacing = cachedMicroOffsetX * 0.85;
        for (let i = 0; i < cachedGlyphs.length; i++) {
          if (shimmeringSet.has(i)) continue;
          const glyph = cachedGlyphs[i];
          const strength = glyph.microStrength * glow;
          if (strength < MICROTEXT_MIN_STRENGTH) continue;

          // Brighter cells get longer code lines. Range 2–5 chars.
          const lineChars = 2 + Math.floor(strength * 3);
          // Lines sit at cell center — no vertical jitter. Jitter
          // produced scribble-like staggered lines that fought the
          // reference's clean "stacked code rows" feel. Aligning to
          // cell center lets adjacent cells' lines flow horizontally
          // as if they were one continuous code line.
          const totalWidth = (lineChars - 1) * microCharSpacing;
          const startX = glyph.x - totalWidth / 2;
          const lineY = glyph.y;

          const streamStart = Math.floor(
            hash(glyph.id + 31.7) * CODE_STREAM.length,
          );
          const baseAlpha = MICROTEXT_ALPHA * strength;
          // Lines align to cell-center vertically, so all chars in a
          // line look up the middle sub-row of the 3×3 grid. We lose
          // vertical sub-grid variation but gain clean horizontal
          // alignment between adjacent cells' lines.
          const subRow = Math.floor(SUB_GRID_SIZE * 0.5);
          for (let m = 0; m < lineChars; m++) {
            const char =
              CODE_STREAM[(streamStart + m) % CODE_STREAM.length];
            const charX = startX + m * microCharSpacing;
            let charAlpha = baseAlpha;
            if (glyph.subGrid) {
              // Map char's horizontal offset from cell center to a
              // sub-column index. Clamped so chars that spill into
              // adjacent cells use the edge sub-cell.
              const dx = (charX - glyph.x) / cachedCellW;
              const subColT = clamp(0.5 + dx, 0, 0.999);
              const subCol = Math.floor(subColT * SUB_GRID_SIZE);
              const subDelta =
                glyph.subGrid[subRow * SUB_GRID_SIZE + subCol];
              charAlpha = clamp(
                baseAlpha * (1 + subDelta * SUB_GRID_ALPHA_MOD),
                0,
                1,
              );
            }
            ctx.fillStyle = `rgba(244, 253, 255, ${charAlpha})`;
            ctx.fillText(char, snap(charX), snap(lineY));
          }
        }
        ctx.font = cachedFont;
      }

      // Drift pass — chars that are currently mid-shimmer. Position
      // uses linear t (true gravity-affected motion: linear initial
      // velocity + quadratic gravity term). Alpha uses smoothstep
      // ease so the fade is gentle at the start/end rather than
      // popping. Same Tron palette as the main pass so the moving
      // char visually matches the rest of the bust.
      if (shimmeringSet.size > 0) {
        for (const slot of shimmerSlots) {
          if (slot.state !== "outgoing" && slot.state !== "incoming") {
            continue;
          }
          const glyph = cachedGlyphs[slot.glyphIdx];
          if (!glyph) continue;

          const elapsed = now - slot.startAt;
          const phaseDur =
            slot.state === "outgoing"
              ? SHIMMER_OUTGOING_MS
              : SHIMMER_INCOMING_MS;
          const t = Math.min(1, Math.max(0, elapsed / phaseDur));
          const tSmooth = t * t * (3 - 2 * t);

          let alphaFactor: number;
          let char: string;
          if (slot.state === "outgoing") {
            alphaFactor = 1 - tSmooth;
            char = slot.oldChar;
          } else {
            alphaFactor = tSmooth;
            char = slot.newChar;
          }

          let a = glyph.alpha * alphaFactor;
          const whiteShift = Math.max(0, (a - 0.3) / 0.7);
          let r = 232 + 23 * whiteShift;
          let gC = 242 + 13 * whiteShift;
          const b = 255;
          if (glow > 0) {
            const targetR =
              GLOW_TINT_DIM_R +
              (GLOW_TINT_BRIGHT_R - GLOW_TINT_DIM_R) * whiteShift;
            const targetG =
              GLOW_TINT_DIM_G +
              (GLOW_TINT_BRIGHT_G - GLOW_TINT_DIM_G) * whiteShift;
            r = r + (targetR - r) * glow;
            gC = gC + (targetG - gC) * glow;
            const boost = 1 + (GLOW_ALPHA_BOOST - 1) * glow;
            a = Math.min(1, a * boost);
          }

          // Parametric position: linear constant velocity (zero-g
          // space drift) plus a small perpendicular sine wobble for
          // an organic "tumbling" feel.
          const wobble =
            slot.wobbleAmp *
            Math.sin(
              t * Math.PI * 2 * SHIMMER_WOBBLE_FREQ + slot.wobblePhase,
            );
          const offX = slot.offX0 + slot.velX * t + slot.perpDx * wobble;
          const offY = slot.offY0 + slot.velY * t + slot.perpDy * wobble;
          ctx.fillStyle = `rgba(${Math.round(r)}, ${Math.round(gC)}, ${b}, ${a})`;
          ctx.fillText(
            char,
            snap(glyph.x + offX),
            snap(glyph.y + offY),
          );
        }
      }

      ctx.restore();
    };

    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      if (!ready) return;

      if (!shineInitialized) {
        shineInitialized = true;
        // When a reveal is running, the first shine lands just after
        // it completes so it reads as the entrance glint. Otherwise
        // it falls back to the default idle delay.
        const initialDelay =
          revealMsRef.current > 0
            ? revealMsRef.current + SHINE_AFTER_REVEAL_MS
            : SHINE_INITIAL_DELAY_MS_DEFAULT;
        nextShineAt = now + initialDelay;
        shineStartAt = 0;
      }

      if (shineStartAt === 0 && now >= nextShineAt) {
        // Roll a fresh direction for this cycle so the next glint comes
        // from a different side than the last one.
        startShine(now);
      }

      const ms = revealMsRef.current;
      const revealActive =
        ms > 0 &&
        revealStart > 0 &&
        now - revealStart < ms + REVEAL_LOCK_FADE_MS + 30;
      // Keep painting through the glow ramp so the bloom fades in
      // instead of popping on at full strength on whichever frame
      // the next shine happens to fire.
      const glowRampActive =
        ms > 0 &&
        revealStart > 0 &&
        now - revealStart >= ms + REVEAL_LOCK_FADE_MS &&
        now - revealStart <
          ms + REVEAL_LOCK_FADE_MS + GLOW_RAMP_MS + 30;

      // Initialize the shimmer once the entrance has settled. Each
      // slot gets a staggered first-start so they don't all fire on
      // the same frame.
      if (!shimmerInitialized && revealStart > 0) {
        const settleOffset =
          ms > 0 ? ms + REVEAL_LOCK_FADE_MS + GLOW_RAMP_MS : 0;
        if (
          now - revealStart >=
          settleOffset + SHIMMER_START_AFTER_SETTLE_MS
        ) {
          shimmerInitialized = true;
          for (let i = 0; i < shimmerSlots.length; i++) {
            shimmerSlots[i].endAt = now + i * 380;
          }
        }
      }

      // Shimmer lifecycle. Three-state machine per slot:
      //   idle     → outgoing: pick a glyph, snapshot its current
      //              char, pick a new one, compute drift direction
      //              outward from the portrait centroid.
      //   outgoing → incoming: the old char has drifted out; switch
      //              to the new char arriving from off-canvas.
      //   incoming → idle: commit the new char to glyph.char and
      //              schedule the next-fire time.
      let shimmerCommittedThisFrame = false;
      let anyShimmerActive = false;
      if (shimmerInitialized && cachedGlyphs.length > 0) {
        const cxDrift = cachedDrawW / 2;
        const cyDrift = cachedDrawH / 2;
        const dd = cachedDrawH * SHIMMER_DRIFT_FACTOR;
        const wAmp = SHIMMER_WOBBLE_AMP * dd;
        for (const slot of shimmerSlots) {
          if (slot.state === "outgoing") {
            if (now >= slot.endAt) {
              // outgoing → incoming. Char arrives from a random
              // direction (any angle in 2π), travels at constant
              // velocity to the cell, lands at t=1.
              const inAngle = Math.random() * Math.PI * 2;
              const inDx = Math.cos(inAngle);
              const inDy = Math.sin(inAngle);
              slot.offX0 = inDx * dd;
              slot.offY0 = inDy * dd;
              slot.velX = -inDx * dd;
              slot.velY = -inDy * dd;
              slot.perpDx = -inDy;
              slot.perpDy = inDx;
              slot.wobbleAmp = wAmp;
              slot.wobblePhase = Math.random() * Math.PI * 2;
              slot.state = "incoming";
              slot.startAt = now;
              slot.endAt = now + SHIMMER_INCOMING_MS;
            }
            anyShimmerActive = true;
          } else if (slot.state === "incoming") {
            if (now >= slot.endAt) {
              // Resize during shimmer can swap cachedGlyphs out from
              // under a slot — guard so we don't crash on commit.
              const target = cachedGlyphs[slot.glyphIdx];
              if (target) target.char = slot.newChar;
              slot.state = "idle";
              slot.endAt =
                now +
                SHIMMER_GAP_MIN_MS +
                Math.random() * SHIMMER_GAP_RANGE_MS;
              shimmerCommittedThisFrame = true;
            } else {
              anyShimmerActive = true;
            }
          } else if (now >= slot.endAt) {
            // idle → outgoing. Initial velocity points radially
            // outward from the portrait centroid; the char travels
            // at constant velocity (zero-g drift).
            const idx = Math.floor(
              Math.random() * cachedGlyphs.length,
            );
            slot.glyphIdx = idx;
            const g = cachedGlyphs[idx];
            slot.oldChar = g.char;
            let nc =
              GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
            if (nc === g.char) {
              nc = GLYPHS[(GLYPHS.indexOf(nc) + 1) % GLYPHS.length];
            }
            slot.newChar = nc;
            let dx = g.x - cxDrift;
            let dy = g.y - cyDrift;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 0.001) {
              dx = 0;
              dy = -1;
            } else {
              dx /= len;
              dy /= len;
            }
            slot.offX0 = 0;
            slot.offY0 = 0;
            slot.velX = dx * dd;
            slot.velY = dy * dd;
            slot.perpDx = -dy;
            slot.perpDy = dx;
            slot.wobbleAmp = wAmp;
            slot.wobblePhase = Math.random() * Math.PI * 2;
            slot.startAt = now;
            slot.endAt = now + SHIMMER_OUTGOING_MS;
            slot.state = "outgoing";
            anyShimmerActive = true;
          }
        }
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
      } else if (
        revealActive ||
        glowRampActive ||
        anyShimmerActive ||
        shimmerCommittedThisFrame
      ) {
        // Reveal mutates the displayed character every flicker tick
        // and ramps alpha during lock-in; the glow ramp lerps the
        // palette and halo alpha; the shimmer cycles a few glyphs
        // and commits new characters. Any of those means paint.
        drawFrame(null);
      }
    };

    image.onload = () => {
      rebuild();
      ready = true;
      // Start the reveal just after the first canvas paint so the
      // sparse decode frame is visible instead of racing by while the
      // image finishes loading. Reduced-motion still renders final
      // state immediately.
      revealStart =
        performance.now() +
        (revealMsRef.current > 0 ? REVEAL_START_DELAY_MS : 0);
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
