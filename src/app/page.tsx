"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { HeroSection } from "@/components/hero-section";
import { SectionRail } from "@/components/section-rail";
import { SECTIONS } from "@/lib/sections";

// The hero owns its own entrance animation; the section rail just
// waits a beat after first paint so it doesn't compete with the
// portrait decode + name landing. Tuned to fire right after the
// tagline appears.
const RAIL_DELAY_MS = 1500;

const SECTION_TINTS: Record<string, string> = {
  about: "from-pink-50 via-white to-white",
  projects: "from-cyan-50 via-white to-white",
  research: "from-yellow-50 via-white to-white",
  contact: "from-violet-50 via-white to-white",
};

export default function Home() {
  const reduce = useReducedMotion();
  const [railReady, setRailReady] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const tickingRef = useRef(false);

  useEffect(() => {
    if (reduce) {
      setRailReady(true);
      return;
    }
    const t = window.setTimeout(() => setRailReady(true), RAIL_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [reduce]);

  useEffect(() => {
    if (!railReady) return;
    const update = () => {
      tickingRef.current = false;
      const center = window.innerHeight / 2;
      let bestId: string | null = null;
      let bestDist = Infinity;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
        const c = rect.top + rect.height / 2;
        const d = Math.abs(c - center);
        if (d < bestDist) {
          bestDist = d;
          bestId = s.id;
        }
      }
      setActiveId(bestId);
    };
    const onScroll = () => {
      if (tickingRef.current) return;
      tickingRef.current = true;
      requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [railReady]);

  return (
    <main>
      <HeroSection />
      {railReady && <SectionRail activeId={activeId} />}
      {SECTIONS.map((s) => (
        <section
          key={s.id}
          id={s.id}
          className={`flex min-h-screen items-center justify-center bg-gradient-to-b ${SECTION_TINTS[s.id]}`}
        >
          <h2 className="text-7xl font-semibold tracking-tight text-neutral-300 select-none">
            {s.label}
          </h2>
        </section>
      ))}
    </main>
  );
}
