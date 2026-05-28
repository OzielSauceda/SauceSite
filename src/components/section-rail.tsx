"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SECTIONS } from "@/lib/sections";

type Props = {
  activeId: string | null;
};

// Floating Section Index — minimal numbered list on the right side. The
// active section gets an indicator line + foreground text color; inactive
// items stay quiet but readable. Section ordering and IDs come from
// lib/sections so the rail and the page sections never drift apart.
export function SectionRail({ activeId }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [viewport, setViewport] = useState({ width: 1440, height: 768 });

  useEffect(() => {
    const measure = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Matches heroStageScale in star-intro.tsx -- cover-scaled but capped
  // at 1.15 so the rail stops growing on ultrawides and 1920×1080. The
  // desktop rail is hidden below 1200px (see classes); the bottom-right
  // popover handles tablet/mobile, so this scale only affects ≥1200.
  const DESKTOP_MAX_SCALE = 1.15;
  const stageScale = Math.min(
    DESKTOP_MAX_SCALE,
    Math.max(viewport.width / 1440, viewport.height / 768),
  );
  const stageGutter = (viewport.width - 1440 * stageScale) / 2;

  const handleClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    id: string,
  ) => {
    // <a href="#id"> would scroll with native smoothness if we set
    // scroll-behavior: smooth on html, but using scrollIntoView keeps
    // the behavior local to the nav — no global CSS side effects.
    e.preventDefault();
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    setMobileOpen(false);
  };

  const activeIndex = activeId
    ? SECTIONS.findIndex((s) => s.id === activeId)
    : -1;
  const activeNum =
    activeIndex >= 0 ? String(activeIndex + 1).padStart(2, "0") : null;
  const activeLabel =
    activeIndex >= 0 ? SECTIONS[activeIndex].label : null;

  return (
    <>
      <nav
        data-rail
        aria-label="Sections"
        className="fixed top-1/2 z-40 hidden min-[1200px]:block"
        style={{
          // Fixed 30px gap from viewport right edge -- matches the laptop
          // look exactly. The scale below still grows the rail's text on
          // bigger monitors; only the right-edge gap stays constant.
          right: 30,
          transform: `translateY(-50%) scale(${stageScale})`,
          transformOrigin: "right center",
        }}
      >
        <ol className="flex flex-col items-end gap-1">
          {SECTIONS.map((s, i) => {
            const isActive = activeId === s.id;
            const num = String(i + 1).padStart(2, "0");
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  onClick={(e) => handleClick(e, s.id)}
                  aria-current={isActive ? "page" : undefined}
                  className="group flex items-center gap-3 py-1.5 pr-1 pl-2 outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent rounded-sm"
                >
                  <motion.span
                    aria-hidden
                    className="h-px origin-right bg-neutral-900"
                    initial={false}
                    animate={{
                      width: isActive ? 28 : 0,
                      opacity: isActive ? 1 : 0,
                    }}
                    transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                  />
                  <span
                    className={`font-mono text-[10px] tabular-nums tracking-widest transition-colors duration-200 ${
                      isActive
                        ? "text-neutral-700"
                        : "text-neutral-400 group-hover:text-neutral-600 group-focus-visible:text-neutral-600"
                    }`}
                  >
                    {num}
                  </span>
                  <span
                    className={`text-xs font-medium uppercase tracking-[0.18em] transition-colors duration-200 ${
                      isActive
                        ? "text-neutral-900"
                        : "text-neutral-500 group-hover:text-neutral-900 group-focus-visible:text-neutral-900"
                    }`}
                  >
                    {s.label}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      </nav>

      <div data-rail className="fixed bottom-5 right-4 z-40 min-[1200px]:hidden">
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              role="menu"
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="absolute bottom-full right-0 mb-2 w-52 overflow-hidden rounded-2xl border border-neutral-200 bg-white/95 p-1.5 shadow-[0_12px_40px_-12px_rgba(15,15,15,0.25)] backdrop-blur-md"
              style={{ transformOrigin: "bottom right" }}
            >
              <ol className="flex flex-col">
                {SECTIONS.map((s, i) => {
                  const isActive = activeId === s.id;
                  const num = String(i + 1).padStart(2, "0");
                  return (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        role="menuitem"
                        onClick={(e) => handleClick(e, s.id)}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-neutral-100 ${
                          isActive
                            ? "font-medium text-neutral-900"
                            : "text-neutral-600"
                        }`}
                      >
                        <span className="font-mono text-[10px] tabular-nums tracking-widest text-neutral-400">
                          {num}
                        </span>
                        <span className="flex-1 uppercase tracking-[0.16em] text-xs">
                          {s.label}
                        </span>
                        {isActive && (
                          <span
                            aria-hidden
                            className="h-1.5 w-1.5 rounded-full bg-neutral-900"
                          />
                        )}
                      </a>
                    </li>
                  );
                })}
              </ol>
            </motion.div>
          )}
        </AnimatePresence>
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          aria-expanded={mobileOpen}
          aria-haspopup="menu"
          aria-label="Sections"
          className="flex items-center gap-2.5 rounded-full border border-neutral-200 bg-white/95 px-4 py-2.5 text-sm font-medium text-neutral-700 shadow-[0_4px_20px_-6px_rgba(15,15,15,0.2)] backdrop-blur-md transition-colors hover:border-neutral-400"
        >
          {activeNum ? (
            <>
              <span className="font-mono text-[10px] tabular-nums tracking-widest text-neutral-500">
                {activeNum}
              </span>
              <span className="uppercase tracking-[0.16em] text-xs">
                {activeLabel}
              </span>
            </>
          ) : (
            <span className="uppercase tracking-[0.16em] text-xs">
              Sections
            </span>
          )}
        </button>
      </div>
    </>
  );
}
