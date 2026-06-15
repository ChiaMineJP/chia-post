import { useEffect, useRef, useState } from "react";
import { POS, type PosForest } from "../sim/proofofspace.ts";
import { Tex } from "./Math.tsx";

export interface PlotMeta {
  plotIndex: number;
  farmerId: number;
  farmerColor: string;
  challengeHex: string;
  localPkHex: string;
  farmerPkHex: string;
  poolPkHex: string;
  plotPkHex: string;
  plotIdHex: string;
}

export function PlotModal({
  forest,
  path,
  meta,
  onClose,
}: {
  forest: PosForest;
  path: number[][] | null; // path[L] = proof's indices into forest[L]
  meta: PlotMeta;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<{ xAt: (L: number, i: number) => number; yAt: (L: number) => number } | null>(null);
  const [hover, setHover] = useState<{ L: number; i: number } | null>(null);
  const [step, setStep] = useState(POS.TABLES - 1); // revealed tables (0..6)
  const [playing, setPlaying] = useState(false);

  const lens = forest.map((t) => t.length);
  const proofSet = path ? path.map((idxs) => new Set(idxs)) : null;
  const bucket = (L: number, i: number) => Math.floor(forest[L][i].y / POS.BC);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setStep((s) => { if (s >= POS.TABLES - 1) { setPlaying(false); return s; } return s + 1; }), 700);
    return () => clearInterval(id);
  }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const w = host.clientWidth;
    const h = 440;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, w, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forest, path, hover, step]);

  function draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = "#0c1410";
    ctx.fillRect(0, 0, w, h);
    const padL = 60, padR = 22, top = 26, bottom = h - 26;
    const rowH = (bottom - top) / (POS.TABLES - 1);
    const xAt = (L: number, i: number) => padL + ((i + 0.5) * (w - padL - padR)) / Math.max(1, lens[L]);
    const yAt = (L: number) => bottom - L * rowH; // T1 bottom, T7 top
    layoutRef.current = { xAt, yAt };

    const hb = hover ? bucket(hover.L, hover.i) : -1;

    // rows: bucket separators + cells
    for (let L = 0; L <= step; L++) {
      // faint baseline
      ctx.strokeStyle = "#1f3a2d";
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(padL, yAt(L));
      ctx.lineTo(w - padR, yAt(L));
      ctx.stroke();
      ctx.globalAlpha = 1;
      // bucket separators
      let prevB = -1;
      for (let i = 0; i < lens[L]; i++) {
        const b = bucket(L, i);
        if (b !== prevB && i > 0) {
          const x = (xAt(L, i - 1) + xAt(L, i)) / 2;
          ctx.strokeStyle = "rgba(111,154,133,0.25)";
          ctx.beginPath();
          ctx.moveTo(x, yAt(L) - 6);
          ctx.lineTo(x, yAt(L) + 6);
          ctx.stroke();
        }
        prevB = b;
      }
    }

    // hovered bucket's matches: edges from buckets b & b+1 (table hover.L) to parents (table hover.L+1)
    if (hover && hover.L + 1 <= step && hover.L + 1 < POS.TABLES) {
      const L = hover.L;
      const parents = forest[L + 1];
      ctx.lineWidth = 1;
      for (let p = 0; p < parents.length; p++) {
        const e = parents[p];
        const lb = bucket(L, e.left!);
        const rb = bucket(L, e.right!);
        if (lb !== hb && rb !== hb) continue;
        ctx.strokeStyle = "rgba(88,166,255,0.7)";
        for (const ch of [e.left!, e.right!]) {
          ctx.beginPath();
          ctx.moveTo(xAt(L, ch), yAt(L));
          ctx.lineTo(xAt(L + 1, p), yAt(L + 1));
          ctx.stroke();
        }
      }
    }

    // proof path edges (always, for revealed tables)
    if (proofSet) {
      ctx.strokeStyle = meta.farmerColor;
      ctx.lineWidth = 1.4;
      for (let L = 1; L <= step; L++) {
        for (const p of path![L]) {
          const e = forest[L][p];
          for (const ch of [e.left!, e.right!]) {
            ctx.beginPath();
            ctx.moveTo(xAt(L, p), yAt(L));
            ctx.lineTo(xAt(L - 1, ch), yAt(L - 1));
            ctx.stroke();
          }
        }
      }
    }

    // cells
    for (let L = 0; L <= step; L++) {
      for (let i = 0; i < lens[L]; i++) {
        const x = xAt(L, i);
        const y = yAt(L);
        const inProof = proofSet?.[L].has(i);
        const inHoverBucket = hover && hover.L === L && (bucket(L, i) === hb || bucket(L, i) === hb + 1);
        let r = 1.6;
        if (inProof) { ctx.fillStyle = meta.farmerColor; r = 3; }
        else if (inHoverBucket) { ctx.fillStyle = "#58a6ff"; r = 2.4; }
        else { ctx.fillStyle = "#2f5944"; }
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // row labels
    ctx.textAlign = "right";
    ctx.font = "12px ui-monospace, monospace";
    for (let L = 0; L <= step; L++) {
      ctx.fillStyle = "#6f9a85";
      ctx.fillText(`T${L + 1}·${lens[L]}`, padL - 8, yAt(L) + 4);
    }
    ctx.textAlign = "left";
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const layout = layoutRef.current;
    if (!layout) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best: { L: number; i: number } | null = null;
    let bd = 8;
    for (let L = 0; L <= step; L++) {
      if (Math.abs(layout.yAt(L) - my) > 10) continue;
      for (let i = 0; i < lens[L]; i++) {
        const d = Math.abs(layout.xAt(L, i) - mx);
        if (d < bd) { bd = d; best = { L, i }; }
      }
    }
    setHover(best);
  }

  const total = lens.reduce((a, b) => a + b, 0);
  let caption: React.ReactNode = (
    <span style={{ color: "var(--muted)" }}>Hover a cell to light up its bucket and the matches it forms in the next table.</span>
  );
  if (hover) {
    const b = bucket(hover.L, hover.i);
    caption = (
      <span>
        T{hover.L + 1}, entry #{hover.i}: <code style={{ color: "#cfe3d6" }}>y={forest[hover.L][hover.i].y}</code> · bucket {b}.
        {" "}<span style={{ color: "#58a6ff" }}>Blue</span> = matches with bucket {b + 1} → T{hover.L + 2}.
      </span>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "min(1280px, 96vw)", width: "min(1280px, 96vw)" }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2>The plot — forest for plot #{meta.plotIndex}</h2>
        <p className="help" style={{ marginTop: 2 }}>
          This is the whole plot: 7 tables (<b>{total.toLocaleString()}</b> entries), sorted by y and grouped into buckets
          (faint ticks). Each table is built by matching adjacent buckets of the one below. The{" "}
          <b style={{ color: meta.farmerColor }}>coloured path</b> is the one proof a challenge picks out — a needle in this haystack.
          {" "}Forward-propagation only (no sort/compression phases). Hover a bucket to see its matches.
        </p>

        {/* what seeds this plot: the keys → plot_id → F1 */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "7px 12px", margin: "2px 0 8px", fontSize: 12, lineHeight: 1.8 }}>
          <div style={{ color: "var(--muted)", marginBottom: 2 }}>What makes this plot look like it: the keys seed everything.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0 22px" }}>
            <span>local_pk (harvester) <code>{meta.localPkHex}</code></span>
            <span>farmer_pk (#{meta.farmerId}) <code>{meta.farmerPkHex}</code></span>
            <span>pool_pk <code>{meta.poolPkHex}</code></span>
          </div>
          <div style={{ marginTop: 2 }}>
            <Tex expr={"\\mathrm{plot\\_pk}=\\mathrm{local\\_pk}\\oplus\\mathrm{farmer\\_pk}"} /> = <code>{meta.plotPkHex}</code>
            {"  ·  "}
            <Tex expr={"\\mathrm{plot\\_id}=H(\\mathrm{pool\\_pk}\\Vert\\mathrm{plot\\_pk})"} /> = <code style={{ color: meta.farmerColor }}>{meta.plotIdHex}</code>
          </div>
          <div style={{ marginTop: 2, color: "var(--muted)" }}>
            <Tex expr={"f_1(x)=H(\\mathrm{plot\\_id}\\Vert x)"} /> seeds T1, and every table above — so change any key → a different plot_id → a completely different forest.
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 6px" }}>
          <b style={{ color: "var(--text)" }}>Buckets</b> (faint ticks): <Tex expr={`\\mathrm{bk}(y)=\\lfloor y/${POS.BC}\\rfloor`} /> slices the
          y-axis into blocks of {POS.BC}. Two entries match <b>only across adjacent buckets</b> (b → b+1), so a sorted table
          is matched by a neighbour scan, not all-pairs.
        </div>
        <div style={{ width: "100%" }}>
          <canvas ref={canvasRef} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ width: "100%", display: "block", cursor: "crosshair" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <button
            onClick={() => { if (step >= POS.TABLES - 1) setStep(0); setPlaying((q) => !q); }}
            style={{ background: "var(--cc)", color: "#07140c", border: "none", borderRadius: 5, padding: "4px 12px", cursor: "pointer", fontWeight: 600 }}
          >
            {playing ? "❚❚ pause" : "▶ build"}
          </button>
          <button onClick={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }} style={sbtn}>− table</button>
          <button onClick={() => { setPlaying(false); setStep((s) => Math.min(POS.TABLES - 1, s + 1)); }} style={sbtn}>table +</button>
          <input type="range" min={0} max={POS.TABLES - 1} value={step} onChange={(e) => { setPlaying(false); setStep(Number(e.target.value)); }} style={{ flex: 1, accentColor: "var(--cc)" }} />
          <span style={{ color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>built T1…T{step + 1}</span>
        </div>
        <div style={{ fontSize: 12, marginTop: 6, minHeight: 18 }}>{caption}</div>
      </div>
    </div>
  );
}

const sbtn: React.CSSProperties = { background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 5, padding: "4px 9px", cursor: "pointer", font: "inherit" };
