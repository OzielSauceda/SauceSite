"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CodeMatterPortrait } from "@/components/code-matter-portrait";

const NAME = "Oziel Sauceda";
const TAGLINE_PREFIX = "designer & engineer · ";
const TAGLINE_ROLES = [
  "full-stack developer",
  "systems builder",
  "technical researcher",
  "product-minded developer",
];
const TAGLINE_CYCLE_MS = 3500;

// Entrance choreography. The portrait owns the signature moment —
// glyphs spawn sparse, flicker, then lock band-by-band into the final
// readable bust over PORTRAIT_REVEAL_MS. The name speaks the same
// language: it decodes from scrambling code-glyphs and locks
// letter-by-letter left→right, timed so the last letter resolves the
// beat the portrait finishes locking. The tagline follows.
const PORTRAIT_REVEAL_MS = 1000;
const NAME_FADE = { duration: 0.35 };
// The tagline container fades in just before its decode begins resolving
// (TAGLINE_DECODE.startDelayMs ≈ 0.95s) so the scramble is visible as it
// locks, rather than the line popping in already-resolved.
const TAGLINE_ENTRANCE = { delay: 0.8, duration: 0.4 };

// Decode reveal for the name. Each non-space character scrambles through
// the glyph pool, then over a short settle window before its lock time
// (startDelayMs + index·staggerMs) the odds of landing on the true letter
// ramp 0→1, so it flickers into place instead of snapping. settleMs (170)
// is wider than staggerMs (60), so 2-3 adjacent letters resolve at once —
// that overlap is what keeps the wave from reading as a stiff, one-at-a-
// time typewriter. Last letter lands ~1s — the moment the portrait's
// decode completes.
const DECODE = { startDelayMs: 250, staggerMs: 60, tickMs: 30, settleMs: 170 };
// Tagline decode. Same mechanic as the name but lighter and held back:
// startDelayMs (~950) keeps it scrambling until the name has finished
// locking (~1s), then it resolves with a tighter stagger so the whole
// line lands by ~1.5s instead of dragging. It echoes the name's reveal
// so the tagline "assembles" out of code-glyphs rather than fading in.
const TAGLINE_DECODE = {
  startDelayMs: 950,
  staggerMs: 26,
  tickMs: 30,
  settleMs: 120,
};
// The cycling role decodes too. On first load it picks up exactly where
// the prefix leaves off — the prefix's 22 chars at staggerMs 26 lock the
// last one at ~1496ms, so the role's first char starts one step later
// (~1520ms) with the same stagger. The result is one continuous decode
// wave sweeping left→right across the whole line, not two overlapping
// reveals. On every later word switch it re-decodes from scramble with
// almost no hold.
const ROLE_FIRST_DECODE = {
  startDelayMs: 1520,
  staggerMs: 26,
  tickMs: 30,
  settleMs: 120,
};
const ROLE_DECODE = {
  startDelayMs: 40,
  staggerMs: 30,
  tickMs: 30,
  settleMs: 110,
};
// Neon sweep. As the decode front passes each character a bright bloom rides
// along with it, peaking at lock. Afterwards prefix glyphs fade back to
// neutral grey, while role glyphs keep their colour and ease down to a steady
// resting glow that holds. The hue keeps drifting after lock, so the palette
// — a tight near-white band, white ↔ warm cream — flows continuously across
// the settled role as a soft living neon-white accent against the dark, a
// luminous counterpoint to the portrait's cool cyan.
const NEON = {
  center: 42, // hue centre — warm cream
  amp: 18, // ± hue swing → warm-cream pattern across the word
  spatialFreq: 0.38, // hue variation per character index (spread across word)
  timeFreq: 0.0016, // hue drift per ms → slow shimmer while the front rides
  sat: 0.42, // gentle warmth: bright white-cream, not gold
  light: 0.9, // bright near-white core
  glowAlpha: 0.95, // strong peak glow — a bright neon bloom
  restGlow: 0.7, // bright steady glow the settled role holds
  prefixFadeMs: 380, // how long a passed prefix glyph takes to fade to grey
};
// Base unlit colour — Tailwind neutral-400, matching the tagline at rest.
const NEUTRAL_RGB: [number, number, number] = [163, 163, 163];

// Supporting copy + CTAs that fill the left column. Realistic draft copy —
// easy to swap. The hook and CTAs fade in after the tagline so the entrance
// stays sequenced: name → tagline → hook → actions.
const HOOK =
  "I build full-stack software, research-driven tools, and clean interfaces for complex workflows.";
