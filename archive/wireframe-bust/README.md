# Wireframe Bust (Archived)

A polished chrome-matcap rendering of a 3D bust scan that lived on the right
side of the hero from initial commit through `soften-wireframe-bust`. It
was retired because the GLB / matcap pipeline turned out to be more
maintenance than it was worth for a single hero accent. Everything needed
to put it back is here.

## Contents

| Path | Original location | Notes |
|------|------------------|-------|
| `wireframe-bust.tsx` | `src/components/wireframe-bust.tsx` | The component itself. |
| `models/oziel-bust.glb` | `public/models/oziel-bust.glb` | Decimated mesh actually loaded at runtime. |
| `models/oziel-bust.original.glb` | `public/models/oziel-bust.original.glb` | Untouched ~14 MB scan-grade source. |
| `scripts/decimate-bust.mjs` | `scripts/decimate-bust.mjs` | One-shot Node script that produces `oziel-bust.glb` from `oziel-bust.original.glb`. |
| `scripts/make_clean_wireframe_bust.py` | repo root | Blender script — strips the paid `ThreeDee` GLB down to a single clean wireframe-friendly mesh. |
| `scripts/blender/create_graph_bust.py` | `scripts/blender/create_graph_bust.py` | Earlier Blender exploration toward a node/edge "graph bust" variant. |

## How it was wired into the page

All wiring lived in `src/components/star-intro.tsx`. To restore:

### 1. Put the files back

```
archive/wireframe-bust/wireframe-bust.tsx                 -> src/components/wireframe-bust.tsx
archive/wireframe-bust/models/*.glb                       -> public/models/
archive/wireframe-bust/scripts/decimate-bust.mjs          -> scripts/decimate-bust.mjs
archive/wireframe-bust/scripts/create_graph_bust.py       -> scripts/blender/create_graph_bust.py
archive/wireframe-bust/scripts/make_clean_wireframe_bust.py -> repo root
```

### 2. Dynamic import at the top of `star-intro.tsx`

```tsx
// Client-only: WebGL + GLTFLoader must not SSR.
const WireframeBust = dynamic(
  () => import("@/components/wireframe-bust").then((m) => m.WireframeBust),
  { ssr: false },
);
```

### 3. Chunk warmup inside `StarIntro`

```tsx
// Warm the wireframe-bust JS chunk + three.js bits during the intro so
// by the time `nameSettled` flips and the dynamic <WireframeBust /> tries
// to load, the chunk is already in cache. Removes a chunk-fetch + parse
// spike from the moment the user clicks Skip.
useEffect(() => {
  void import("@/components/wireframe-bust");
}, []);
```

### 4. The hero-stage wrapper that actually rendered it

Sits **inside** the `heroStageStyle` artboard (the 1440x768 transform-scaled
stage), gated on `nameSettled`:

```tsx
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
```

The `550 x 690` box must stay in sync with `DESIGN_W / DESIGN_H` at the top
of `wireframe-bust.tsx` — that fixed framebuffer is the whole reason the
bust scales identically with the surrounding HTML via the artboard's
`transform: scale(heroStageScale)`.

### 5. `<link rel="preload">` in `src/app/layout.tsx`

```tsx
<head>
  {/* Preload the wireframe bust GLB so it's already in cache by the
      time the hero wireframe component mounts -- removes the network
      decode spike from the moment the user skips the intro. */}
  <link
    rel="preload"
    href="/models/oziel-bust.glb"
    as="fetch"
    type="model/gltf-binary"
    crossOrigin="anonymous"
  />
</head>
```

### 6. `FILE_MAP.md` references

The retired entries described:

- A `wireframe-bust.tsx` block under `## Components`.
- Under `## Public assets`: `models/ - GLB assets (e.g. oziel-bust.glb loaded by wireframe-bust.tsx)`.

## Knobs worth remembering

All in `wireframe-bust.tsx` (see top of file for the full set):

- `MODEL_PATH = "/models/oziel-bust.glb"`
- `ROTATION_SPEED = 0.18` — auto-rotation radians/sec around Y.
- `DRAG_SENSITIVITY = 0.008` — radians per pixel dragged.
- `DESIGN_W = 550`, `DESIGN_H = 690` — fixed framebuffer; must match the
  wrapper `<div>` size in `star-intro.tsx`.
- `makeChromeMatcap()` is what gives the bust its lit look without a real
  light rig. Re-tune the gradients there to change the surface mood.

## Why we moved on

Even with the matcap + idle-load + chunk-warmup tricks, the bust:

- Required a multi-stage GLB pipeline (Blender → decimate → ship).
- Behaved differently across screens until the responsive `refit()` work
  in commit `3b87b90` ("soften wireframe bust and reposition on hero").
- Made the right side of the hero feel heavier than the left.

If we come back to a 3D portrait, this is the proven starting point —
it works as-is.
