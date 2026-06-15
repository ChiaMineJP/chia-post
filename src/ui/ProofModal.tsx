import { useEffect, useRef, useState } from "react";
import type { Proof } from "../sim/proofofspace.ts";
import { POS } from "../sim/proofofspace.ts";
import { Tex } from "./Math.tsx";

export interface ProofMeta {
  blockHeight: number;
  plotIndex: number;
  challengeHex: string;
  farmerColor: string;
  tableSizes: number[];
}

interface Layout {
  xAt: (level: number, i: number) => number;
  yAt: (level: number) => number;
}

/** Replay the matching inner loop for one pair: bucket coords + the m-search. */
function mSearch(yL: number, yR: number) {
  const bucketL = Math.floor(yL / POS.BC), bucketR = Math.floor(yR / POS.BC);
  const bcL = yL % POS.BC, bcR = yR % POS.BC;
  const bL = Math.floor(bcL / POS.C), cL = bcL % POS.C, bR = Math.floor(bcR / POS.C), cR = bcR % POS.C;
  const parity = bucketL % 2;
  const adjacent = bucketR === bucketL + 1;
  const trials: { m: number; bTarget: number; cTarget: number; bOk: boolean; cOk: boolean; ok: boolean }[] = [];
  let winner = -1;
  for (let m = 0; m < POS.EXTRA_POW; m++) {
    const bTarget = (bL + m) % POS.B;
    const cTarget = (((2 * m + parity) ** 2) + cL) % POS.C;
    const bOk = bR === bTarget, cOk = cR === cTarget;
    const ok = adjacent && bOk && cOk;
    trials.push({ m, bTarget, cTarget, bOk, cOk, ok });
    if (ok && winner < 0) winner = m;
  }
  return { bucketL, bucketR, bL, cL, bR, cR, parity, adjacent, trials, winner };
}

