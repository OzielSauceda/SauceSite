"use client";

import { useEffect, useRef, useState } from "react";
import { SectionRail } from "@/components/section-rail";
import { StarIntro } from "@/components/star-intro";
import { SECTIONS } from "@/lib/sections";

const SECTION_TINTS: Record<string, string> = {
  about: "from-pink-50 via-white to-white",
  projects: "from-cyan-50 via-white to-white",
  research: "from-yellow-50 via-white to-white",
  contact: "from-violet-50 via-white to-white",
};

export default function Home() {
  const [introDone, setIntroDone] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const tickingRef = useRef(false);

  useEffect(() => {
    const onDone = () => setIntroDone(true);
    window.addEventListener("steezy:intro-done", onDone);
    return () => window.removeEventListener("steezy:intro-done", onDone);
  }, []);

  useEffect(() => {
    if (!introDone) return;
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
  }, [introDone]);

  return (
    <main>
      <StarIntro />
      {introDone && <SectionRail activeId={activeId} />}
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
