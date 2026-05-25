# File Map — TheSauceSite

Quick-reference index for every source file. Use this to jump straight to the file that owns a feature instead of grepping. Update this file whenever a new file is added, removed, or its responsibility changes meaningfully.

---

## Stack at a glance

- **Framework:** Next.js 16 (App Router, Turbopack) + React 19 + TypeScript (strict)
- **Styling:** Tailwind v4 (CSS-first, via `@tailwindcss/postcss`) + `tw-animate-css`
- **UI primitives:** shadcn ("base-nova" style) on top of `@base-ui/react`
- **Animation:** `motion` (Framer Motion v12)
- **3D:** `three` (raw WebGL renderer, no React-Three-Fiber) — used by Steezy in `star-intro.tsx` AND by the node spheres in `systems-diagram.tsx`
- **Path alias:** `@/*` → `./src/*`

---

## App shell (`src/app/`)

### `layout.tsx`
- Root HTML shell. Loads `Geist` from `next/font/google` as `--font-sans`, sets `<title>` metadata, applies global font/antialiasing.
- **Change here:** site-wide `<head>` metadata, global font, body-level classes.

### `page.tsx`  (`"use client"`)
- The home route. Mounts `<StarIntro />`, then once intro completes mounts `<SectionRail />` and the four placeholder `<section>` blocks (about / projects / research / contact).
- Listens for `window` event `"steezy:intro-done"` to flip `introDone` → mounts the rail.
- Tracks the section closest to viewport center via scroll/resize listeners → drives `activeId` for `<SectionRail />`.
- Owns `SECTION_TINTS` (per-section background gradient classes).
- **Change here:** section ordering inside the DOM, per-section tint, scroll-spy logic, what the rail receives.

### `globals.css`
- Tailwind v4 entry (`@import "tailwindcss"`), shadcn design tokens (light + `.dark`), `@theme inline` token bridge, base `border-border`/`bg-background` resets.
- Defines the `--rainbow-angle` custom property + `@keyframes rainbow-spin` + `.rainbow-ring` (conic-gradient masked ring).
- `html.intro-active { overflow: hidden }` — body scroll lock used by `star-intro.tsx` to block scrolling until the intro finishes.
- Site-wide SVG film-grain via `body::before` (data-URI noise filter).
- **Change here:** color tokens, scroll lock behavior, the film grain, the rainbow ring animation.

---

## Components (`src/components/`)

### `star-intro.tsx`  (`"use client"`)  — **THE big one (~1400 lines)**
The hero/intro experience. Owns the 3D star ("Steezy"), the name reveal, the tagline cycle, the goo→star morph, the click-flight, the skip path, and the background gradient blobs.

Key constants near the top:
- `NAME = "Ozıel Sauceda"` — uses dotless Turkish `ı` (U+0131); Steezy lands as the dot.
- `I_LETTER_INDEX = 2` — index of the dotless `ı` for dot-position math.
- `TAGLINE_ROLES` + `TAGLINE_CYCLE_MS` — the rotating role list under the name.
- `GOO_HOLD_MS`, `MORPH_MS`, `POST_MORPH_GRACE_MS` — morph timing.
- `FLIGHT_DURATION_MS`, `SPIN_TOTAL_DEG`, `FLIGHT_WAYPOINTS` — click-flight catmull-rom path + spin.
- `ANGULAR`, `LATITUDE`, `SIZE`, `STAR_OUTER`, `STAR_INNER`, `BULGE_*` — star geometry shape.
- `PINK / CYAN / YELLOW / VIOLET / OUTLINE` — local color palette (duplicated in `lib/sections.ts`).

