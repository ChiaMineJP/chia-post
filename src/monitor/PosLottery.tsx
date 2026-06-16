import { useEffect, useRef } from "react";
import type { FarmingInfoEvent } from "./events.ts";

/**
 * The proof-of-space lottery, faithful to how a proof is actually found:
 *
 *   ① FILTER — every plot is a cell; a few survive the plot filter each round.
 *   ② SEARCH — each survivor dives the lookup tree from the TOP table (T7) down
 *              to the leaves (T1). Most survivors have no T7 match for this
 *              challenge, so they STOP at the top and fade (the real early-out).
 *   ③ WINDOW — a survivor that found a proof gets a quality → required_iters,
 *              which lands as a marker on the signage-point window line. Inside
 *              the green zone (required_iters < interval) = WIN; just outside =
 *              a near-miss. The marker's position IS the challenge-derived number.
 */
const LEVELS = 7; // T7 (top) … T1 (leaves)
const DIVE_FRAMES = 70; // the search deliberately takes time
const MAX_TOKENS = 64;

interface Spawn {
  plotIndex: number;
  hasProof: boolean;
  requiredIters: number | null;
  fraction: number | null;
  win: boolean;
  bits: number;
  delay: number;
}

interface Tok {
  plotIndex: number;
  bits: number;
  hasProof: boolean;
  requiredIters: number | null;
  win: boolean;
  stage: 0 | 1 | 2 | 3; // 0 dive, 1 slide-to-line, 2 landed, 3 no-proof fade
  diveT: number;
  x: number;
  y: number;
  tx: number;
  alpha: number;
}

