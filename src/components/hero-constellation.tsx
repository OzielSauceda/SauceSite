"use client";

import { useEffect, useRef } from "react";

// Drifting wireframe constellation that sits behind the hero copy once
// `selectorMode` flips on. Visual language: same dark-slate-on-warm-cream
// vocabulary as wireframe-bust.tsx and systems-diagram.tsx so the whole
// hero reads as one connected mesh, not three unrelated graphics.

// ---- knobs --------------------------------------------------------------
const NODE_COUNT = 38;          // how many drifting points
const CONNECT_DIST = 150;       // px (canvas-space); edges only draw under this
const SPEED = 0.045;            // px/frame at ~60fps; very slow drift
const NODE_COLOR = "rgba(120, 168, 235, 0.25)"; // quiet blue, behind hero content — eased from 0.38 so the code portrait doesn't compete with starfield noise
const LINE_RGB = "77, 142, 255"; // base for edge stroke; alpha comes from distance
const MAX_LINE_ALPHA = 0.09;    // strongest edge opacity (close pair) — eased from 0.14 for the same reason
const NODE_MIN_R = 0.8;
const NODE_MAX_R = 1.8;
// ------------------------------------------------------------------------

type Node = { x: number; y: number; vx: number; vy: number; r: number };

type Props = {
  className?: string;
};

export function HeroConstellation({ className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    let width = 0;
    let height = 0;
    let nodes: Node[] = [];
    let rafId = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const seed = () => {
      nodes = [];
      for (let i = 0; i < NODE_COUNT; i++) {
        const angle = Math.random() * Math.PI * 2;
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: Math.cos(angle) * SPEED,
          vy: Math.sin(angle) * SPEED,
          r: NODE_MIN_R + Math.random() * (NODE_MAX_R - NODE_MIN_R),
        });
      }
    };

    resize();
    seed();

    const onResize = () => {
      resize();
      seed();
    };
    window.addEventListener("resize", onResize);

    const tick = () => {
      ctx.clearRect(0, 0, width, height);

      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < -30) n.x = width + 30;
        else if (n.x > width + 30) n.x = -30;
        if (n.y < -30) n.y = height + 30;
        else if (n.y > height + 30) n.y = -30;
      }

      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > CONNECT_DIST * CONNECT_DIST) continue;
          const d = Math.sqrt(d2);
          const alpha = (1 - d / CONNECT_DIST) * MAX_LINE_ALPHA;
          ctx.strokeStyle = `rgba(${LINE_RGB}, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      ctx.fillStyle = NODE_COLOR;
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