const HOOK_ENTRANCE = { delay: 1.5, duration: 0.5 };
const CTA_ENTRANCE = { delay: 1.75, duration: 0.5 };
// Code-flavored pool that echoes the portrait's vocabulary. The widest
// glyphs (@ % M W m w) are excluded.
const SCRAMBLE_GLYPHS = "01<>[]{}()/=+-*;:.!?$#&|abcdefghijklnopqrstuvxyz";
// Narrow pool, used at positions whose FINAL letter is itself narrow
// (i, l, t, …). Without it, a wide scramble glyph standing in for a thin
// letter makes the decoding line wider than the resolved name — which is
// what pushed the name onto a second line mid-animation. Matching glyph
// width to the final letter keeps every frame no wider than the name, so
// it never wraps differently than the resting text at any viewport.
const NARROW_GLYPHS = "1il:;.,!|'";
const NARROW_FINALS = "iIlt1jf.,:;!|'()[]{}/\\";

function isNarrowFinal(ch: string) {
  return NARROW_FINALS.includes(ch);
}

// Deterministic glyph so the server and first client render agree (a
// Math.random scramble at SSR time would trip a hydration mismatch). The
// rAF loop takes over with real randomness on mount.
function seededGlyph(i: number, narrow: boolean) {
  const pool = narrow ? NARROW_GLYPHS : SCRAMBLE_GLYPHS;
  return pool[(i * 7 + 3) % pool.length];
}
function initialScramble(text: string) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    out += ch === " " ? " " : seededGlyph(i, isNarrowFinal(ch));
  }
  return out;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = ((((h % 360) + 360) % 360) / 360) * 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hh * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [
    Math.round(f(0) * 255),
    Math.round(f(8) * 255),
    Math.round(f(4) * 255),
  ];
}

// Per-character style: blend `base` → a neon hue by `colorLit` (0..1), plus a
// same-hue glow scaled independently by `glowLit`. Splitting the two lets the
// role keep its colour after the front passes (colorLit held at 1) while the
// glow eases to its resting level (glowLit → restGlow), so the settled role
// keeps a calm steady glow. The hue oscillates within NEON's near-white band
// by position and `hueT` (live time), so the colour pattern drifts across the
// resting role rather than sitting on a single fixed tint.
function neonStyle(
  globalIndex: number,
  hueT: number,
  colorLit: number,
  glowLit: number,
  base: [number, number, number],
): { color: string; textShadow?: string } {
  if (colorLit <= 0 && glowLit <= 0) {
    return { color: `rgb(${base[0]} ${base[1]} ${base[2]})` };
  }
  const phase = globalIndex * NEON.spatialFreq + hueT * NEON.timeFreq;
  const hue = NEON.center + NEON.amp * Math.sin(phase);
  const [r, g, b] = hslToRgb(hue, NEON.sat, NEON.light);
  const mix = (b0: number, target: number) =>
    Math.round(b0 + (target - b0) * colorLit);
  const color = `rgb(${mix(base[0], r)} ${mix(base[1], g)} ${mix(base[2], b)})`;
  if (glowLit <= 0) {
    return { color };
  }
  // Layered neon glow in the pure hue: a tight bright core plus two wider
  // blooms make it read as a lit neon tube rather than a flat shadow. All
  // blur radii and alphas scale with glowLit, so the bloom only ever rides
  // the decode front and fades to nothing once it has passed.
  const a = NEON.glowAlpha * glowLit;
  const rgba = (alpha: number) =>
    `rgba(${r}, ${g}, ${b}, ${Math.min(1, alpha)})`;
  const textShadow = [
    `0 0 ${1 + 2 * glowLit}px ${rgba(a * 1.7)}`,
    `0 0 ${5 + 7 * glowLit}px ${rgba(a)}`,
    `0 0 ${11 + 20 * glowLit}px ${rgba(a * 0.7)}`,
  ].join(", ");
  return { color, textShadow };
}

// Colour litness ramps 0→1 across a glyph's settle window (it tints as it
// resolves). A held glyph (the role) then latches at 1 — its colour stays for
// good; a non-held glyph (the prefix) fades back to base grey over
// prefixFadeMs.
function colorLitnessAt(
  t: number,
  lock: number,
  settleMs: number,
  hold: boolean,
) {
  if (t <= lock - settleMs) return 0;
  if (t <= lock) return (t - (lock - settleMs)) / settleMs;
  if (hold) return 1;
  return Math.max(0, 1 - (t - lock) / NEON.prefixFadeMs);
}

