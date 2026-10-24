"use client";
import { useEffect, useRef } from "react";

export interface Skin {
  grass: [string, string];
  lines: string;
}

const W = 1050;
const H = 680;

/**
 * 2D-Taktikansicht: zeichnet 22 Spieler und den Ball. Die Positionen kommen pro
 * Tick vom Server, dazwischen wird weich interpoliert.
 */
export function MatchCanvas({ frames, playhead, colors, numbers, skin, flash, mySide }: {
  frames: number[][];
  playhead: number; // Tick (Kommazahl)
  colors: [{ fill: string; ink: string }, { fill: string; ink: string }];
  numbers: [number[], number[]];
  skin: Skin;
  flash: string | null;
  /** Eigene Mannschaft: grösser, mit hellem Ring – der Gegner tritt zurück */
  mySide?: 0 | 1;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== W * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPitch(ctx, skin);
    if (!frames.length) return;
    const i0 = Math.max(0, Math.min(frames.length - 1, Math.floor(playhead)));
    const i1 = Math.min(frames.length - 1, i0 + 1);
    const raw = playhead - i0;
    const k = raw * raw * (3 - 2 * raw); // weiche Bewegung
    const a = frames[i0];
    const b = frames[i1];
    const lerp = (j: number, kk = k) => (a[j] + (b[j] - a[j]) * kk) / 10;
    const sx = W / 105;
    const sy = H / 68;

    // Spieler – Gegner zuerst, damit die eigene Mannschaft obenauf liegt
    const order = mySide === 0 ? [1, 0] : [0, 1];
    for (const side of order) {
      const own = mySide === undefined || side === mySide;
      const r = own ? 14 : 12;
      for (let s = 0; s < 11; s++) {
        const j = 3 + side * 22 + s * 2;
        if (a[j] < 0 || b[j] < 0) {
          if (a[j] < 0 && b[j] < 0) continue;
        }
        const src = a[j] < 0 ? b : a;
        const dst = b[j] < 0 ? a : b;
        const x = (src[j] + (dst[j] - src[j]) * k) / 10;
        const y = (src[j + 1] + (dst[j + 1] - src[j + 1]) * k) / 10;
        const px = x * sx;
        const py = y * sy;
        ctx.beginPath();
        ctx.arc(px + 1.5, py + 2.5, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fill();
        if (own && mySide !== undefined) {
          // Markierung der eigenen Spieler: heller Hof und Aussenring
          ctx.beginPath();
          ctx.arc(px, py, r + 6, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.22)";
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#fff";
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.globalAlpha = own ? 1 : 0.85;
        ctx.fillStyle = s === 0 ? shade(colors[side].fill) : colors[side].fill;
        ctx.fill();
        ctx.lineWidth = own ? 2.5 : 1.5;
        ctx.strokeStyle = own ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.55)";
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = s === 0 ? "#fff" : colors[side].ink;
        ctx.font = `700 ${own ? 14 : 12}px 'Barlow Condensed', system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(numbers[side][s] ?? s + 1), px, py + 0.5);
      }
    }
    // Ball
    const bk = Math.min(1, raw * 1.6);
    const bx = lerp(0, bk) * sx;
    const by = lerp(1, bk) * sy;
    ctx.beginPath();
    ctx.arc(bx + 2, by + 3, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx, by, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#111";
    ctx.stroke();

    if (flash) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, H / 2 - 60, W, 120);
      ctx.fillStyle = "#fff";
      ctx.font = "700 72px 'Barlow Condensed', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(flash, W / 2, H / 2);
    }
  }, [frames, playhead, colors, numbers, skin, flash]);

  return <canvas ref={ref} style={{ width: "100%", aspectRatio: `${W} / ${H}` }} aria-label="2D-Spielansicht" role="img" />;
}

function shade(hex: string) {
  // Torhüter etwas dunkler, damit sie erkennbar sind
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const f = 0.55;
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

function drawPitch(ctx: CanvasRenderingContext2D, skin: Skin) {
  const sx = W / 105;
  const sy = H / 68;
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = skin.grass[i % 2];
    ctx.fillRect((i * W) / 14, 0, W / 14 + 1, H);
  }
  ctx.strokeStyle = skin.lines;
  ctx.lineWidth = 2;
  const m = 2;
  ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);
  ctx.beginPath();
  ctx.moveTo(W / 2, m);
  ctx.lineTo(W / 2, H - m);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 9.15 * sx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 3, 0, Math.PI * 2);
  ctx.fillStyle = skin.lines;
  ctx.fill();
  for (const left of [true, false]) {
    const x0 = left ? m : W - m;
    const dir = left ? 1 : -1;
    // Strafraum
    ctx.strokeRect(left ? x0 : x0 - 16.5 * sx, (34 - 20.16) * sy, 16.5 * sx, 40.32 * sy);
    ctx.strokeRect(left ? x0 : x0 - 5.5 * sx, (34 - 9.16) * sy, 5.5 * sx, 18.32 * sy);
    ctx.beginPath();
    ctx.arc(x0 + dir * 11 * sx, H / 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x0 + dir * 11 * sx, H / 2, 9.15 * sx, left ? -0.93 : Math.PI - 0.93, left ? 0.93 : Math.PI + 0.93);
    ctx.stroke();
    // Tor
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(left ? 0 : W - 6, (34 - 3.66) * sy, 6, 7.32 * sy);
    ctx.fillStyle = skin.lines;
  }
}
