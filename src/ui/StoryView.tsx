import { useEffect, useRef } from "react";
import type { Actor, InspectKind, StoryStep } from "../sim/story.ts";

const ACTORS: { key: Actor; label: string; short: string; color: string }[] = [
  { key: "system", label: "Network", short: "Network", color: "#6f9a85" },
  { key: "timelord", label: "Timelord", short: "Timelord", color: "#3fb950" },
  { key: "farmer", label: "Farmer / Harvester", short: "Farmer", color: "#e3b341" },
  { key: "fullnode", label: "Full node", short: "Full node", color: "#58a6ff" },
];
const COLOR: Record<Actor, string> = Object.fromEntries(ACTORS.map((a) => [a.key, a.color])) as Record<Actor, string>;
const LABEL: Record<Actor, string> = Object.fromEntries(ACTORS.map((a) => [a.key, a.label])) as Record<Actor, string>;

const INSPECT_LABEL: Record<Exclude<InspectKind, null>, string> = {
  scan: "🔍 plot scan",
  proof: "🧬 proof of space",
  lock: "🔒 the lock",
  tx: "💸 tx blocks",
  vdf: "⏱ proof of time",
  plot: "🌳 the plot",
  infusion: "🌀 infusion",
};

export function StoryView({
  steps,
  index,
  setIndex,
  playing,
  setPlaying,
  onFocus,
  onInspect,
  onClose,
}: {
  steps: StoryStep[];
  index: number;
  setIndex: (i: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  onFocus: (playheadIter: number, blockHeight: number | null) => void;
  onInspect: (kind: InspectKind, blockHeight: number | null) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const step = steps[index];

  // focus the rest of the app (playhead + selected entity) on each step
  useEffect(() => {
    onFocus(step.playheadIter, step.blockHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // auto-advance
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setIndex(Math.min(steps.length - 1, indexRef.current + 1));
      if (indexRef.current >= steps.length - 1) setPlaying(false);
    }, 2600);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);
  const indexRef = useRef(index);
  indexRef.current = index;

  // keep the active list item in view
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  // keyboard nav
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIndex(Math.min(steps.length - 1, indexRef.current + 1));
      else if (e.key === "ArrowLeft") setIndex(Math.max(0, indexRef.current - 1));
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const w = host.clientWidth;
    const h = 200;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, w, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, index]);

  function draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = "#0c1410";
    ctx.fillRect(0, 0, w, h);
    const padL = 130;
    const padR = 24;
    const top = 26;
    const laneGap = (h - top - 20) / (ACTORS.length - 1);
    const laneY = (a: Actor) => top + ACTORS.findIndex((x) => x.key === a) * laneGap;
    const N = steps.length;
    const xAt = (i: number) => padL + ((i + 0.5) * (w - padL - padR)) / N;

    // lifelines + labels
    for (const a of ACTORS) {
      const y = laneY(a.key);
      ctx.strokeStyle = a.color;
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(padL - 8, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = a.color;
      ctx.font = "12px ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.fillText(a.short, padL - 14, y + 4);
    }
    ctx.textAlign = "left";

    // playhead column
    const px = xAt(index);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(px, top - 14);
    ctx.lineTo(px, h - 6);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < N; i++) {
      const s = steps[i];
      const x = xAt(i);
      const y = laneY(s.actor);
      const cur = i === index;
      const future = i > index;
      const alpha = cur ? 1 : future ? 0.16 : 0.45;
      // message arrow
      if (s.to && !future) {
        const y2 = laneY(s.to);
        ctx.strokeStyle = COLOR[s.actor];
        ctx.globalAlpha = cur ? 0.95 : 0.4;
        ctx.lineWidth = cur ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y2);
        ctx.stroke();
        const dir = y2 > y ? 1 : -1;
        ctx.fillStyle = COLOR[s.actor];
        ctx.beginPath();
        ctx.moveTo(x, y2);
        ctx.lineTo(x - 4, y2 - dir * 6);
        ctx.lineTo(x + 4, y2 - dir * 6);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // node
      ctx.globalAlpha = alpha;
      ctx.fillStyle = COLOR[s.actor];
      ctx.beginPath();
      ctx.arc(x, y, cur ? 6 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      if (cur) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  const badge = (a: Actor) => (
    <span style={{ background: COLOR[a], color: "#07140c", borderRadius: 4, padding: "2px 8px", fontWeight: 700, fontSize: 12 }}>{LABEL[a]}</span>
  );

  return (
    <div className="story-overlay">
      <div className="story-top">
        <h2 style={{ margin: 0, fontSize: 14 }}>PoST — guided story</h2>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>step {index + 1} / {steps.length} · sub-slot {step.subSlot}</span>
        <span style={{ flex: 1 }} />
        <button className="story-btn" onClick={onClose}>✕ close</button>
      </div>

      <div style={{ padding: "0 14px" }}>
        <canvas ref={canvasRef} style={{ width: "100%", display: "block" }} />
      </div>

      <div className="story-main">
        <div className="story-narrative">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            {badge(step.actor)}
            {step.to && <span style={{ color: "var(--muted)" }}>→ {LABEL[step.to]}</span>}
            <h3 style={{ margin: 0, fontSize: 16 }}>{step.title}</h3>
          </div>
          <p style={{ lineHeight: 1.7, color: "var(--text)", margin: "0 0 12px", fontSize: 13.5 }}>{step.narrative}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {step.facts.map((f) => (
              <span key={f.k} className="story-fact"><span style={{ color: "var(--muted)" }}>{f.k}</span> <b>{f.v}</b></span>
            ))}
          </div>
          {step.inspect && (
            <button className="story-inspect" onClick={() => onInspect(step.inspect, step.blockHeight)}>
              inspect in detail → {INSPECT_LABEL[step.inspect]}
            </button>
          )}
        </div>

        <div className="story-list" ref={listRef}>
          {steps.map((s, i) => (
            <button
              key={i}
              data-i={i}
              className={`story-list-item${i === index ? " active" : ""}`}
              onClick={() => { setPlaying(false); setIndex(i); }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 8, background: COLOR[s.actor], flex: "0 0 auto" }} />
              <span style={{ color: "var(--muted)", width: 18, textAlign: "right" }}>{i + 1}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="story-nav">
        <button className="story-btn" disabled={index === 0} onClick={() => { setPlaying(false); setIndex(Math.max(0, index - 1)); }}>◀ prev</button>
        <button className="story-btn primary" onClick={() => { if (index >= steps.length - 1) setIndex(0); setPlaying(!playing); }}>{playing ? "❚❚ pause" : "▶ play"}</button>
        <button className="story-btn" disabled={index === steps.length - 1} onClick={() => { setPlaying(false); setIndex(Math.min(steps.length - 1, index + 1)); }}>next ▶</button>
        <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>← → to navigate · Esc to close</span>
      </div>
    </div>
  );
}
