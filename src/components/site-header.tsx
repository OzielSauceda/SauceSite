"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { SECTIONS } from "@/lib/sections";
import { cn } from "@/lib/utils";

type Props = {
  activeId: string | null;
};

// Fixed top header — brand monogram on the left, numbered section links on
// the right. It replaces the old right-side rail that overlapped the
// portrait. Text colour adapts: light over the dark hero (no section
// active), dark over the light content sections. Links smooth-scroll to the
// section ids from lib/sections, so the header never drifts from the page.
export function SiteHeader({ activeId }: Props) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  // On the hero no content section is active → sit on dark with light text.
  const onDark = activeId == null;

  const go = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    setOpen(false);
  };

  return (
    <motion.header
      className="fixed inset-x-0 top-0 z-50"
      initial={reduce ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.5, delay: reduce ? 0 : 0.5 }}
    >
      <div className="flex items-center justify-between px-6 py-5 lg:px-20 lg:py-6">
        {/* Brand monogram (the hero carries the full name). */}
        <a
          href="#intro"
          onClick={(e) => go(e, "intro")}
          className={cn(
            "font-mono text-sm font-semibold tracking-[0.3em] uppercase transition-colors duration-300",
            onDark
              ? "text-neutral-100 hover:text-cyan-300"
              : "text-neutral-900 hover:text-cyan-600",
          )}
        >
          OS
        </a>

        {/* Desktop nav */}
        <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
          {SECTIONS.map((s, i) => {
            const num = String(i + 1).padStart(2, "0");
            const isActive = activeId === s.id;
            return (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={(e) => go(e, s.id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group flex items-baseline gap-1.5 rounded-sm font-mono text-xs uppercase tracking-[0.18em] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-cyan-400/60",
                  onDark
                    ? "text-neutral-400 hover:text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-900",
                  isActive && (onDark ? "text-neutral-100" : "text-neutral-900"),
                )}
              >
                <span className="text-[10px] tabular-nums opacity-60">
                  {num}
                </span>
                <span>{s.label}</span>
              </a>
            );
          })}
        </nav>

        {/* Mobile toggle */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400/60 md:hidden",
            onDark ? "text-neutral-200" : "text-neutral-800",
          )}
        >
          <span className="relative block h-3 w-5">
            <span
              className={cn(
                "absolute left-0 block h-px w-5 bg-current transition-transform duration-300",
                open ? "top-1.5 rotate-45" : "top-0",
              )}
            />
            <span
              className={cn(
                "absolute left-0 bottom-0 block h-px w-5 bg-current transition-transform duration-300",
                open ? "bottom-1.5 -rotate-45" : "",
              )}
            />
          </span>
        </button>
      </div>

      {/* Mobile dropdown — a dark glass panel that reads on any section. */}
      <AnimatePresence>
        {open && (
          <motion.nav
            aria-label="Primary"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="mx-4 overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a]/95 p-2 backdrop-blur-md md:hidden"
          >
            <ol className="flex flex-col">
              {SECTIONS.map((s, i) => {
                const num = String(i + 1).padStart(2, "0");
                const isActive = activeId === s.id;
                return (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      onClick={(e) => go(e, s.id)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-3 font-mono text-sm uppercase tracking-[0.16em] transition-colors hover:bg-white/5",
                        isActive ? "text-neutral-100" : "text-neutral-400",
                      )}
                    >
                      <span className="text-[10px] tabular-nums text-neutral-500">
                        {num}
                      </span>
                      <span className="flex-1">{s.label}</span>
                      {isActive && (
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 rounded-full bg-cyan-400"
                        />
                      )}
                    </a>
                  </li>
                );
              })}
            </ol>
          </motion.nav>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