// Glow litness rises with the front and peaks at lock. A held glyph (the
// role) then eases from that peak down to a steady resting glow and holds it,
// so the settled role keeps a calm neon glow; a non-held glyph (the prefix)
// fades all the way to 0, losing colour and glow together.
function glowLitnessAt(
  t: number,
  lock: number,
  settleMs: number,
  hold: boolean,
) {
  if (t <= lock - settleMs) return 0;
  if (t <= lock) return (t - (lock - settleMs)) / settleMs;
  const after = (t - lock) / NEON.prefixFadeMs;
  if (hold) return Math.max(NEON.restGlow, 1 - after * (1 - NEON.restGlow));
  return Math.max(0, 1 - after);
}

function DecodeName({
  text,
  reduce,
  decode = DECODE,
  neon = false,
  hold = false,
  hueOffset = 0,
  baseRgb = NEUTRAL_RGB,
}: {
  text: string;
  reduce: boolean | null;
  decode?: typeof DECODE;
  // Neon mode computes a per-character colour + glow each tick so the light
  // can ride the decode front. Rendering is always the width-locked cells.
  neon?: boolean;
  // hold: glyphs keep their colour after the front passes and ease to a steady
  // resting glow, while the hue keeps drifting so the colour pattern flows
  // across the resting word (the role). Off → colour and glow both fade back
  // out (the prefix).
  hold?: boolean;
  // Starting index into the shared band so name→prefix→role hues stay
  // continuous across the whole line.
  hueOffset?: number;
  // Colour the glyph fades back toward once the front has passed.
  baseRgb?: [number, number, number];
}) {
  const [display, setDisplay] = useState(() =>
    reduce ? text : initialScramble(text),
  );
  const [styles, setStyles] = useState<
    ({ color: string; textShadow?: string } | null)[]
  >([]);
  const rafRef = useRef(0);

  useEffect(() => {
    const len = text.length;
    const lockAt = (i: number) => decode.startDelayMs + i * decode.staggerMs;
    const lastLock = lockAt(len - 1);

    // Build the per-character style array for a given time. The hue keeps
    // drifting with `t` even after lock, so the held role's near-white/cream
    // colour pattern flows continuously across the resting word.
    const stylesAt = (t: number) => {
      const sty = new Array<{ color: string; textShadow?: string } | null>(len);
      for (let i = 0; i < len; i++) {
        if (text[i] === " ") {
          sty[i] = null;
          continue;
        }
        const lock = lockAt(i);
        sty[i] = neonStyle(
          hueOffset + i,
          t,
          colorLitnessAt(t, lock, decode.settleMs, hold),
          glowLitnessAt(t, lock, decode.settleMs, hold),
          baseRgb,
        );
      }
      return sty;
    };

    if (reduce) {
      // No motion: jump to the settled end-state — held glyphs (role) at flat
      // full colour with no glow, the prefix neutral grey.
      setDisplay(text);
      if (neon) setStyles(stylesAt(lastLock + NEON.prefixFadeMs + 1));
      return;
    }

    const start = performance.now();
    const doneAt = lastLock + decode.tickMs;
    // The held role loops until unmount so its colour pattern keeps drifting;
    // the prefix loop ends once every glyph has faded back to grey; the plain
    // name loop ends as soon as every glyph has resolved.
    const stopAt = neon
      ? hold
        ? Infinity
        : lastLock + NEON.prefixFadeMs + 80
      : doneAt;
    let lastTick = 0;

    const loop = (now: number) => {
      const t = now - start;
      if (!neon && t >= doneAt) {
        setDisplay(text);
        return;
      }
      if (now - lastTick >= decode.tickMs) {
        lastTick = now;
        let out = "";
        const sty = neon
          ? new Array<{ color: string; textShadow?: string } | null>(len)
          : null;
        for (let i = 0; i < len; i++) {
          const ch = text[i];
          if (ch === " ") {
            out += " ";
            if (sty) sty[i] = null;
            continue;
          }
          const lock = lockAt(i);
          if (t >= lock) {
            out += ch;
          } else {
            // Settle window: as t crosses into settleMs before lock, the odds
            // of landing the true letter ramp 0→1, so it flickers into place.
            const settle = (t - (lock - decode.settleMs)) / decode.settleMs;
            if (settle > 0 && Math.random() < settle) {
              out += ch;
            } else {
              const pool = isNarrowFinal(ch) ? NARROW_GLYPHS : SCRAMBLE_GLYPHS;
              out += pool[Math.floor(Math.random() * pool.length)];
            }
          }
          if (sty) {
            sty[i] = neonStyle(
              hueOffset + i,
              t,
              colorLitnessAt(t, lock, decode.settleMs, hold),
              glowLitnessAt(t, lock, decode.settleMs, hold),
              baseRgb,
            );
          }
        }
        setDisplay(out);
        if (sty) setStyles(sty);
      }
      if (t >= stopAt) {
        setDisplay(text);
        if (neon) setStyles(stylesAt(t));
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [text, reduce, decode, neon, hold, hueOffset, baseRgb]);

  // Width-locked per-character cells: each cell reserves exactly its final
  // letter's width (the invisible copy) and the animating glyph is painted
  // over it, centered — so the decoding line is ALWAYS exactly as wide as
  // the resolved text and can never reflow wider mid-animation, while still
  // wrapping responsively at the space. The neon colour + glow (when present)
  // is applied to the painted glyph; the spacer stays invisible.
  const nodes: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    if (text[i] === " ") {
      // A real space text node: the only soft-wrap opportunity, constant
      // width through the decode.
      nodes.push(" ");
      i += 1;
      continue;
    }
    const letters: ReactNode[] = [];
    while (i < text.length && text[i] !== " ") {
      const idx = i;
      const finalChar = text[idx];
      const dispChar = display[idx] ?? finalChar;
      const style = styles[idx];
      letters.push(
        <span key={idx} className="relative inline-block">
          <span className="invisible">{finalChar}</span>
          <span
            className="absolute inset-0 text-center"
            style={style ?? undefined}
          >
            {dispChar}
          </span>
        </span>,
      );
      i += 1;
    }
    nodes.push(
      <span key={`w${key++}`} className="inline-block whitespace-nowrap">
        {letters}
      </span>,
    );
  }

  return <span aria-hidden>{nodes}</span>;
}

export function HeroSection() {
  const reduce = useReducedMotion();
  const [roleIndex, setRoleIndex] = useState(0);
  // False until the first cycle fires: the opening word decodes in sync
  // with the prefix, while later words re-decode instantly on switch.
  const [hasSwitched, setHasSwitched] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      setRoleIndex((i) => (i + 1) % TAGLINE_ROLES.length);
      setHasSwitched(true);
    }, TAGLINE_CYCLE_MS);
    return () => clearInterval(id);
  }, []);

  const scrollTo =
    (id: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      document
        .getElementById(id)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

  return (
    <section
      id="intro"
      aria-label="Hero"
      className="relative h-screen w-full overflow-hidden bg-[#0a0a0a] text-neutral-100"
    >
      {/* Mobile: portrait sits as a centered band just below the title so
          the two read as one composition instead of leaving a big gap.
          Desktop (lg+): right-anchored and grounded to the bottom edge, with
          the top inset down so the bust stays the smaller, framed size and
          clears the nav — air above, shoulders meeting the bottom (no floating
          gap beneath). The canvas rebuilds at the smaller integer size, so it
          stays crisp — no transform/scale. */}
      <div className="pointer-events-none absolute left-0 right-0 top-[38%] bottom-[12%] z-0 flex items-end justify-end lg:left-auto lg:top-[14%] lg:bottom-0 lg:w-[52%]">
        <div className="h-full w-full">
          <CodeMatterPortrait
            revealMs={reduce ? 0 : PORTRAIT_REVEAL_MS}
            className="block h-full w-full"
          />
        </div>
      </div>

      {/* Desktop: left scrim keeps the left-aligned title readable over the
          portrait. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 hidden lg:block"
        style={{
          background:
            "linear-gradient(to right, rgba(10,10,10,0.92) 0%, rgba(10,10,10,0.6) 35%, rgba(10,10,10,0) 60%)",
        }}
      />
      {/* Mobile: gentle top scrim behind the stacked title; the portrait
          below stays clear. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 lg:hidden"
        style={{
          background:
            "linear-gradient(to bottom, rgba(10,10,10,0.9) 0%, rgba(10,10,10,0) 30%)",
        }}
      />
      {/* Vignette: darkens the far corners to frame the composition. Centered
          toward the portrait so the bust stays bright while the edges fall off. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(125% 125% at 65% 45%, rgba(10,10,10,0) 55%, rgba(10,10,10,0.55) 100%)",
        }}
      />

      <div className="absolute left-6 top-[15%] z-20 max-w-[90%] lg:left-20 lg:top-[22%] lg:max-w-[55%]">
        <motion.h1
          aria-label={NAME}
          className="font-sans font-semibold tracking-[-0.03em] text-neutral-100"
          style={{
            fontSize: "clamp(2.75rem, 8vw, 7rem)",
            lineHeight: 1,
            // Optical left-align: the large cap "O" has side bearing that
            // makes the name sit a few px right of the tagline below it.
            // This em-based nudge pulls the first glyph back onto the same
            // left grid line as the tagline, and scales with the font size.
            marginLeft: "-0.04em",
          }}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            duration: reduce ? 0 : NAME_FADE.duration,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          <DecodeName text={NAME} reduce={reduce} />
        </motion.h1>
        <motion.div
          className="mt-5 flex flex-wrap items-baseline gap-x-1 font-mono uppercase tracking-[0.2em] text-neutral-400"
          style={{
            fontSize: "clamp(0.72rem, 1.2vw, 0.95rem)",
            // Optical left-align with the name above. The name's first
            // glyph carries side bearing that the h1's -0.04em nudge only
            // partly cancels, so the mono tagline sits a hair left of the
            // visible "O". This em-based nudge slides the tagline right
            // onto the same grid line; tune this single value if needed.
            marginLeft: "0.32em",
          }}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            duration: reduce ? 0 : TAGLINE_ENTRANCE.duration,
            delay: reduce ? 0 : TAGLINE_ENTRANCE.delay,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          {/* Accessible copy for screen readers; the visible prefix is the
              aria-hidden decode reveal below. */}
          <span className="sr-only">{TAGLINE_PREFIX}</span>
          {/* The warm beige glow rides the decode front across the prefix,
              then each glyph fades back to neutral grey once it has passed. */}
          <DecodeName
            text={TAGLINE_PREFIX}
            reduce={reduce}
            decode={TAGLINE_DECODE}
            neon
          />
          <span className="relative inline-block min-w-[12ch] whitespace-nowrap text-neutral-400">
            <span className="sr-only">{TAGLINE_ROLES[roleIndex]}</span>
            {/* Keyed on the word so each switch remounts and re-runs the
                decode; the first word follows the prefix, switches snap in.
                hold → the glow rides the decode front, then the role settles
                to a steady resting glow while its cream colour pattern keeps
                drifting; hueOffset continues the band from where the prefix
                ended. */}
            <DecodeName
              key={TAGLINE_ROLES[roleIndex]}
              text={TAGLINE_ROLES[roleIndex]}
              reduce={reduce}
              decode={hasSwitched ? ROLE_DECODE : ROLE_FIRST_DECODE}
              neon
              hold
              hueOffset={TAGLINE_PREFIX.length}
            />
          </span>
        </motion.div>

        {/* Hook line — desktop only, where the column has room to breathe. */}
        <motion.p
          className="mt-6 hidden max-w-md text-pretty text-sm leading-relaxed text-neutral-400 lg:block"
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: reduce ? 0 : HOOK_ENTRANCE.duration,
            delay: reduce ? 0 : HOOK_ENTRANCE.delay,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          {HOOK}
        </motion.p>

        {/* Actions + availability. */}
        <motion.div
          className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-4"
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: reduce ? 0 : CTA_ENTRANCE.duration,
            delay: reduce ? 0 : CTA_ENTRANCE.delay,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          <a
            href="#projects"
            onClick={scrollTo("projects")}
            className="group inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-400/5 px-5 py-2.5 font-mono text-xs uppercase tracking-[0.18em] text-cyan-100 transition-colors hover:border-cyan-300/70 hover:bg-cyan-400/10 focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:outline-none"
          >
            View work
            <span
              aria-hidden
              className="transition-transform duration-300 group-hover:translate-x-0.5"
            >
              →
            </span>
          </a>
          <a
            href="#contact"
            onClick={scrollTo("contact")}
            className="rounded-sm font-mono text-xs uppercase tracking-[0.18em] text-neutral-400 underline-offset-4 transition-colors hover:text-neutral-100 hover:underline focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:outline-none"
          >
            Get in touch
          </a>
          <span className="hidden items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-neutral-500 lg:inline-flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/70 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Available for work
          </span>
        </motion.div>
      </div>

      {/* Scroll cue — desktop only; on mobile the portrait band is right
          there, so no cue is needed. */}
      <motion.a
        href="#about"
        onClick={scrollTo("about")}
        aria-label="Scroll to content"
        className="absolute bottom-7 left-6 z-20 hidden items-center gap-3 font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-500 transition-colors hover:text-neutral-200 lg:left-20 lg:flex"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reduce ? 0 : 0.6, delay: reduce ? 0 : 2.4 }}
      >
        <span aria-hidden className="motion-safe:animate-bounce">
          ↓
        </span>
        Scroll
      </motion.a>
    </section>
  );
}