Major internals:
- `starRadius()`, `gooRadius()`, `buildStarGeometry()`, `updateStarPositions()` — generate the morphing star mesh frame-by-frame.
- `makeEye(side)` — builds the left/right eye groups with sclera + multicolor iris stack + shine highlight.
- `StarCanvas` — Three.js renderer host. Owns scene/camera/lights, morph progress, eye reveal + blink + tracking, idle hover bob, rotation springs. Fires `onMorphDone` once morph + grace period complete.
- `StarIntro` (exported) — orchestrates everything:
  - Letter cascade state machine: `hidden` → `goo` → `formed`.
  - `useEffect` blocks handle: scroll lock, intro-done event, tagline cycling, Steezy's dot-landing flight, window resize re-snap, idle playful spins, the **skip** path (snap name to upper-left then run cascade), the **click** path (measure letter X positions then sweep through waypoints triggering letter formation), and tap handling.
  - Renders the four animated gradient blobs (pink/cyan/yellow/violet) as the background.
  - Renders `<SystemsDiagram visible={selectorMode} />` (lives in the same hero section).
  - Renders the Skip button (top-right) until `selectorMode`.
  - Renders the centered `<motion.div>` holding the `<h1>` name + tagline `<motion.p>` + the long descriptive copy block.
  - Renders Steezy (`StarCanvas` inside a draggable `motion.div`) at z-30 on top of everything.

**Change here:** anything intro-related — name spelling, tagline strings/cycle speed, morph timing, star shape/colors/eyes, flight path, skip behavior, gradient blobs, hero copy, Steezy's landing/idle behavior.

### `section-rail.tsx`  (`"use client"`)
- Floating section navigator. Desktop: vertical numbered list (`right-8 top-1/2`). Mobile (`md:hidden`): bottom-right pill button → animated dropdown menu (uses `AnimatePresence`).
- Reads `SECTIONS` from `@/lib/sections`. Receives `activeId` from `page.tsx` and highlights the matching item with a 28px indicator line + ink text color.
- Uses `scrollIntoView({ behavior: "smooth" })` for nav clicks (intentionally local — does not set global `scroll-behavior`).
- **Change here:** rail position, mobile menu, active-state styling. Section list itself lives in `lib/sections.ts`.

### `hero-node-portrait.tsx`  (`"use client"`)
- **Abstract identity mesh** — small node/edge SVG fragments scattered around the hero. NOT a portrait, NOT in a card, fully transparent. Exported as `HeroNodePortrait` for import-site compatibility; internally a composer over a list of `FRAGMENTS`.
- Wrapper is `absolute inset-0 z-0 overflow-hidden`, hidden below `sm`. Mounts when `visible` flips on (gated in `star-intro.tsx` by `nameSettled && !selectorMode`) and fades out cleanly via `AnimatePresence` once `selectorMode` takes over (so `SystemsDiagram` owns the field).
- Built-in fragments (`FRAGMENTS` array, top of file):
  - `hairArc` — upper-right whitespace, the strongest cluster.
  - `iStarCluster` — tiny scatter near where the dotless ı sits after the name settles. Sits behind Steezy (z-30).
  - `smileCurve` — gentle U lower-right of the title area, intensity ~0.55.
  - `contourUpper` / `contourLower` — short loose curves in the far-right background, intensity ~0.45–0.5.
- Each fragment carries its own `mask` (radial `SOFT_MASK` or `HORIZONTAL_MASK` linear) so its bounding box feathers into the page — no rectangle edges anywhere.
- Visual tokens (top of file): `NODE_R = 0.55`, `EDGE_STROKE = 0.18`, `NODE_OPACITY = 0.55`, `EDGE_OPACITY = 0.35`. Per-fragment `intensity` multiplies opacity.
- Edges are computed by `chainEdges(n, skipOne)` — only the first `chainFrac` (default 0.7) of each fragment's nodes get chained, so trailing nodes act as scattered texture. With `skipOne: true`, `i → i+2` edges add a denser local fabric.
- All fragments are right- or position-anchored away from the section rail's right-8 gutter (≥ 8vw from the right edge).
- Animation: per-cluster `delayBase` staggers the five fragments in sequence (0.5s → 1.35s). Within each cluster, nodes scale/fade in with a small per-index stagger; edges draw via `pathLength`.
- Accepts `visible: boolean` and optional `active?: boolean` (currently unused; kept on the type for future use).
- **Change here:** add/remove/retune entries in `FRAGMENTS`, tweak `NODE_R`/`EDGE_STROKE`/opacity tokens, swap `SOFT_MASK`/`HORIZONTAL_MASK` per cluster.