export function ProofModal({ proof, meta, onClose }: { proof: Proof; meta: ProofMeta; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<Layout | null>(null);
  const [hover, setHover] = useState<{ L: number; i: number } | null>(null);

  const levels = proof.levels;
  const nLevels = levels.length; // 7 (T1..T7)
  const LEN = levels.map((l) => l.length); // [64,32,16,8,4,2,1]
  // linear progress p over every match: 0 = only T1 leaves; +1 reveals the next
  // node (one match); TOTAL = full tree. OFFSET[L] = matches before level L.
  const OFFSET: number[] = [];
  OFFSET[1] = 0;
  for (let L = 2; L < nLevels; L++) OFFSET[L] = OFFSET[L - 1] + LEN[L - 1];
  const TOTAL = (OFFSET[nLevels - 1] ?? 0) + LEN[nLevels - 1]; // 63
  const BOUNDS: number[] = [0]; // table completion points
  for (let L = 1; L < nLevels; L++) BOUNDS.push(OFFSET[L] + LEN[L]); // [0,32,48,56,60,62,63]

  const [p, setP] = useState(TOTAL);
  const [playing, setPlaying] = useState(false);
  const [mShown, setMShown] = useState(POS.EXTRA_POW); // m-trials revealed in the current match's inner loop

  const revealedAt = (L: number) => (L === 0 ? LEN[0] : Math.max(0, Math.min(LEN[L], p - OFFSET[L])));
  // the match currently being processed (the node just revealed at p)
  const op = (() => {
    if (p <= 0) return null;
    const k = p - 1;
    let L = 1;
    while (L + 1 < nLevels && OFFSET[L + 1] <= k) L++;
    return { L, idx: k - OFFSET[L] };
  })();

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setP((q) => { if (q >= TOTAL) { setPlaying(false); return TOTAL; } return q + 1; });
    }, 130);
    return () => clearInterval(id);
  }, [playing, TOTAL]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const w = host.clientWidth;
    const h = 400;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, w, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proof, hover, p]);

  function draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = "#0c1410";
    ctx.fillRect(0, 0, w, h);
    const padL = 66;
    const padR = 30;
    const top = 36;
    const bottom = h - 48;
    const rowH = (bottom - top) / (nLevels - 1);
    const xAt = (level: number, i: number) => padL + ((i + 0.5) * (w - padL - padR)) / LEN[level];
    const yAt = (level: number) => bottom - level * rowH;
    layoutRef.current = { xAt, yAt };

    // edges
    for (let L = 1; L < nLevels; L++) {
      const rev = revealedAt(L);
      for (let i = 0; i < rev; i++) {
        const ok = proof.matchOk[L - 1]?.[i] ?? false;
        const isHov = hover && ((hover.L === L && hover.i === i) || (hover.L === L - 1 && (hover.i === 2 * i || hover.i === 2 * i + 1)));
        const cur = op?.L === L && op.idx === i;
        ctx.strokeStyle = isHov || cur ? "#ffffff" : ok ? "rgba(63,185,80,0.6)" : "rgba(255,123,114,0.9)";
        ctx.lineWidth = isHov || cur ? 2.5 : 1;
        for (const c of [2 * i, 2 * i + 1]) {
          ctx.beginPath();
          ctx.moveTo(xAt(L, i), yAt(L));
          ctx.lineTo(xAt(L - 1, c), yAt(L - 1));
          ctx.stroke();
        }
      }
    }

    // nodes
    for (let L = 0; L < nLevels; L++) {
      const count = LEN[L];
      const rev = revealedAt(L);
      for (let i = 0; i < rev; i++) {
        const x = xAt(L, i);
        const y = yAt(L);
        const isQ = L === 0 && (i === proof.qualityIndex || i === proof.qualityIndex + 1);
        const isRoot = L === nLevels - 1;
        const isHov = hover && hover.L === L && hover.i === i;
        const isCur = op?.L === L && op.idx === i;
        ctx.fillStyle = isRoot ? (proof.valid ? "#3fb950" : "#ff7b72") : isQ ? "#f778ba" : meta.farmerColor;
        ctx.beginPath();
        ctx.arc(x, y, isRoot ? 9 : isQ ? 7 : count <= 32 ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
        if (isHov || isCur) {
          ctx.strokeStyle = isCur ? "#ffffff" : "rgba(255,255,255,0.6)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, 10, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (count <= 32) {
          ctx.fillStyle = isQ ? "#f778ba" : "#cfe3d6";
          ctx.font = `${count <= 16 ? 13 : 11}px ui-monospace, monospace`;
          ctx.textAlign = "center";
          ctx.fillText(String(levels[L][i]), x, y - 11);
        }
        if (isQ) {
          ctx.fillStyle = "#f778ba";
          ctx.font = "bold 12px ui-monospace, monospace";
          const isLeft = i === proof.qualityIndex;
          ctx.textAlign = isLeft ? "right" : "left";
          ctx.fillText(`x=${proof.xs[i]}`, x + (isLeft ? -6 : 6), y + 20);
          ctx.textAlign = "left";
        }
      }
    }

    ctx.textAlign = "right";
    ctx.font = "12px ui-monospace, monospace";
    for (let L = 0; L < nLevels; L++) {
      if (L !== 0 && revealedAt(L) === 0) continue;
      ctx.fillStyle = op?.L === L ? "#cfe3d6" : "#6f9a85";
      const label = L === nLevels - 1 ? "T7·root" : `T${L + 1}·${LEN[L]}`;
      ctx.fillText(label, padL - 10, yAt(L) + 4);
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
    let bd = 13;
    for (let L = 0; L < nLevels; L++) {
      const rev = revealedAt(L);
      for (let i = 0; i < rev; i++) {
        const d = Math.hypot(layout.xAt(L, i) - mx, layout.yAt(L) - my);
        if (d < bd) { bd = d; best = { L, i }; }
      }
    }
    setHover(best);
  }

  const totalMatches = TOTAL;
  const matchesOk = proof.matchOk.reduce((a, row) => a + row.filter(Boolean).length, 0);
  const rootOk = proof.rootTopK === proof.challengeTopK;
  const totalEntries = meta.tableSizes.reduce((a, b) => a + b, 0);
  const maxSize = Math.max(1, ...meta.tableSizes);
  const lookups = (1 << POS.TABLES) - 1;
  const buildOps = meta.tableSizes.slice(0, POS.TABLES - 1).reduce((a, b) => a + b, 0) * POS.EXTRA_POW + (1 << POS.K);

  // which match to break down: a hovered internal node, else the current step
  const focus = hover && hover.L >= 1 ? { L: hover.L, i: hover.i } : op ? { L: op.L, i: op.idx } : null;
  const hoverLeaf = hover && hover.L === 0 ? hover.i : null;
  // reveal the whole inner loop by default; ◀/▶ replay it trial by trial
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => { setMShown(POS.EXTRA_POW); }, [p, focus?.L, focus?.i]);

  // live caption for the current match (the micro step)
  let stepCaption: React.ReactNode;
  if (!op) {
    stepCaption = <>T1 — the 64 leaf x-values, each gives <Tex expr={"y=f_1(\\mathrm{id},x)"} />. Step the matches up the tree →</>;
  } else {
    const { L, idx } = op;
    const yL = levels[L - 1][2 * idx];
    const yR = levels[L - 1][2 * idx + 1];
    const ok = proof.matchOk[L - 1][idx];
    const mark = ok ? "\\textcolor{#3fb950}{\\checkmark}" : "\\textcolor{#ff7b72}{\\times}";
    const atRoot = L === nLevels - 1 && idx === 0;
    stepCaption = (
      <span>
        <b>match {idx + 1}/{LEN[L]}</b> · T{L} → T{L + 1}: &nbsp;
        <Tex expr={`\\mathrm{bk}(${yL})=${Math.floor(yL / POS.BC)},\\ \\mathrm{bk}(${yR})=${Math.floor(yR / POS.BC)},\\ \\mathrm{match}=${mark},\\ f_x=${levels[L][idx]}`} />
        {atRoot && (
          <> → root top-{POS.K} {rootOk ? "=" : "≠"} challenge → <b style={{ color: proof.valid ? "#3fb950" : "#ff7b72" }}>{proof.valid ? "VALID" : "INVALID"}</b></>
        )}
      </span>
    );
  }

  const sbtn: React.CSSProperties = { background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 5, padding: "4px 9px", cursor: "pointer", font: "inherit" };
  const nextBound = () => BOUNDS.find((b) => b > p) ?? TOTAL;
  const prevBound = () => [...BOUNDS].reverse().find((b) => b < p) ?? 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "min(1280px, 96vw)", width: "min(1280px, 96vw)" }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2>Proof of space — block B{meta.blockHeight + 1}, plot #{meta.plotIndex}</h2>
        <p className="help" style={{ marginTop: 2 }}>
          The proof is just <b>64 leaf x-values</b> (bottom). Verify it cheaply — no plot — by re-deriving the tree
          upward, checking each match. Step <b>match by match</b> or <b>table by table</b>; hover any node for its check.
        </p>
        <p className="help" style={{ marginTop: 2 }}>
          <b style={{ color: "#f778ba" }}>x</b> = a leaf value (the proof itself, only on T1) ·{" "}
          <b style={{ color: "#cfe3d6" }}>y</b> = a node's f-value, <Tex expr={"y=f_1(x)"} /> at leaves, <Tex expr={"y=f_x(y_L,y_R)"} /> above ·{" "}
          <b style={{ color: "#cfe3d6" }}>y_L, y_R</b> = the two children's <b>y</b> in a match (R one bucket above L).
        </p>
        <div style={{ width: "100%" }}>
          <canvas ref={canvasRef} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ width: "100%", display: "block", cursor: "crosshair" }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <button
            onClick={() => { if (p >= TOTAL) setP(0); setPlaying((q) => !q); }}
            style={{ background: "var(--cc)", color: "#07140c", border: "none", borderRadius: 5, padding: "4px 12px", cursor: "pointer", fontWeight: 600 }}
          >
            {playing ? "❚❚ pause" : "▶ build"}
          </button>
          <button onClick={() => { setPlaying(false); setP((q) => Math.max(0, q - 1)); }} style={sbtn} title="one match back">− match</button>
          <button onClick={() => { setPlaying(false); setP((q) => Math.min(TOTAL, q + 1)); }} style={sbtn} title="one match forward">match +</button>
          <button onClick={() => { setPlaying(false); setP(prevBound()); }} style={sbtn} title="previous table">◁ table</button>
          <button onClick={() => { setPlaying(false); setP(nextBound()); }} style={sbtn} title="next table">table ▷</button>
          <input type="range" min={0} max={TOTAL} value={p} onChange={(e) => { setPlaying(false); setP(Number(e.target.value)); }} style={{ flex: 1, accentColor: "var(--cc)" }} />
          <span style={{ color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>match {p}/{TOTAL} · T{op ? op.L + 1 : 1}</span>
        </div>
        <div style={{ fontSize: 12, marginTop: 4, minHeight: 18, color: "#cfe3d6" }}>{stepCaption}</div>

        {/* the inner loop of one match, broken into intermediate steps */}
        <div className="match-detail">
          {hoverLeaf !== null ? (
            <div>leaf #{hoverLeaf}: <Tex expr={`f_1(\\mathrm{id},\\,${proof.xs[hoverLeaf]}) = ${levels[0][hoverLeaf]}`} /></div>
          ) : !focus ? (
            <div style={{ color: "var(--muted)" }}>Step to a match (or hover an internal node) to break down its computation.</div>
          ) : (() => {
            const { L, i } = focus;
            const yL = levels[L - 1][2 * i];
            const yR = levels[L - 1][2 * i + 1];
            const s = mSearch(yL, yR);
            return (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 18px", alignItems: "center" }}>
                  <span><b style={{ color: "var(--muted)" }}>1. pair</b> <Tex expr={`y_L=${yL},\\ y_R=${yR}`} /></span>
                  <span><b style={{ color: "var(--muted)" }}>2. buckets</b> <Tex expr={`\\mathrm{bk}(y_L)=${s.bucketL},\\ \\mathrm{bk}(y_R)=${s.bucketR}`} /> {s.adjacent ? <b style={{ color: "#3fb950" }}>adjacent ✓</b> : <b style={{ color: "#ff7b72" }}>not adjacent ✗</b>}</span>
                  <span><b style={{ color: "var(--muted)" }}>3. coords</b> <Tex expr={`(b_L,c_L)=(${s.bL},${s.cL}),\\ (b_R,c_R)=(${s.bR},${s.cR}),\\ \\pi=${s.parity}`} /></span>
                </div>
                <div style={{ margin: "6px 0 3px", color: "var(--muted)" }}>
                  4. m-search — need <Tex expr={`b_R=(b_L{+}m)\\bmod ${POS.B}\\ \\wedge\\ c_R=((2m{+}\\pi)^2{+}c_L)\\bmod ${POS.C}`} />:
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                  {s.trials.slice(0, mShown).map((t) => (
                    <span
                      key={t.m}
                      title={`m=${t.m}: b → ${t.bTarget} ${t.bOk ? "✓" : "✗"}, c → ${t.cTarget} ${t.cOk ? "✓" : "✗"}`}
                      style={{
                        fontFamily: "ui-monospace, monospace", fontSize: 11, padding: "1px 6px", borderRadius: 3,
                        background: t.ok ? "#3fb950" : t.bOk ? "rgba(210,153,34,0.22)" : "var(--panel-2)",
                        color: t.ok ? "#07140c" : "var(--muted)",
                        border: `1px solid ${t.ok ? "#3fb950" : "var(--line)"}`,
                      }}
                    >
                      m={t.m}{t.ok ? " ✓" : t.bOk ? " b✓c✗" : ""}
                    </span>
                  ))}
                  <button onClick={() => setMShown((q) => Math.max(1, q - 1))} style={{ ...sbtn, padding: "1px 7px" }} title="hide last trial">◀ m</button>
                  <button onClick={() => setMShown((q) => Math.min(POS.EXTRA_POW, q + 1))} style={{ ...sbtn, padding: "1px 7px" }} title="reveal next trial">m ▶</button>
                </div>
                <div style={{ marginTop: 5 }}>
                  <b style={{ color: "var(--muted)" }}>5. result</b>{" "}
                  {s.winner >= 0 ? (
                    <span><b style={{ color: "#3fb950" }}>match at m={s.winner}</b> → <Tex expr={`f_x(${L + 1},${yL},${yR})=${levels[L][i]}`} /></span>
                  ) : (
                    <b style={{ color: "#ff7b72" }}>no m in [0,{POS.EXTRA_POW}) works → not a valid match ✗</b>
                  )}
                </div>
              </>
            );
          })()}
        </div>

        <div className="defs">
          <div><span className="def-label">F1</span><Tex expr={`f_1(x)=\\big(H(\\mathrm{id}\\Vert x)\\bmod 2^{${POS.F_BITS - POS.EXTRA_BITS}}\\big)2^{${POS.EXTRA_BITS}}+\\lfloor x/2^{${POS.K - POS.EXTRA_BITS}}\\rfloor`} /></div>
          <div><span className="def-label">Fx</span><Tex expr={`f_x(t,y_L,y_R)=\\lfloor H(t\\Vert y_L\\Vert y_R)\\rfloor_{\\text{top }${POS.F_BITS}}`} /></div>
          <div><span className="def-label">bucket</span><Tex expr={`\\mathrm{bk}(y){=}\\lfloor y/${POS.BC}\\rfloor,\\ b{=}\\lfloor(y\\bmod ${POS.BC})/${POS.C}\\rfloor,\\ c{=}(y\\bmod ${POS.BC})\\bmod ${POS.C}`} /></div>
          <div><span className="def-label">match</span><Tex expr={`\\mathrm{bk}(y_R){=}\\mathrm{bk}(y_L){+}1\\,\\wedge\\,\\exists m{<}${POS.EXTRA_POW}:\\,b_R{-}b_L{\\equiv}m,\\ c_R{-}c_L{\\equiv}(2m{+}\\pi)^2`} /></div>
          <div><span className="def-label">quality</span><Tex expr={"Q=H(\\mathrm{ch}\\Vert x_i\\Vert x_{i+1})"} /></div>
        </div>

        <div className="tradeoff">
          <div className="tradeoff-col">
            <h3>How to verify (cheap — no plot)</h3>
            <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7, color: "var(--muted)" }}>
              <li>Recompute <Tex expr={"y_i = f_1(\\mathrm{plot\\_id}, x_i)"} /> for the 64 leaves.</li>
              <li>Walk up: each parent needs <Tex expr={"\\mathrm{bk}(y_R)=\\mathrm{bk}(y_L){+}1"} /> and the quadratic match.
                {" "}<b style={{ color: matchesOk === totalMatches ? "#3fb950" : "#ff7b72" }}>{matchesOk}/{totalMatches} hold</b>.</li>
              <li>Root's top {POS.K} bits must equal the challenge's.
                {" "}<b style={{ color: rootOk ? "#3fb950" : "#ff7b72" }}>{proof.rootTopK} {rootOk ? "=" : "≠"} {proof.challengeTopK}</b>.</li>
            </ol>
            <div style={{ marginTop: 6 }}>
              <span style={{ color: proof.valid ? "#3fb950" : "#ff7b72", fontWeight: 700 }}>{proof.valid ? "✓ VALID" : "✗ INVALID"}</span>
              <span style={{ color: "var(--muted)" }}> — valid iff steps 2 &amp; 3 both pass (~{lookups} hashes total).</span>
            </div>
            <div className="help" style={{ marginTop: 4 }}>
              <Tex expr={`\\textcolor{#f778ba}{Q} = H(\\mathrm{ch} \\Vert x_{${proof.qualityIndex}}{=}${proof.xs[proof.qualityIndex]} \\Vert x_{${proof.qualityIndex + 1}}{=}${proof.xs[proof.qualityIndex + 1]})`} />
              {" = "}<code>{proof.qualityHex.slice(0, 16)}…</code>
            </div>
          </div>
          <div className="tradeoff-col">
            <h3>Why it proves space (memory ⇄ time)</h3>
            <div className="tbars">
              {meta.tableSizes.map((s, i) => (
                <div key={i} className="tbar-wrap" title={`T${i + 1}: ${s} entries`}>
                  <div className="tbar" style={{ height: `${Math.round((s / maxSize) * 36) + 4}px` }} />
                  <span>T{i + 1}</span>
                </div>
              ))}
            </div>
            <div className="help" style={{ marginTop: 4, lineHeight: 1.6 }}>
              The <b>prover</b> stored the forest (<b style={{ color: "var(--text)" }}>{totalEntries.toLocaleString()}</b> entries) to FIND this proof.
              The <b>verifier</b> just re-walks the 64 leaves (~{lookups} hashes). Without the stored plot, the prover would
              recompute ≈ <b>{buildOps.toLocaleString()}</b> ops per challenge — at mainnet k=32 that's ≈ 2³², hopeless. Keeping the
              space <i>is</i> the proof.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