function hashBits(challengeHex: string, plotIndex: number): number {
  let h = 2166136261 >>> 0;
  const s = `${challengeHex}:${plotIndex}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function PosLottery({ round }: { round: FarmingInfoEvent | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tokensRef = useRef<Tok[]>([]);
  const spawnRef = useRef<Spawn[]>([]);
  const roundRef = useRef<FarmingInfoEvent | null>(round);
  const lastTsRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 380 });

  roundRef.current = round;

  useEffect(() => {
    if (!round || round.ts === lastTsRef.current) return;
    lastTsRef.current = round.ts;
    const ch = round.challengeHex ?? round.challenge;
    const q = spawnRef.current;
    if (round.attempts && round.attempts.length) {
      let i = 0;
      for (const a of round.attempts) {
        if (!a.passed) continue;
        q.push({ plotIndex: a.plotIndex, hasProof: a.hasProof, requiredIters: a.requiredIters, fraction: a.windowFraction, win: a.win, bits: hashBits(ch, a.plotIndex), delay: i * 9 });
        i++;
      }
    } else {
      for (let i = 0; i < Math.min(round.passed, 24); i++) {
        const win = i < round.proofs;
        q.push({ plotIndex: i, hasProof: true, requiredIters: null, fraction: win ? 0.5 : 1.5 + Math.random() * 3, win, bits: hashBits(ch, i), delay: i * 9 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.ts]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const host = canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const resize = () => {
      const w = host.clientWidth;
      const h = 380;
      sizeRef.current = { w, h };
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const draw = () => {
      const { w, h } = sizeRef.current;
      const padX = 24;
      const innerW = w - padX * 2;

      const filterTop = 18;
      const filterBottom = 44;
      const treeTop = 78;
      const treeBottom = 214;
      const lineY = 308;
      const levelY = (i: number) => treeTop + (i + 0.5) * ((treeBottom - treeTop) / LEVELS);

      const lineLeft = padX + 6;
      const lineRight = w - padX - 6;
      const lineW = lineRight - lineLeft;
      const rnd = roundRef.current;
      const interval = rnd?.interval ?? 64;
      const maxR = interval * 4;
      const posX = (r: number) => lineLeft + (Math.min(r, maxR) / maxR) * lineW;
      const winX = posX(interval);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.textBaseline = "alphabetic";

      // band labels
      ctx.fillStyle = "#46685a";
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText("① PLOT FILTER", padX, filterTop - 5);
      ctx.fillText("② PROOF SEARCH · lookup tree T7 → T1 (most stop at T7)", padX, treeTop - 12);
      ctx.fillText("③ required_iters vs the signage-point window", padX, lineY - 40);

      // ── 1) filter cells ───────────────────────────────────────────────
      const total = rnd?.totalPlots ?? 16;
      const cellStep = innerW / total;
      const cellW = Math.min(26, cellStep - 3);
      const cellMidX = (i: number) => padX + i * cellStep + cellStep / 2;
      const attempts = rnd?.attempts;
      for (let i = 0; i < total; i++) {
        const a = attempts?.[i];
        const passed = a ? a.passed : i < (rnd?.passed ?? 0);
        ctx.fillStyle = passed ? "rgba(63,185,80,0.85)" : "#182a20";
        ctx.strokeStyle = passed ? "#3fb950" : "#223a2d";
        ctx.lineWidth = 1;
        const x = padX + i * cellStep + (cellStep - cellW) / 2;
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(x, filterTop, cellW, filterBottom - filterTop, 3);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillRect(x, filterTop, cellW, filterBottom - filterTop);
          ctx.strokeRect(x, filterTop, cellW, filterBottom - filterTop);
        }
      }

      // ── 2) lookup-tree levels T7..T1 ─────────────────────────────────
      ctx.strokeStyle = "#16271f";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#3a5648";
      ctx.font = "9px ui-monospace, monospace";
      for (let l = 0; l < LEVELS; l++) {
        ctx.beginPath();
        ctx.moveTo(padX, levelY(l));
        ctx.lineTo(w - padX, levelY(l));
        ctx.stroke();
        ctx.fillText(`T${LEVELS - l}`, padX - 18, levelY(l) + 3);
      }

      // ── 3) window line ───────────────────────────────────────────────
      // win zone
      ctx.fillStyle = "rgba(63,185,80,0.12)";
      ctx.fillRect(lineLeft, lineY - 16, winX - lineLeft, 32);
      ctx.strokeStyle = "#3fb950";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(winX, lineY - 18);
      ctx.lineTo(winX, lineY + 18);
      ctx.stroke();
      ctx.setLineDash([]);
      // axis
      ctx.strokeStyle = "#2b4636";
      ctx.beginPath();
      ctx.moveTo(lineLeft, lineY);
      ctx.lineTo(lineRight, lineY);
      ctx.stroke();
      // labels
      ctx.fillStyle = "#3fb950";
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText("WIN ZONE", lineLeft + 4, lineY - 20);
      ctx.fillStyle = "#6f9a85";
      ctx.fillText("0", lineLeft - 2, lineY + 28);
      ctx.textAlign = "center";
      ctx.fillStyle = "#3fb950";
      ctx.fillText(`window = ${interval}`, winX, lineY + 28);
      ctx.fillStyle = "#6f9a85";
      ctx.textAlign = "right";
      ctx.fillText(`required_iters →   ${maxR}+`, lineRight, lineY + 28);
      ctx.textAlign = "left";

      // ── spawn ─────────────────────────────────────────────────────────
      const q = spawnRef.current;
      for (let i = q.length - 1; i >= 0; i--) {
        if (--q[i].delay <= 0) {
          const s = q[i];
          tokensRef.current.push({
            plotIndex: s.plotIndex,
            bits: s.bits,
            hasProof: s.hasProof,
            requiredIters: s.requiredIters,
            win: s.win,
            stage: 0,
            diveT: 0,
            x: cellMidX(Math.min(s.plotIndex, total - 1)),
            y: treeTop,
            tx: cellMidX(Math.min(s.plotIndex, total - 1)),
            alpha: 1,
          });
          q.splice(i, 1);
        }
      }
      const toks = tokensRef.current;
      if (toks.length > MAX_TOKENS) toks.splice(0, toks.length - MAX_TOKENS);

      const amp = Math.min(9, cellStep * 0.32);
      const nodeX = (t: Tok, level: number) => {
        const lane = cellMidX(Math.min(t.plotIndex, total - 1));
        const dir = ((t.bits >> level) & 1) === 1 ? 1 : -1;
        return Math.max(lineLeft, Math.min(lineRight, lane + dir * amp));
      };

      for (let i = toks.length - 1; i >= 0; i--) {
        const b = toks[i];

        if (b.stage === 0) {
          if (!b.hasProof) {
            // early stop: no T7 match — hold briefly at the top table, then fade
            b.y = levelY(0);
            b.diveT += 1 / 22;
            if (b.diveT >= 1) b.stage = 3;
          } else {
            b.diveT += 1 / DIVE_FRAMES;
            const depth = Math.min(LEVELS, b.diveT * LEVELS);
            b.y = treeTop + Math.min(1, b.diveT) * (treeBottom - treeTop);
            const lvl = Math.min(LEVELS - 1, Math.floor(depth));
            b.tx = nodeX(b, lvl);
            b.x += (b.tx - b.x) * 0.3;
            // draw the path segments walked so far
            ctx.globalAlpha = b.alpha * 0.55;
            ctx.strokeStyle = b.win ? "#3fb950" : "#5f7d6c";
            ctx.lineWidth = 1.5;
            for (let l = 0; l < lvl; l++) {
              ctx.beginPath();
              ctx.moveTo(nodeX(b, l), levelY(l));
              ctx.lineTo(nodeX(b, l + 1), levelY(l + 1));
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
            if (b.diveT >= 1) {
              b.stage = 1;
              b.tx = posX(b.requiredIters ?? maxR);
            }
          }
        } else if (b.stage === 1) {
          b.x += (b.tx - b.x) * 0.18;
          b.y += (lineY - b.y) * 0.18;
          if (Math.abs(b.x - b.tx) < 1 && Math.abs(b.y - lineY) < 1) {
            b.stage = 2;
            b.y = lineY;
            b.x = b.tx;
          }
        } else if (b.stage === 2) {
          b.alpha -= 0.006; // landed markers linger
        } else {
          b.alpha -= 0.03; // no-proof fade
        }

        if (b.alpha <= 0) {
          toks.splice(i, 1);
          continue;
        }

        // draw token
        ctx.globalAlpha = Math.max(0, b.alpha);
        if (b.stage === 3) {
          ctx.fillStyle = "#7d4a4a";
          ctx.beginPath();
          ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#c4666a";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(b.x - 3, b.y - 3);
          ctx.lineTo(b.x + 3, b.y + 3);
          ctx.moveTo(b.x + 3, b.y - 3);
          ctx.lineTo(b.x - 3, b.y + 3);
          ctx.stroke();
        } else {
          const r = b.stage === 2 ? 4.5 : 5;
          ctx.beginPath();
          ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
          if (b.win) {
            ctx.fillStyle = "#ffe9a8";
            ctx.shadowColor = "#3fb950";
            ctx.shadowBlur = 14;
          } else {
            ctx.fillStyle = "#cdbf93";
            ctx.shadowBlur = 0;
          }
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        ctx.globalAlpha = 1;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="pachinko-canvas" style={{ width: "100%", display: "block" }} />;
}
