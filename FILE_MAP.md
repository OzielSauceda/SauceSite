# File Map — TheSauceSite

Quick-reference index for every source file. Use this to jump straight to the file that owns a feature instead of grepping. Update this file whenever a new file is added, removed, or its responsibility changes meaningfully.

---

## Stack at a glance

- **Framework:** Next.js 16 (App Router, Turbopack) + React 19 + TypeScript (strict)
- **Styling:** Tailwind v4 (CSS-first, via `@tailwindcss/postcss`) + `tw-animate-css`
- **UI primitives:** shadcn ("base-nova" style) on top of `@base-ui/react`
- **Animation:** `motion` (Framer Motion v12)
- **3D:** `three` available but not currently mounted by any source file (was used by the retired Steezy intro / wireframe bust).
- **Path alias:** `@/*` → `./src/*`

---

## App shell (`src/app/`)

### `layout.tsx`
- Root HTML shell. Loads `Geist` from `next/font/google` as `--font-sans`, sets `<title>` metadata, applies global font/antialiasing.
- **Change here:** site-wide `<head>` metadata, global font, body-level classes.

### `page.tsx`  (`"use client"`)
- The home route. Renders an empty intro `<section id="intro">` placeholder (the previous Steezy/StarIntro hero was removed; the next startup screen will mount here), then `<SectionRail />` and the four placeholder `<section>` blocks (about / projects / research / contact).
- Tracks the section closest to viewport center via scroll/resize listeners → drives `activeId` for `<SectionRail />`.
- Owns `SECTION_TINTS` (per-section background gradient classes).
- **Change here:** the intro placeholder, section ordering inside the DOM, per-section tint, scroll-spy logic, what the rail receives.

### `globals.css`
- Tailwind v4 entry (`@import "tailwindcss"`), shadcn design tokens (light + `.dark`), `@theme inline` token bridge, base `border-border`/`bg-background` resets.
- Defines the `--rainbow-angle` custom property + `@keyframes rainbow-spin` + `.rainbow-ring` (conic-gradient masked ring).
- Site-wide SVG film-grain via `body::before` (data-URI noise filter).
- **Change here:** color tokens, the film grain, the rainbow ring animation.

---

## Components (`src/components/`)

### `section-rail.tsx`  (`"use client"`)
- Floating section navigator. Desktop: vertical numbered list (`right-8 top-1/2`). Mobile (`md:hidden`): bottom-right pill button → animated dropdown menu (uses `AnimatePresence`).
- Reads `SECTIONS` from `@/lib/sections`. Receives `activeId` from `page.tsx` and highlights the matching item with a 28px indicator line + ink text color.
- Uses `scrollIntoView({ behavior: "smooth" })` for nav clicks (intentionally local — does not set global `scroll-behavior`).
- **Change here:** rail position, mobile menu, active-state styling. Section list itself lives in `lib/sections.ts`.

---

## Library (`src/lib/`)

### `sections.ts`
- Exports color constants (`PINK`, `CYAN`, `YELLOW`, `VIOLET`) and the `SECTIONS` array (id + label + accent) consumed by `page.tsx` and `section-rail.tsx`.
- **Single source of truth for section ordering, IDs, and labels.** Add/remove a section here and both the DOM sections and the rail update together.

### `utils.ts`
- Standard shadcn `cn(...)` helper — `clsx` + `tailwind-merge`. Used wherever Tailwind classes are conditionally composed.

---

## Public assets (`public/`)

- `OzzyRightSide.png`, `Oziel.png`, `OzzyLeftSide.png` — source studio shots; kept for future portrait passes, not currently loaded at runtime.
- `oziel-portrait.jpeg` — reference photo previously used by the retired systems-diagram debug overlay.
- `referenceImageCodeGlyph.jpg` — design reference for the retired code-glyph portrait aesthetic; not loaded at runtime.

## Archive (`archive/`)

- `wireframe-bust/` — retired hero accent. The Three.js + GLB chrome-bust that used to occupy the right side of the hero, plus its decimation/Blender pipeline. Re-mount instructions live in `archive/wireframe-bust/README.md`.

## Repo-root config

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
| The intro / startup screen | `src/app/page.tsx` (empty `<section id="intro">` placeholder for now) |
| Section list (names, IDs, order, accent) | `src/lib/sections.ts` |
| Color tokens, dark mode, film grain, rainbow ring | `src/app/globals.css` |
| Section navigation rail (desktop + mobile) | `src/components/section-rail.tsx` |
| Tailwind / PostCSS config | `postcss.config.mjs` (Tailwind v4 is config-less; tokens live in `globals.css`) |
| Path alias `@/*` | `tsconfig.json` |

---

## Cross-file concerns to remember

- **`SECTIONS`** is the canonical section list. The DOM `<section>` blocks in `page.tsx` and the rail items both derive from it.