### `systems-diagram.tsx`  (`"use client"`)
- Decorative animated systems graph that fades in once the intro reaches `selectorMode` (rendered by `star-intro.tsx`, not page.tsx).
- Hub node "Interfaces" + 5 primary nodes (Research, Design, AI, Prototypes, Experiments) + 2 secondary (Computer Science, Systems).
- **Two-phase animation:**
  1. **Constellation** (0–3.7s): the 8 labeled spheres launch from the hub into their `(x, y)` constellation positions, hand-authored `EDGES` fade in, hub-centered FX (halo, sonar pings, release flash) play.
  2. **Portrait morph** (4.4–7.0s): the labeled spheres migrate to face-landmark points in `PORTRAIT_ANCHORS` (imported from `@/lib/oziel-portrait-points`) and shrink (`NODE_RADIUS_PORTRAIT`); ~170 small WebGL micro-spheres (`PORTRAIT_MICRO`, feature-grouped in the lib) fade in at deterministic `scatterFor(i)` positions and converge to the silhouette; constellation edges + labels + hub FX fade out; the `PORTRAIT_EDGES` set fades in. Final state is a connected node/edge portrait that suggests Oziel's hair, brows, eyes, nose, mustache, smile, goatee, jaw, neck, and shoulders without showing the raw photo.
- **`PORTRAIT_EDGES` = feature chains + supplemental NN.** Computed once at module load: take every `PORTRAIT_FEATURE_EDGES` entry (chain edges that trace each feature in order), offset by `NODES.length` since labeled anchors come first in the combined `PORTRAIT_POINTS`, then add a sparse K=1 nearest-neighbor pass to stitch the chains together. Dedup via key set.
- **Debug overlay.** `SHOW_PORTRAIT_REFERENCE` constant at the top of the file (default `false`) — when `true`, renders `/oziel-portrait.jpeg` (copied from `Oziel.jpeg` to `public/`) at exactly the `PORTRAIT_BBOX` viewport region with `mix-blend-mode: multiply` and `opacity: 0.4`, so each portrait point can be visually nudged onto its actual facial feature. **Must be `false` in production.**
- Timing constants at the top: `MORPH_START_SEC = 4.4`, `MORPH_DURATION_SEC = 2.6`. The `Oziel.jpeg` source image itself is never loaded by the page in production — only the distilled coordinates are.
- **Three layered systems share one projected coordinate space:**
  1. **WebGL spheres** (the visible nodes) — `THREE.SphereGeometry` + `MeshPhysicalMaterial` (clearcoat-glossed charcoal) in a canvas behind everything. Group is rotated in Three.js to match the CSS sway.
  2. **CSS-rotated wrapper** (hub-only FX) — hosts only hub-centered effects (halo, sonar pings, release ping/echo, hub flash, micro nodes). Edges and labels are NOT in here — they used to be, which caused labels to flip/mirror at steep rotations.
  3. **Screen-space overlay** (edges + labels) — never rotated. Each frame, the WebGL tick projects every sphere's world position to screen pixels and pushes those positions into (a) the SVG `<line>` endpoints (via `edgeLineRefs`, shortened by `NODE_RADIUS[kind] + EDGE_GAP` so wires stop at the sphere surface) and (b) the label wrapper `transform: translate3d(...)` (via `labelWrapperRefs`). Labels stay upright; edges glue to the actual sphere positions at any rotation.
