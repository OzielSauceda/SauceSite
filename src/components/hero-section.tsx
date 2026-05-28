"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CodeMatterPortrait } from "@/components/code-matter-portrait";

const NAME = "Oziel Sauceda";
const TAGLINE_PREFIX = "designer & engineer · ";
const TAGLINE_ROLES = [
  "software developer",
  "researcher",
  "sauce purveyor",
  "tinkerer",
  "prototyper",
];
const TAGLINE_CYCLE_MS = 3500;

// Entrance choreography. The portrait owns the signature moment —
// glyphs spawn sparse, flicker, then lock band-by-band into the final
// readable bust over PORTRAIT_REVEAL_MS. After it resolves, the name
// fades/slides in, the tagline follows, and the page is live.
const PORTRAIT_REVEAL_MS = 1000;
const NAME_ENTRANCE = { delay: 1.25, duration: 0.55 };
const TAGLINE_ENTRANCE = { delay: 1.4, duration: 0.45 };

export function HeroSection() {
  const reduce = useReducedMotion();
  const [roleIndex, setRoleIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setRoleIndex((i) => (i + 1) % TAGLINE_ROLES.length);
    }, TAGLINE_CYCLE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <section
      id="intro"
      aria-label="Hero"
      className="relative h-screen w-full overflow-hidden bg-[#0a0a0a] text-neutral-100"
    >
      <div className="pointer-events-none absolute inset-y-0 right-0 z-0 flex w-full items-end justify-end md:w-[60%] lg:w-[55%]">
        <div className="h-[55%] w-full md:h-full">
          <CodeMatterPortrait
            revealMs={reduce ? 0 : PORTRAIT_REVEAL_MS}
            className="block h-full w-full"
          />
        </div>
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "linear-gradient(to right, rgba(10,10,10,0.92) 0%, rgba(10,10,10,0.6) 35%, rgba(10,10,10,0) 60%)",
        }}
      />

      <div className="absolute left-6 top-[22%] z-20 max-w-[90%] md:left-12 md:top-[28%] md:max-w-[55%] lg:left-20">
        <motion.h1
          className="font-sans font-semibold tracking-[-0.03em] text-neutral-100"
          style={{
            fontSize: "clamp(2.5rem, 7.5vw, 6rem)",
            lineHeight: 1,
          }}
          initial={
            reduce
              ? false
              : { opacity: 0, y: 14, filter: "blur(8px)" }
          }
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{
            duration: reduce ? 0 : NAME_ENTRANCE.duration,
            delay: reduce ? 0 : NAME_ENTRANCE.delay,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          {NAME}
        </motion.h1>
        <motion.div
          className="mt-5 flex flex-wrap items-baseline gap-x-1 font-mono uppercase tracking-[0.2em] text-neutral-400"
          style={{ fontSize: "clamp(0.72rem, 1.2vw, 0.95rem)" }}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: reduce ? 0 : TAGLINE_ENTRANCE.duration,
            delay: reduce ? 0 : TAGLINE_ENTRANCE.delay,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          <span>{TAGLINE_PREFIX}</span>
          <span className="relative inline-block min-w-[12ch]">
            <AnimatePresence mode="wait">
              <motion.span
                key={TAGLINE_ROLES[roleIndex]}
                className="block text-neutral-100"
                initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                {TAGLINE_ROLES[roleIndex]}
              </motion.span>
            </AnimatePresence>
          </span>
        </motion.div>
      </div>
    </section>
  );
}
