import { useEffect, useMemo, useState } from "react";
import type { FarmingInfoEvent, PlotAttempt } from "./events.ts";
import { Tex } from "../ui/Math.tsx";

/**
 * The proof-of-space lottery as the function chain it actually is. A value flows,
 * card by card, through the real computation, and each card's RIGHT side shows
 * what that function processes — with real values:
 *
 *   🔍 plot filter   — the filter hash bits (leading zeros vs threshold)
 *   🌲 proof lookup  — T7 matches, the 64 leaf x-values, the matching quadratic
 *   🎲 required_iters— u = H(q‖sp)/2²⁵⁶ plugged into the iters formula
 *   🏁 window check  — required_iters against the window
 *
 * The chain stops where the algorithm stops (filter fail, or no T7 match).
 */
const STEP_MS = 720;
type CardKey = "filter" | "lookup" | "req" | "window";

interface CardView {
  key: CardKey;
  icon: string;
  title: string;
  formula: string;
  inLabel: string;
  inVal: string;
  outLabel: string;
  outVal: string;
  tone: "ok" | "stop" | "win" | "lose" | "info";
}

function buildCards(a: PlotAttempt, round: FarmingInfoEvent): { cards: CardView[]; lastReached: number } {
  const interval = round.interval ?? 64;
  const threshold = round.filterThreshold ?? 0;
  const ch = (round.challengeHex ?? round.challenge ?? "").slice(0, 12);
  const cards: CardView[] = [
    {
      key: "filter", icon: "🔍", title: "Plot filter",
      formula: `\\mathrm{lz}\\,H(\\mathrm{plot\\_id}\\,\\Vert\\,c\\,\\Vert\\,sp)\\ \\ge\\ ${threshold}`,
      inLabel: "challenge", inVal: `0x${ch}…`,
      outLabel: "leading zeros", outVal: `${a.filterBits} ${a.passed ? "≥" : "<"} ${threshold}`,
      tone: a.passed ? "ok" : "stop",
    },
    {
      key: "lookup", icon: "🌲", title: "Proof lookup",
      formula: `T_7 \\to T_1:\\ \\text{find } 64\\ x\\text{-values}`,
      inLabel: "table-7 match?", inVal: a.hasProof ? `${a.proof?.t7Matches ?? 1}` : "0",
      outLabel: "proof", outVal: a.hasProof ? "found" : "no T7 match — stop",
      tone: a.hasProof ? "ok" : "stop",
    },
    {
      key: "req", icon: "🎲", title: "required_iters",
      formula: `r=\\Big\\lfloor \\dfrac{\\Delta\\cdot 2^{20}\\cdot H(q\\Vert sp)}{2^{256}\\,S_k}\\Big\\rfloor`,
      inLabel: "H(q‖sp)", inVal: a.qualityHex ? `0x${a.qualityHex}` : "—",
      outLabel: "required_iters", outVal: a.requiredIters != null ? `${a.requiredIters}` : "—",
      tone: "info",
    },
    {
      key: "window", icon: "🏁", title: "Window check",
      formula: `r \\ <\\ ${interval}`,
      inLabel: "required_iters", inVal: a.requiredIters != null ? `${a.requiredIters}` : "—",
      outLabel: "result", outVal: a.win ? "WIN ✓" : a.windowFraction != null ? `lose · ${a.windowFraction.toFixed(2)}×` : "—",
      tone: a.win ? "win" : "lose",
    },
  ];
  const lastReached = !a.passed ? 0 : !a.hasProof ? 1 : 3;
  return { cards, lastReached };
}

function bitsOf(hex: string): string {
  return hex.split("").map((c) => parseInt(c, 16).toString(2).padStart(4, "0")).join("");
}