- **One source of truth for arrival progress.** Every `SphereItem` carries a `progress` field updated each tick (0 = at hub, 1 = arrived). That single value drives sphere opacity, sphere position lerp, label-text opacity (`labelTextRefs`, gated `smoothstep(0.82, 0.95, p)` × hover-dim), hit-area pointer-events (`labelButtonRefs`, enabled when `p > 0.9`), and edge visibility (`smoothstep(0.88, 1, pA) × smoothstep(0.88, 1, pB)` × hover-modulated base opacity). Edges are plain `<line>` elements — no Framer animation that could drift from the sphere positions.
- The WebGL camera distance is set to `CSS_PERSPECTIVE = 1200` and the FOV is derived from canvas height so its perspective projection matches the CSS `perspective: 1200px` on the rotating wrapper exactly. Single source of truth for sphere radii is `NODE_RADIUS` (used by both the WebGL geometry and the edge-shortening math).
- Label position per node = `labelAnchor: { side: "left"|"right"|"top"|"bottom"; dx; dy }` (pixel offsets from the sphere center). `labelInnerStyle()` at the bottom of the file maps `side` → the appropriate `translate(...)` so labels sit clear of wiring.
- Choreographed startup: 3s hub charge with sonar pings → release ping → outer nodes launch outward from hub (sphere `position` lerped via ease-out in the WebGL tick) → edges fade in → micro-nodes settle. Sphere opacity ramps over each node's `delay + 0.7s` window.
- Hover dims unrelated nodes/edges; hovered sphere lerps body color from charcoal toward the node's accent and scales up ~1.18×. Hover hit-area is a transparent circular button inside each label wrapper, sized to sphere radius + a hover ring — moves with the sphere because the wrapper is driven by the same projection.
- Autonomous rotation sways around `baseRef.current` (updated on drag release) so the diagram keeps whatever angle the user left it at. Grab + drag to manually rotate (cursor: grab).
- `NODES`, `EDGES`, `NODE_RADIUS`, `SONAR_PINGS`, `RELEASE_PING`, `MICRO_NODES` are all hand-tuned constants at the top.
- Hidden below `lg` breakpoint (`hidden lg:block`).
- **Change here:** node/edge topology, label anchors (per-node `labelAnchor`), sphere radii (`NODE_RADIUS`), sphere material (roughness/metalness/clearcoat in the WebGL `useEffect`), lighting rig, hover behavior, sway baseline/amplitude, drag sensitivity (`* 0.4` in `onPointerMove`), edge gap-to-sphere (`EDGE_GAP` constant inside the tick).

### `hero.tsx`  (`"use client"`)
- **⚠ Currently unused** — `page.tsx` mounts `<StarIntro />` instead. Kept as a simpler alternative: a magnetic-letters name treatment ("Oziel Sauceda") where each letter is pulled toward the cursor via Framer Motion springs.
- `MagneticLetter` sub-component handles per-letter pointer math (`MAGNET_RADIUS=220`, `MAGNET_STRENGTH=36`).
- **Change here only if** swapping back to a non-3D hero, or salvage the magnetic-letters effect for elsewhere.

### `ui/button.tsx`
- shadcn-style `Button` wrapping `@base-ui/react/button`, with `cva` variants (`default`, `outline`, `secondary`, `ghost`, `destructive`, `link`) and sizes (`default`, `xs`, `sm`, `lg`, `icon`, `icon-xs`, `icon-sm`, `icon-lg`).
- **Change here:** button visual variants/sizes. Currently not imported anywhere in the app — kept for future shadcn-style components.

---

## Library (`src/lib/`)

### `sections.ts`
- Exports color constants (`PINK`, `CYAN`, `YELLOW`, `VIOLET`) and the `SECTIONS` array (id + label + accent) consumed by `page.tsx` and `section-rail.tsx`.
- **Single source of truth for section ordering, IDs, and labels.** Add/remove a section here and both the DOM sections and the rail update together.
- Note: the same hex colors are re-declared inside `star-intro.tsx` and `systems-diagram.tsx`. If you change a color here, check those too.

### `oziel-portrait-points.ts`
- Hand-traced portrait coordinates derived from `public/oziel-portrait.jpeg` (a copy of `Oziel.jpeg` at the repo root). Used exclusively by `systems-diagram.tsx` for the portrait-morph phase.
- Exports:
  - `PORTRAIT_ANCHORS` — map of labeled `AnchorNodeId` → `(x, y)` landmark inside the face (hub → nose tip, eye-named nodes → eyes, etc.).
  - Per-feature point arrays: `hairOutline`, `hairline`, `hairInterior`, `faceOutline`, `browLeft`, `browRight`, `eyeLeft`, `eyeRight`, `nose`, `mustacheTop`, `mustacheBottom`, `mustacheBody`, `smileTeeth`, `lowerLip`, `goatee`, `neckLeft`, `neckRight`, `shoulderLeft`, `shoulderRight`, `shirt`. Each is hand-ordered along its silhouette so adjacent indices are adjacent on the feature.
  - `PORTRAIT_MICRO` — flat concatenation of every feature in order.
  - `PORTRAIT_FEATURE_EDGES` — ordered chain edges (one between each consecutive pair in each chained feature), indexed into `PORTRAIT_MICRO`. Unordered features (`hairInterior`, `mustacheBody`, `shirt`) are skipped — they get only the supplemental NN pass in the consumer.
  - `PORTRAIT_BBOX` — `{minX, maxX, minY, maxY}` of `PORTRAIT_MICRO`, used by the debug overlay to position the reference photo at exactly the same viewport region.
