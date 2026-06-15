import { useEffect, useRef } from "react";
import type { TimelordTrace, TimelordEvent, InfusionEvent } from "../sim/events.ts";
import { CHAIN_COLORS, farmerColor } from "./colors.ts";

interface Props {
  trace: TimelordTrace;
  playheadIters: number;
  viewStart: number;
  viewIters: number;
  showDeps: boolean;
  selectedEvent: TimelordEvent | null;
  hoverEvent: TimelordEvent | null;
  onScrubTo: (iters: number) => void;
  onHover: (ev: TimelordEvent | null) => void;
  onSelect: (ev: TimelordEvent) => void;
}

// Vertical order matches the Chia docs diagram: cc top, ic middle, rc bottom.
const LANE = { cc: 0.26, icc: 0.52, rc: 0.78 };

export function TimelineCanvas({
  trace, playheadIters, viewStart, viewIters, showDeps,
  selectedEvent, hoverEvent, onScrubTo, onHover, onSelect,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  const xOf = (iters: number, w: number) => ((iters - viewStart) / viewIters) * w;
  const itersOf = (x: number, w: number) => viewStart + (x / w) * viewIters;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const w = host.clientWidth;
    const h = host.clientHeight;
    sizeRef.current = { w, h };
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, w, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace, playheadIters, viewStart, viewIters, showDeps, selectedEvent, hoverEvent]);

  // --- drawing primitives ---------------------------------------------------

  function head(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, color: string, size = 7) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(ang - 0.4), y - size * Math.sin(ang - 0.4));
    ctx.lineTo(x - size * Math.cos(ang + 0.4), y - size * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
  }

  function vArrow(
    ctx: CanvasRenderingContext2D, x: number, yFrom: number, yTo: number, color: string,
    width = 1.6, dash = false, alpha = 1,
  ) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    if (dash) ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, yFrom);
    ctx.lineTo(x, yTo);
    ctx.stroke();
    ctx.setLineDash([]);
    head(ctx, x, yTo, yTo < yFrom ? -Math.PI / 2 : Math.PI / 2, color);
    ctx.globalAlpha = 1;
  }

  function curveArrow(
    ctx: CanvasRenderingContext2D,
    x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, color: string, width = 1.4,
  ) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cx, cy, x1, y1);
    ctx.stroke();
    head(ctx, x1, y1, Math.atan2(y1 - cy, x1 - cx), color);
  }

  /** ⊗ symbol: a circled cross, as in the Chia diagram. */
  function xCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, width = 1.6) {
    ctx.fillStyle = "#0c1410";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    const d = r * 0.7;
    ctx.beginPath();
    ctx.moveTo(x - d, y - d);
    ctx.lineTo(x + d, y + d);
    ctx.moveTo(x - d, y + d);
    ctx.lineTo(x + d, y - d);
    ctx.stroke();
  }

  /** A faint ⊗ for a signage point that did not win a block. */
  function spTick(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 3.4, 0, Math.PI * 2);
    ctx.stroke();
    const d = 2.3;
    ctx.beginPath();
    ctx.moveTo(x - d, y - d);
    ctx.lineTo(x + d, y + d);
    ctx.moveTo(x - d, y + d);
    ctx.lineTo(x + d, y - d);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function boxNode(
    ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number,
    color: string, label: string, font: string, emphasize = false,
  ) {
    rrect(ctx, cx - w / 2, cy - h / 2, w, h, 3);
    ctx.fillStyle = "rgba(12,20,16,0.92)";
    ctx.fill();
    ctx.strokeStyle = emphasize ? "#e3b341" : color;
    ctx.lineWidth = emphasize ? 2.4 : 1.6;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, cy + 0.5);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  // --- main draw ------------------------------------------------------------

  function draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = "#0c1410";
    ctx.fillRect(0, 0, w, h);
    const yCC = h * LANE.cc;
    const yICC = h * LANE.icc;
    const yRC = h * LANE.rc;
    const ssi = trace.subSlotIters;
    const interval = trace.spIntervalIters;
    const infusions = trace.events.filter((e) => e.kind === "infusion") as InfusionEvent[];

    // block nearest the playhead gets text labels (keeps the diagram legible)
    let nearest: InfusionEvent | null = null;
    let nd = Infinity;
    for (const inf of infusions) {
      const d = Math.abs(inf.totalIters - playheadIters);
      if (d < nd) { nd = d; nearest = inf; }
    }

    // ---- sub-slot bands + boundaries ----
    for (const slot of trace.slots) {
      const x0 = xOf(slot.startIters, w);
      const x1 = xOf(slot.endIters, w);
      if (x1 < 0 || x0 > w) continue;
      ctx.fillStyle = slot.index % 2 === 0 ? "rgba(255,255,255,0.016)" : "transparent";
      ctx.fillRect(x0, 0, x1 - x0, h);
      // highlight the sub-slot the playhead is currently in
      if (playheadIters >= slot.startIters && playheadIters < slot.endIters) {
        ctx.fillStyle = "rgba(63,185,80,0.06)";
        ctx.fillRect(x0, 0, x1 - x0, h);
      }
      ctx.strokeStyle = "#21402f";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x0, 22);
      ctx.lineTo(x0, h - 24);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#6f9a85";
      ctx.font = "12px ui-monospace, monospace";
      ctx.fillText(`sub-slot ${slot.index}`, x0 + 8, 16);
    }

    // ---- dotted chain lines ----
    const dottedLine = (y: number, color: string, x0: number, x1: number, alpha = 0.8) => {
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(Math.max(0, x0), y);
      ctx.lineTo(Math.min(w, x1), y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    };
    dottedLine(yCC, CHAIN_COLORS.cc, 0, w);
    dottedLine(yRC, CHAIN_COLORS.rc, 0, w);

    // ICC line only where it is running (challenge block -> deficit 0 close).
    const icIntervals: [number, number][] = [];
    let curStart: number | null = null;
    for (const inf of infusions) {
      if (inf.isChallengeBlock) curStart = inf.totalIters;
      if (curStart !== null && inf.deficit === 0) {
        icIntervals.push([curStart, (Math.floor(inf.totalIters / ssi) + 1) * ssi]);
        curStart = null;
      }
    }
    if (curStart !== null) icIntervals.push([curStart, trace.totalItersEnd]);
    for (const [a, b] of icIntervals) dottedLine(yICC, CHAIN_COLORS.icc, xOf(a, w), xOf(b, w), 0.85);

    // ---- lane labels ----
    for (const [y, color, label] of [
      [yCC, CHAIN_COLORS.cc, "Challenge chain"],
      [yICC, CHAIN_COLORS.icc, "Infused challenge chain"],
      [yRC, CHAIN_COLORS.rc, "Rewards chain"],
    ] as [number, string, string][]) {
      ctx.fillStyle = color;
      ctx.font = "13px ui-monospace, monospace";
      ctx.fillText(label, 6, y - 12);
    }

    // ---- every signage point (faint), even those that won no block ----
    // The timelord releases NUM_SPS_SUB_SLOT signage points per sub-slot on the
    // cc and rc chains; most produce no block. The block-winning ones are redrawn
    // in colour by the block loop below.
    for (const e of trace.events) {
      if (e.kind !== "signage_point") continue;
      const x = xOf(e.totalIters, w);
      if (x < -6 || x > w + 6) continue;
      spTick(ctx, x, yCC, CHAIN_COLORS.cc);
      spTick(ctx, x, yRC, CHAIN_COLORS.rc);
      if (e === selectedEvent || e === hoverEvent) {
        ctx.strokeStyle = e === selectedEvent ? "#ffffff" : "rgba(255,255,255,0.4)";
        ctx.lineWidth = e === selectedEvent ? 1.8 : 1;
        for (const y of [yCC, yRC]) {
          ctx.beginPath();
          ctx.arc(x, y, 7, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // ---- end-of-sub-slot c/ic/r boxes + combine arrows (gray) ----
    for (const slot of trace.slots) {
      const bx = xOf(slot.startIters, w) + 18;
      if (bx < 14 || bx > w + 14) continue;
      const gray = "#5b7d6c";
      // gray combine: rewards -> ic -> challenge at the slot seam
      vArrow(ctx, bx, yRC - 9, yICC + 9, gray, 1);
      vArrow(ctx, bx, yICC - 9, yCC + 9, gray, 1);
      boxNode(ctx, bx, yCC, 26, 16, gray, `c${slot.index}`, "11px ui-monospace, monospace");
      boxNode(ctx, bx, yICC, 28, 16, gray, `ic${slot.index}`, "11px ui-monospace, monospace");
      boxNode(ctx, bx, yRC, 26, 16, gray, `r${slot.index}`, "11px ui-monospace, monospace");
    }

    // ---- end-of-sub-slot ICC fold marker ----
    for (const e of trace.events) {
      if (e.kind !== "end_of_sub_slot" || !e.hasIcc) continue;
      const x = xOf(e.totalIters, w);
      if (x < -12 || x > w + 12) continue;
      curveArrow(ctx, x, yICC - 8, x, yCC + 9, x + 24, (yICC + yCC) / 2, CHAIN_COLORS.icc, 1.6);
    }

    // ---- blocks + their cc/ic/rc signage & infusion points (the diagram) ----
    const half = 10;
    for (const inf of infusions) {
      const color = farmerColor(inf.blockHeight);
      const n = inf.blockHeight + 1;
      const launchSlot = inf.overflow ? inf.subSlot - 1 : inf.subSlot;
      const spX = xOf(launchSlot * ssi + inf.spIndex * interval, w);
      const ipX = xOf(inf.totalIters, w);
      if (Math.max(spX, ipX) < -30 || Math.min(spX, ipX) > w + 30) continue;
      const labelled = inf === nearest;

      // signage-point markers: cc sp + rc sp (the block's own sp, earlier than ip)
      xCircle(ctx, spX, yCC, 6, color);
      xCircle(ctx, spX, yRC, 6, color);
      // cc infusion point marker (where the block infuses INTO the challenge chain)
      xCircle(ctx, ipX, yCC, 6, color);
      // ic point: challenge block is a `cc Bn` box; later blocks are ⊗ infusions
      if (inf.iccActive) {
        if (inf.isChallengeBlock) {
          boxNode(ctx, ipX, yICC, 38, 16, color, `cc B${n}`, "10px ui-monospace, monospace");
        } else {
          xCircle(ctx, ipX, yICC, 6, color);
        }
      }
      // selection / hover highlight ring around the block
      if (inf === selectedEvent || inf === hoverEvent) {
        ctx.strokeStyle = inf === selectedEvent ? "#ffffff" : "rgba(255,255,255,0.4)";
        ctx.lineWidth = inf === selectedEvent ? 2 : 1.2;
        ctx.beginPath();
        ctx.arc(ipX, yRC, half + 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      // block on the rewards chain
      boxNode(ctx, ipX, yRC, half * 2, half * 2, color, `B${n}`, "bold 11px ui-monospace, monospace", inf.isTransactionBlock);

      // DIRECT-DEPENDENCY arrows (solid). The block depends on cc at its signage
      // point (earlier). When the ICC is running, that dependency is INDIRECT --
      // it flows block -> icc -> cc sp -- so the cc arrow starts at the icc point,
      // not the block. When the ICC is idle, the block depends on cc sp directly.
      if (showDeps) {
        if (inf.iccActive) {
          vArrow(ctx, ipX, yRC - half, yICC + 10, color); // block -> icc (direct)
          curveArrow(ctx, ipX, yICC - 7, spX, yCC + 7, (spX + ipX) / 2 - 6, (yCC + yICC) / 2, color, 1.4); // icc -> cc sp
        } else {
          curveArrow(ctx, ipX, yRC - half, spX, yCC + 7, (spX + ipX) / 2 - 6, (yCC + yRC) / 2, color, 1.4); // block -> cc sp
        }
      }

      // INFUSION (forward, dashed + faint): the block is added INTO the challenge
      // chain at cc ip. Distinct from the dependency arrows above.
      const fromY = inf.iccActive ? yICC - 7 : yRC - half;
      vArrow(ctx, ipX, fromY, yCC + 8, color, 1.2, true, 0.5);

      // text labels for the block nearest the playhead
      if (labelled) {
        ctx.font = "bold 11px ui-monospace, monospace";
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.fillText(`cc sp${n}`, spX, yCC - 12);
        ctx.fillText(`rc sp${n}`, spX, yRC + 26);
        ctx.fillText(`cc ip${n}`, ipX, yCC - 12);
        if (inf.iccActive && !inf.isChallengeBlock) ctx.fillText(`icc${n}`, ipX + 22, yICC + 4);
        ctx.textAlign = "left";
      }
    }

    // ---- transaction chain: gold arcs linking tx blocks (prev_transaction_block_hash) ----
    {
      const infByHeight = new Map<number, InfusionEvent>();
      for (const e of trace.events) if (e.kind === "infusion") infByHeight.set((e as InfusionEvent).blockHeight, e as InfusionEvent);
      for (const e of trace.events) {
        if (e.kind !== "infusion") continue;
        const inf = e as InfusionEvent;
        if (!inf.isTransactionBlock || inf.prevTxBlockHeight === null) continue;
        const prev = infByHeight.get(inf.prevTxBlockHeight);
        if (!prev) continue;
        const xPrev = xOf(prev.totalIters, w);
        const xCur = xOf(inf.totalIters, w);
        if ((xPrev < -20 && xCur < -20) || (xPrev > w + 20 && xCur > w + 20)) continue;
        // arrow from this tx block back to the previous (prev_transaction_block_hash)
        ctx.globalAlpha = 0.9;
        curveArrow(ctx, xCur, yRC + half + 3, xPrev, yRC + half + 3, (xPrev + xCur) / 2, yRC + half + 26, "#e3b341", 1.6);
        ctx.globalAlpha = 1;
      }
    }

    // ---- upcoming slot-change marker (the boundary the playhead approaches) ----
    {
      const curIdx = Math.min(trace.slots.length - 1, Math.floor(playheadIters / ssi));
      const curSlot = trace.slots[curIdx];
      const bX = xOf(curSlot.endIters, w);
      if (bX >= -2 && bX <= w + 2 && curIdx < trace.slots.length - 1) {
        const eos = trace.events.find((e) => e.kind === "end_of_sub_slot" && e.subSlot === curIdx) as
          | { hasIcc: boolean }
          | undefined;
        const folds = !!eos?.hasIcc;
        const col = folds ? CHAIN_COLORS.icc : "#d8efe2";
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(bX, 20);
        ctx.lineTo(bX, h - 24);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        const label = `slot change → c${curIdx + 1}${folds ? "  (icc folds in)" : ""}`;
        ctx.font = "bold 11px ui-monospace, monospace";
        const tw = ctx.measureText(label).width;
        const lx = bX + 6 + tw > w ? bX - 6 - tw : bX + 6;
        ctx.fillStyle = col;
        ctx.textAlign = "left";
        ctx.fillText(label, lx, 30);
      }
    }

    // ---- playhead ----
    const px = xOf(playheadIters, w);
    if (px >= 0 && px <= w) {
      ctx.strokeStyle = "#d8efe2";
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(px, 22);
      ctx.lineTo(px, h - 26);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // ---- caption ----
    const slotNow = Math.floor(playheadIters / ssi);
    ctx.fillStyle = "#6f9a85";
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText(
      `iter ${Math.round(playheadIters).toLocaleString()} / ${trace.totalItersEnd.toLocaleString()}   (sub-slot ${slotNow}, sp ${Math.floor((playheadIters % ssi) / interval)})`,
      6,
      h - 8,
    );
  }

  /** Nearest selectable element (block, signage point, end-of-sub-slot) near x, else null. */
  function nearestEvent(x: number): TimelordEvent | null {
    const { w } = sizeRef.current;
    let best: TimelordEvent | null = null;
    let bestDx = 9;
    for (const ev of trace.events) {
      // signage points are smaller targets; blocks/eos win ties via the loop order
      const dx = Math.abs(xOf(ev.totalIters, w) - x);
      const radius = ev.kind === "signage_point" ? 6 : 9;
      if (dx < radius && dx < bestDx) {
        bestDx = dx;
        best = ev;
      }
    }
    return best;
  }

  function pointerX(e: React.PointerEvent<HTMLCanvasElement>): number {
    return e.clientX - e.currentTarget.getBoundingClientRect().left;
  }

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const { w } = sizeRef.current;
        const x = pointerX(e);
        const hit = nearestEvent(x);
        if (hit) {
          onSelect(hit); // click an element to pin/unpin it in the panel
          onScrubTo(hit.totalIters);
        } else {
          onScrubTo(Math.max(0, Math.min(trace.totalItersEnd, itersOf(x, w))));
        }
      }}
      onPointerMove={(e) => {
        const { w } = sizeRef.current;
        const x = pointerX(e);
        if (e.buttons === 1) {
          onScrubTo(Math.max(0, Math.min(trace.totalItersEnd, itersOf(x, w)))); // drag = scrub
        } else {
          onHover(nearestEvent(x)); // plain move = hover highlight
        }
      }}
      style={{ cursor: "crosshair" }}
    />
  );
}