export function PosMachine({ round }: { round: FarmingInfoEvent | null }) {
  const focal = useMemo<PlotAttempt | null>(() => {
    const att = round?.attempts;
    if (!att || att.length === 0) return null;
    const survivors = att.filter((a) => a.passed);
    const winner = survivors.find((a) => a.win);
    if (winner) return winner;
    const withProof = survivors.filter((a) => a.windowFraction != null);
    if (withProof.length) return withProof.reduce((b, a) => (a.windowFraction! < b.windowFraction! ? a : b));
    if (survivors.length) return survivors[0];
    return att[0];
  }, [round]);

  const built = useMemo(() => (focal && round ? buildCards(focal, round) : null), [focal, round]);

  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!built) return;
    setActive(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      if (i > built.lastReached) return clearInterval(id);
      setActive(i);
    }, STEP_MS);
    return () => clearInterval(id);
  }, [round?.ts, built]);

  const interval = round?.interval ?? 64;
  const threshold = round?.filterThreshold ?? 0;
  const maxR = interval * 4;
  const pct = (r: number) => (Math.min(r, maxR) / maxR) * 100;
  const survivors = (round?.attempts ?? []).filter((a) => a.passed && a.requiredIters != null);
  const total = round?.totalPlots ?? 0;
  const passedCount = round?.passed ?? 0;

  if (!built || !focal) {
    return <div className="machine"><div className="machine-empty">waiting for a signage point…</div></div>;
  }
  const done = active >= built.lastReached;

  function viz(key: CardKey) {
    const a = focal!;
    if (key === "filter") {
      const bits = a.filterHex ? bitsOf(a.filterHex) : "";
      return (
        <div className="bits">
          {bits.split("").flatMap((b, i) => {
            const cells = [];
            if (i === threshold) cells.push(<span key={`t${i}`} className="bit-thresh" />);
            cells.push(<span key={i} className={`bit ${i < a.filterBits ? "lead" : b === "1" ? "one" : "zero"}`}>{b}</span>);
            return cells;
          })}
        </div>
      );
    }
    if (key === "lookup") {
      const p = a.proof;
      if (!a.hasProof || !p) return <div className="fn-dim" style={{ fontSize: 11 }}>no table-7 entry matched the challenge → the lookup stops at the top table, no proof.</div>;
      const sm = p.sampleMatch;
      return (
        <div className="pviz">
          <div className="pviz-head">T7 matches <b>{p.t7Matches}</b> · 64 leaves walked T7→T1 · proof {p.valid ? "✓" : "✗"}</div>
          <div className="pviz-leaves">
            {p.xs.map((x, i) => (
              <span key={i} className={`pleaf${i === p.qualityIndex || i === p.qualityIndex + 1 ? " q" : ""}`} title={`x[${i}] = ${x}`} />
            ))}
          </div>
          <div className="pviz-q">quality = H(c ‖ x[{p.qualityIndex}] ‖ x[{p.qualityIndex + 1}]) = <code>0x{p.qualityStrHex}…</code></div>
          {sm && sm.m >= 0 && (
            <div className="pviz-match">
              <span>one match · bucket {sm.bucket} → {sm.bucket + 1}:</span>{" "}
              <Tex expr={`(2\\cdot${sm.m}+${sm.parity})^2=${sm.sq}`} />{" "}
              <span className="fn-dim">y_L={sm.yL}, y_R={sm.yR} ⇒ bc_R={sm.bcR} ✓</span>
            </div>
          )}
        </div>
      );
    }
    if (key === "req") {
      const u = a.qualityHex ? parseInt(a.qualityHex, 16) / 2 ** 32 : null;
      return (
        <div className="rviz">
          <div className="rviz-row">u = H(q‖sp) / 2²⁵⁶ ≈ <b>{u != null ? u.toFixed(4) : "—"}</b></div>
          <div className="rviz-bar"><span style={{ width: `${(u ?? 0) * 100}%` }} /></div>
          <div className="rviz-row fn-dim">2²⁰ · u / S_k(=2176) = <b style={{ color: "var(--text)" }}>{a.requiredIters ?? "—"}</b></div>
        </div>
      );
    }
    // window
    const r = a.requiredIters;
    return (
      <div className="wgauge-wrap">
        <div className="wgauge">
          <div className="wgauge-zone" style={{ width: `${pct(interval)}%` }} />
          {r != null && <div className={`wgauge-needle${a.win ? " win" : ""}`} style={{ left: `${pct(r)}%` }} />}
        </div>
        <div className="wgauge-lab"><span style={{ color: "var(--cc)" }}>0…{interval} = WIN</span><span className="fn-dim">{maxR}+</span></div>
      </div>
    );
  }

  return (
    <div className="machine">
      <div className="machine-head">
        <b>{passedCount}</b> of {total} plots survived the filter · focal plot <b>#{focal.plotIndex}</b>
        {!focal.passed && <span className="fn-dim"> (filtered out)</span>}
      </div>

      <div className="machine-cards">
        {built.cards.map((c, i) => {
          const reached = i <= built.lastReached;
          const state = !reached ? "skip" : i < active ? "done" : i === active ? "active" : "pending";
          return (
            <div key={c.key} className={`fcard ${state} tone-${c.tone}`}>
              <div className="fcard-main">
                <div className="fcard-top">
                  <span className="fcard-icon">{c.icon}</span>
                  <span className="fcard-title">{c.title}</span>
                  <span className="fcard-step">ƒ{i + 1}</span>
                </div>
                <div className="fcard-formula"><Tex expr={c.formula} /></div>
                <div className="fcard-io">
                  <span className="chip in"><i>{c.inLabel}</i>{reached ? c.inVal : "—"}</span>
                  <span className="farrow">▶</span>
                  <span className="chip out"><i>{c.outLabel}</i>{reached ? c.outVal : "—"}</span>
                </div>
              </div>
              <div className="fcard-viz">{reached ? viz(c.key) : <span className="fn-dim" style={{ fontSize: 11 }}>not reached</span>}</div>
            </div>
          );
        })}
      </div>

      <div className="machine-meter">
        <div className="mm-label">
          <span style={{ color: "var(--cc)" }}>WIN ZONE</span>
          <span className="fn-dim">this round's survivors by required_iters · window = {interval}</span>
        </div>
        <div className="mm-track">
          <div className="mm-zone" style={{ width: `${pct(interval)}%` }} />
          {survivors.map((a, i) => (
            <div key={i} className={`mm-dot${a.win ? " win" : ""}${a === focal ? " focal" : ""}`} style={{ left: `${pct(a.requiredIters!)}%` }} title={`plot #${a.plotIndex}: r=${a.requiredIters}`} />
          ))}
        </div>
      </div>

      {done && (
        <div className={`machine-outcome ${focal.win ? "win" : focal.passed && focal.hasProof ? "lose" : "none"}`}>
          {focal.win
            ? `🏆 plot #${focal.plotIndex} WON — required_iters ${focal.requiredIters} < ${interval}`
            : !focal.passed
              ? `plot #${focal.plotIndex} eliminated by the filter`
              : !focal.hasProof
                ? `plot #${focal.plotIndex} passed the filter but had no T7 match — no proof`
                : `plot #${focal.plotIndex} missed by ${focal.windowFraction?.toFixed(2)}× the window`}
        </div>
      )}
    </div>
  );
}