- **Change here:** anything portrait-related — add/remove/nudge any feature, retune anchor landmarks. To verify alignment against the photo, flip `SHOW_PORTRAIT_REFERENCE = true` at the top of `systems-diagram.tsx`.

### `utils.ts`
- Standard shadcn `cn(...)` helper — `clsx` + `tailwind-merge`. Used wherever Tailwind classes are conditionally composed.

---

## Public assets (`public/`)

- `oziel-portrait.jpeg` — debug-only reference photo for `systems-diagram.tsx` (see that file's `SHOW_PORTRAIT_REFERENCE`).
- `models/` — GLB assets (e.g. `oziel-bust.glb` loaded by `wireframe-bust.tsx`).

## Repo-root assets / config

- `GraduationBear.jpg`, `ReferenceStar.webp` — loose reference images at the repo root (not in `public/`, so not served).
- `prompt.md` — design prompt / brief.
- `next.config.ts` — Next.js config; only sets `turbopack.root` to the project dir.
- `next-env.d.ts` — Next-generated TS ambient types (don't edit).
- `tsconfig.json` — strict TS, `@/* → ./src/*` path alias, JSX `react-jsx`.
- `eslint.config.mjs` — ESLint flat config (extends `eslint-config-next`).
- `postcss.config.mjs` — Tailwind v4 PostCSS plugin.
- `components.json` — shadcn config (`base-nova` style, `neutral` base color, aliases to `@/components`, `@/lib`, etc.).
- `package.json` — scripts: `dev` (turbopack), `build`, `start`, `lint`, `typecheck`, `format`, `format:check`.
- `tsconfig.tsbuildinfo` — TS incremental build cache (auto-generated, do not edit).

---

## Quick "where do I change…" lookup

| I want to change… | Open this file |
|---|---|
| Site `<title>` / metadata / global font | `src/app/layout.tsx` |
| Page background tints per section | `src/app/page.tsx` (`SECTION_TINTS`) |
| Scroll-spy / which section is "active" | `src/app/page.tsx` (the `update()` effect) |
| Section list (names, IDs, order, accent) | `src/lib/sections.ts` |
| Color tokens, dark mode, film grain, rainbow ring | `src/app/globals.css` |
| The 3D star (Steezy) shape, eyes, morph, flight | `src/components/star-intro.tsx` |
| Name spelling, tagline roles, hero copy | `src/components/star-intro.tsx` (top constants + JSX near bottom) |
| Skip button look/position | `src/components/star-intro.tsx` (Skip `<button>`) |
| Background gradient blobs | `src/components/star-intro.tsx` (the four `motion.div`s inside the blob wrapper) |
| Systems diagram nodes/edges/animation | `src/components/systems-diagram.tsx` |
| Section navigation rail (desktop + mobile) | `src/components/section-rail.tsx` |
| shadcn Button variants | `src/components/ui/button.tsx` |
| Tailwind / PostCSS config | `postcss.config.mjs` (Tailwind v4 is config-less; tokens live in `globals.css`) |
| Path alias `@/*` | `tsconfig.json` |

---

## Cross-file concerns to remember

- **`steezy:intro-done` event** — dispatched by `star-intro.tsx` once `selectorMode` is true; listened to in `page.tsx` to mount the rail. If you rename the event, update both places.
- **`html.intro-active` class** — added by `star-intro.tsx` and styled by `globals.css` to lock scroll. Touching either side means touching both.
- **Color hexes are duplicated** in `lib/sections.ts`, `star-intro.tsx`, and `systems-diagram.tsx`. Consolidate cautiously — each file uses slightly different yellows (`#ffd131` vs `#eab308`).
- **`SECTIONS`** is the canonical section list. The DOM `<section>` blocks in `page.tsx` and the rail items both derive from it.
