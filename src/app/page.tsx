"use client";

import { useEffect, useRef, useState } from "react";
import { HeroSection } from "@/components/hero-section";
import { SiteHeader } from "@/components/site-header";
import { SECTIONS } from "@/lib/sections";

const SECTION_TINTS: Record<string, string> = {
  about: "from-pink-50 via-white to-white",
  projects: "from-cyan-50 via-white to-white",
  research: "from-yellow-50 via-white to-white",
  contact: "from-violet-50 via-white to-white",
};

export default function Home() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const tickingRef = useRef(false);

  useEffect(() => {
    const update = () => {
      tickingRef.current = false;
      const center = window.innerHeight / 2;
      // Active only when a section actually spans the viewport centre. The
      // hero isn't in SECTIONS, so at the top nothing is active — no nav
      // highlight, and the header keeps its light-on-dark hero theme.
      let found: string | null = null;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= center && rect.bottom >= center) {
          found = s.id;
          break;
        }
      }
      setActiveId(found);
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
  }, []);

  return (
    <main>
      <SiteHeader activeId={activeId} />
      <HeroSection />
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
