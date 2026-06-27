/**
 * The PoST Lab walkthrough: a granular, click-driven sequence of steps that takes
 * one signage point all the way through Proof of Time, Proof of Space, the
 * iteration math, and the BLS signature — with the real computed values and the
 * governing formula shown at every step. Several steps carry their own internal
 * stepper (the VDF squarings, the table propagation, the double-and-add ladder)
 * so the slow, mechanical parts can be walked rung by rung.
 */
import { useState } from "react";
import { Tex } from "../ui/Math.tsx";
import { discriminantOf } from "../crypto/classgroup.ts";
import { POS } from "../sim/proofofspace.ts";
import type { PipelineRun } from "./runPipeline.ts";
import type { BlsTrace, G1Affine, G2Affine } from "./blsTrace.ts";

export type Phase = "SP" | "POT" | "FILTER" | "LOOKUP" | "QUALITY" | "WINDOW" | "BLS";

export const PHASES: { key: Phase; label: string; icon: string }[] = [
  { key: "SP", label: "Signage point", icon: "📡" },
  { key: "POT", label: "Proof of Time", icon: "⏱" },
  { key: "FILTER", label: "Plot filter", icon: "🔍" },
  { key: "LOOKUP", label: "Proof lookup", icon: "🌲" },
  { key: "QUALITY", label: "Quality → iters", icon: "🎲" },
  { key: "WINDOW", label: "Window & infusion", icon: "🏁" },
  { key: "BLS", label: "BLS signing", icon: "✍️" },
];

export interface StepDef {
  id: string;
  phase: Phase;
  title: string;
}

export const STEPS: StepDef[] = [
  { id: "sp", phase: "SP", title: "A signage point arrives" },
  { id: "pot-disc", phase: "POT", title: "Challenge → discriminant & generator" },
  { id: "pot-square", phase: "POT", title: "Sequential squaring — the delay" },
  { id: "pot-verify", phase: "POT", title: "Cheap to verify — n-wesolowski" },
  { id: "filter", phase: "FILTER", title: "Plot filter — who even looks?" },
  { id: "f1", phase: "LOOKUP", title: "Table 1: f1 seeds the forest" },
  { id: "match", phase: "LOOKUP", title: "The matching condition (2m+parity)²" },
  { id: "propagate", phase: "LOOKUP", title: "Tables 2→7: forward propagation" },
  { id: "t7", phase: "LOOKUP", title: "Find the T7 entry matching the challenge" },
  { id: "backptr", phase: "LOOKUP", title: "Walk back to the 64 x-values" },
  { id: "verify-pos", phase: "LOOKUP", title: "Re-propagate: the proof checks out" },
  { id: "quality", phase: "QUALITY", title: "Quality string from two leaves" },
  { id: "req", phase: "QUALITY", title: "quality → required_iters" },
  { id: "window", phase: "WINDOW", title: "Does it fit the signage-point window?" },
  { id: "infusion", phase: "WINDOW", title: "Infusion point ip_iters" },
  { id: "bls-split", phase: "BLS", title: "The split plot key on G1" },
  { id: "bls-hash", phase: "BLS", title: "Hash the message onto G2" },
  { id: "bls-sign", phase: "BLS", title: "Sign = scalar multiplication" },
  { id: "bls-agg", phase: "BLS", title: "Aggregate the partial signatures" },
  { id: "bls-verify", phase: "BLS", title: "Verify with the pairing" },
];

// ── small formatting helpers ─────────────────────────────────────────────────
function fp(n: bigint): string {
  const neg = n < 0n;
  const h = (neg ? -n : n).toString(16);
  const body = h.length <= 20 ? h : `${h.slice(0, 12)}…${h.slice(-6)}`;
  return `${neg ? "−" : ""}0x${body}`;
}
function dec(n: bigint, head = 16): string {
  const s = n.toString();
  return s.length <= head + 4 ? s : `${s.slice(0, head)}…(${s.length} digits)`;
}
function bitsOf(hex: string): string {
  return hex.split("").map((c) => parseInt(c, 16).toString(2).padStart(4, "0")).join("");
}

function Fp2Line({ e, label }: { e: { c0: bigint; c1: bigint }; label: string }) {
  return (
    <div className="lab-coord">
      <span className="lab-coord-k">{label}</span>
      <code>{fp(e.c0)}</code> <span className="lab-dim">+</span> <code>{fp(e.c1)}</code>
      <span className="lab-dim"> · u</span>
    </div>
  );
}
function G1Card({ p, title, tone }: { p: G1Affine; title: string; tone?: string }) {
  return (
    <div className={`lab-pt ${tone ?? ""}`}>
      <div className="lab-pt-h">{title} <span className="lab-dim">∈ G₁ (F_p)</span></div>
      <div className="lab-coord"><span className="lab-coord-k">x</span><code>{fp(p.x)}</code></div>
      <div className="lab-coord"><span className="lab-coord-k">y</span><code>{fp(p.y)}</code></div>
    </div>
  );
}
function G2Card({ p, title, tone }: { p: G2Affine; title: string; tone?: string }) {
  return (
    <div className={`lab-pt ${tone ?? ""}`}>
      <div className="lab-pt-h">{title} <span className="lab-dim">∈ G₂ (F_p²)</span></div>
      <Fp2Line e={p.x} label="x" />
      <Fp2Line e={p.y} label="y" />
    </div>
  );
}

// ── internal steppers ────────────────────────────────────────────────────────
function MiniNav({ i, n, set, unit }: { i: number; n: number; set: (v: number) => void; unit: string }) {
  return (
    <div className="lab-mininav">
      <button onClick={() => set(0)} disabled={i <= 0}>⏮</button>
      <button onClick={() => set(Math.max(0, i - 1))} disabled={i <= 0}>− 1</button>
      <span className="lab-mininav-read">{unit} <b>{i}</b> / {n}</span>
      <button onClick={() => set(Math.min(n, i + 1))} disabled={i >= n}>+ 1</button>
      <button onClick={() => set(Math.min(n, i + 8))} disabled={i >= n}>+ 8</button>
      <button onClick={() => set(n)} disabled={i >= n}>⏭</button>
      <input type="range" min={0} max={n} value={i} onChange={(e) => set(Number(e.target.value))} />
    </div>
  );
}

function VdfStepper({ run }: { run: PipelineRun }) {
  const { vdf, sp } = run;
  const T = vdf.subSlotIters;
  const focalIter = sp.spIndex * vdf.interval;
  const [i, setI] = useState(focalIter);
  const f = vdf.forms[Math.min(i, T)];
  const disc = discriminantOf(f);
  const ok = disc === vdf.D;
  const spHere = i % vdf.interval === 0 ? i / vdf.interval : null;
  return (
    <div className="lab-stepbox">
      <div className="lab-row-between">
        <div>iteration <b className="lab-accent">{i}</b> <span className="lab-dim">/ {T}</span>
          {spHere !== null && <span className="lab-tag icc"> ← signage point {spHere}{spHere === sp.spIndex ? " (this one)" : ""}</span>}
        </div>
        <Tex expr={i === 0 ? "y_0 = g" : `y_{${i}} = y_{${i - 1}}^{2} = g^{\\,2^{${i}}}`} />
      </div>
      <div className="lab-dim" style={{ margin: "6px 0 2px" }}>the running value <Tex expr={`y_{${i}}`} /> <i>is</i> this reduced form <Tex expr={"(a,b,c)"} />:</div>
      <div className="lab-mono">
        <div><span className="lab-dim">a =</span> <b className="lab-accent">{f.a.toString()}</b></div>
        <div><span className="lab-dim">b =</span> <b className="lab-accent">{f.b.toString()}</b></div>
        <div><span className="lab-dim">c =</span> <b className="lab-accent">{dec(f.c, 40)}</b></div>
      </div>
      <div className={ok ? "lab-ok" : "lab-bad"} style={{ marginTop: 6 }}>
        <Tex expr={"b^2 - 4ac = \\Delta"} /> — still a reduced element of the same class group {ok ? "✓" : "✗"}
      </div>
      <MiniNav i={i} n={T} set={setI} unit="iter" />
      <p className="lab-help">Each squaring needs the previous result — you cannot skip ahead or parallelize, so completing all {T} steps is what proves the time elapsed. The signage point this run uses is the form at iteration {focalIter}.</p>
    </div>
  );
}

function PropagationStepper({ run }: { run: PipelineRun }) {
  const proof = run.lookup.proof;
  const [t, setT] = useState(1); // table 1..7
  const level = proof.levels[t - 1];
  const oks = t > 1 ? proof.matchOk[t - 2] : null;
  return (
    <div className="lab-stepbox">
      <div className="lab-row-between">
        <div>table <b className="lab-accent">T{t}</b> — <b>{level.length}</b> {level.length === 1 ? "entry (the root)" : "entries"}</div>
        <Tex expr={t === 1 ? "y = f_1(x)" : `f_${t}(y_L,y_R) = \\text{top bits of } H(${t}\\Vert y_L\\Vert y_R)`} />
      </div>
      {t === 1 ? (
        <p className="lab-help" style={{ marginTop: 6 }}>The 64 leaves are the f₁ outputs of the 64 chosen x-values. Each higher table pairs adjacent-bucket matches and halves the count: 64 → 32 → 16 → 8 → 4 → 2 → 1.</p>
      ) : (
        <>
          <div className="lab-dim" style={{ marginTop: 6 }}>{level.length} matched pairs from T{t - 1} → every pair satisfies the matching condition:</div>
          <div className="lab-okrow">
            {oks!.map((o, i) => <span key={i} className={`lab-okbit ${o ? "y" : "n"}`}>{o ? "✓" : "✗"}</span>)}
          </div>
        </>
      )}
      <div className="lab-pyramid">
        {proof.levels.map((lv, idx) => (
          <span key={idx} className={`lab-pyr-row ${idx === t - 1 ? "on" : ""}`} style={{ width: `${(lv.length / 64) * 100}%` }}>{lv.length}</span>
        ))}
      </div>
      <MiniNav i={t - 1} n={6} set={(v) => setT(v + 1)} unit="table T" />
    </div>
  );
}

function LadderStepper({ bls }: { bls: BlsTrace }) {
  const mul = bls.localMul;
  const n = mul.steps.length - 1;
  const [i, setI] = useState(0);
  const s = mul.steps[i];
  return (
    <div className="lab-stepbox">
      <div className="lab-row-between">
        <div>ladder rung <b className="lab-accent">{i}</b> <span className="lab-dim">/ {n}</span> · bit <code>{s.bit}</code> · <b>{s.op}</b></div>
        <Tex expr={s.op === "init" ? "acc \\leftarrow H(m)" : s.op === "double+add" ? "acc \\leftarrow 2\\,acc + H(m)" : "acc \\leftarrow 2\\,acc"} />
      </div>
      <div className="lab-bitstrip">
        {mul.bits.split("").map((b, k) => (
          <span key={k} className={`lab-bit ${k < i ? "done" : k === i ? "cur" : ""} ${b === "1" ? "one" : "zero"}`}>{b}</span>
        ))}
      </div>
      <G2Card p={s.acc} title="accumulator" tone="accent" />
      <MiniNav i={i} n={n} set={setI} unit="rung" />
      <p className="lab-help">
        Scalar multiplication <Tex expr={"sk\\cdot H(m)"} /> is evaluated left-to-right: for each bit of the {mul.bits.length}-bit secret, <b>double</b> the accumulator, and where the bit is 1 also <b>add</b> <Tex expr={"H(m)"} />. {mul.steps.length} group operations in all.
        {" "}Ladder result matches the optimized routine: <b className={mul.matchesNative ? "lab-ok" : "lab-bad"}>{mul.matchesNative ? "✓" : "✗"}</b>
      </p>
    </div>
  );
}

// ── the per-step body ────────────────────────────────────────────────────────
function StepBody({ step, run, bls }: { step: StepDef; run: PipelineRun; bls: BlsTrace | null }) {
  const { sp, vdf, plot, filter, lookup, req } = run;

  switch (step.id) {
    case "sp":
      return (
        <Body intro="The clock of the whole lottery. A sub-slot of VDF time is cut into equal signage-point intervals; at each one, every farmer gets a fresh challenge and one chance to win.">
          <Tex block expr={`\\text{sp\\_iters} = \\text{sp\\_index}\\times\\text{sp\\_interval\\_iters} = ${sp.spIndex}\\times ${vdf.interval} = ${Number(sp.spIters)}`} />
          <KV k="sub-slot challenge" v={`0x${sp.challengeHex}`} />
          <KV k="signage-point index" v={`${sp.spIndex} / ${sp.numSps - 1}`} />
          <KV k="cc_sp_output (the proof-of-space challenge)" v={`0x${sp.spOutputHex.slice(0, 24)}…`} mono />
          <KV k="difficulty" v={sp.difficulty.toString()} />
          <SpWheel sp={sp} />
        </Body>
      );

    case "pot-disc":
      return (
        <Body intro="The challenge has no trusted setup: it is turned into the discriminant of an imaginary quadratic field, and the VDF runs in that field's class group. Every element is a reduced binary quadratic form (a,b,c); the generator is g=(2,1,…).">
          <Tex block expr={"\\Delta = \\text{createDiscriminant}(\\text{challenge}),\\quad g = (2,\\,1,\\,\\tfrac{1-\\Delta}{8})"} />
          <KV k="challenge" v={`0x${vdf.challengeHex}`} mono />
          <KV k="discriminant Δ" v={`−${dec(-vdf.D, 22)}`} mono />
          <KV k="Δ bit length" v={`${vdf.bits}-bit, ≡ 1 (mod 8)`} />
          <p className="lab-help">No one knows the order of this class group, so there is no shortcut and no trusted setup — exactly why Chia uses it.</p>
        </Body>
      );

    case "pot-square":
      return (
        <Body intro="The timelord computes y = g^(2^T) by T sequential squarings. A 'squaring' composes the form with itself and reduces it back to its unique small representative; the discriminant b²−4ac never changes, proving you stayed in the group.">
          <VdfStepper run={run} />
        </Body>
      );

    case "pot-verify":
      return (
        <Body intro="A verifier must not redo the T squarings. The n-wesolowski proof lets anyone check the result in O(1) using a Fiat-Shamir prime ℓ.">
          <Tex block expr={"\\pi^{\\ell}\\,g^{\\,r} = y,\\qquad r = 2^{T}\\bmod \\ell"} />
          <KV k="iterations T" v={vdf.subSlotIters.toString()} />
          <KV k="Fiat-Shamir prime ℓ" v={`0x${vdf.lPrimeHex}…`} mono />
          <KV k="proof verifies" v={vdf.proofVerified ? "✓ yes" : "✗ no"} tone={vdf.proofVerified ? "ok" : "bad"} />
        </Body>
      );

    case "filter": {
      const bits = bitsOf(filter.focal.filterHex);
      return (
        <Body intro="Before any expensive lookup, a cheap gate: only plots whose filter hash starts with enough zero bits even bother to search. About 1 in 2^threshold plots pass each signage point.">
          <Tex block expr={`\\mathrm{lz}\\,H(\\text{plot\\_id}\\Vert c\\Vert sp)\\ \\ge\\ ${filter.threshold}`} />
          <KV k="focal plot" v={`#${plot.index} (farmer ${plot.farmerId})`} />
          <KV k="filter hash" v={`0x${filter.focal.filterHex}`} mono />
          <div className="lab-bitstrip">
            {bits.split("").map((b, i) => (
              <span key={i} className={`lab-bit ${i < filter.focal.bits ? "lead" : b === "1" ? "one" : "zero"}`}>{b}</span>
            ))}
          </div>
          <KV k="leading zero bits" v={`${filter.focal.bits} ≥ ${filter.threshold} ✓`} tone="ok" />
          <div className="lab-farmgrid">
            {filter.rows.map((r) => (
              <span key={r.plotIndex} className={`lab-chipdot ${r.passed ? "pass" : "fail"} ${r.plotIndex === plot.index ? "focal" : ""}`} title={`plot #${r.plotIndex}: ${r.bits} zero bits`}>#{r.plotIndex}</span>
            ))}
          </div>
          <p className="lab-help"><b>{filter.passed}</b> of {filter.total} plots cleared the filter at this signage point. The rest do no work at all.</p>
        </Body>
      );
    }

    case "f1":
      return (
        <Body intro="The proof of space lives in a forest of 7 tables. Table 1 is seeded by f1: a small hash of the plot_id and an x-value. There are 2^k = 256 possible x; the proof we are reconstructing uses 64 of them as leaves.">
          <Tex block expr={"f_1(x) = \\text{chacha-bits}(\\text{plot\\_id}, x)\\ \\Vert\\ \\text{top bits of } x"} />
          <KV k="plot_id" v={`0x${toHexShort(plot.plotId)}`} mono />
          <KV k="k (plot size param)" v={`${plot.k}  →  2^${plot.k} = ${1 << plot.k} possible x`} />
          <KV k="leaves in a proof" v={`${lookup.xs.length}`} />
          <div className="lab-leaves">
            {lookup.xs.map((x, i) => <span key={i} className="lab-leaf" title={`x[${i}] = ${x}`}>{x}</span>)}
          </div>
        </Body>
      );

    case "match":
      return (
        <Body intro="Two table entries match only if their y-values fall in adjacent buckets and a quadratic relation holds — the heart of chiapos. This is what forces a real plot on disk: you cannot cheaply invent matching chains.">
          <Tex block expr={"\\text{bucket}(y_R)=\\text{bucket}(y_L)+1\\ \\wedge\\ \\exists\\,m:\\ (2m+\\text{parity})^2 \\equiv \\dots"} />
          {lookup.sampleMatch && lookup.sampleMatch.m >= 0 ? (
            <>
              <KV k="a real matched pair" v={`y_L=${lookup.sampleMatch.yL}, y_R=${lookup.sampleMatch.yR}`} mono />
              <KV k="bucket" v={`${lookup.sampleMatch.bucket} → ${lookup.sampleMatch.bucket + 1} (parity ${lookup.sampleMatch.parity})`} />
              <div className="lab-mono" style={{ marginTop: 4 }}>
                <Tex expr={`(2\\cdot ${lookup.sampleMatch.m}+${lookup.sampleMatch.parity})^2 = ${lookup.sampleMatch.sq}`} /> — and the b,c offsets land on bc_R = {lookup.sampleMatch.bcR} ✓
              </div>
            </>
          ) : (
            <p className="lab-help">match detail unavailable for this proof.</p>
          )}
        </Body>
      );

    case "propagate":
      return (
        <Body intro="Each table is built by pairing matches from the one below and hashing them forward. The 64 leaves collapse, table by table, to a single root y-value at Table 7.">
          <PropagationStepper run={run} />
        </Body>
      );

    case "t7":
      return (
        <Body intro="A plot 'has a proof' for this challenge when some Table-7 entry's top k bits equal the challenge's top k bits. That root is the tip of a binary tree whose 64 leaves are the proof.">
          <Tex block expr={`\\text{topK}(y_{\\text{root}}) \\overset{?}{=} \\text{topK}(\\text{challenge})`} />
          <KV k="challenge top-k bits" v={`${lookup.challengeTopK}`} />
          <KV k="matching T7 root top-k bits" v={`${lookup.rootTopK}`} tone={lookup.rootTopK === lookup.challengeTopK ? "ok" : "bad"} />
          <KV k="T7 entries that matched" v={`${lookup.t7Matches}`} />
          <KV k="full forest sizes T1…T7" v={lookup.tableSizes.join(" · ")} mono />
        </Body>
      );

    case "backptr":
      return (
        <Body intro="From the matching root, follow each entry's left/right back-pointers down through the tables. At Table 1 the pointers resolve to the 64 original x-values — the actual proof of space.">
          <Tex block expr={"T_7 \\to T_6 \\to \\dots \\to T_1:\\ \\text{recover } 64\\ x\\text{-values}"} />
          <div className="lab-leaves">
            {lookup.xs.map((x, i) => (
              <span key={i} className={`lab-leaf ${i === req.qualityIndex || i === req.qualityIndex + 1 ? "q" : ""}`} title={`x[${i}] = ${x}`}>{x}</span>
            ))}
          </div>
          <p className="lab-help">These 64 numbers <i>are</i> the proof. The two highlighted leaves will form the quality string next.</p>
        </Body>
      );

    case "verify-pos":
      return (
        <Body intro="A verifier never opens the plot. It re-runs f1 on the 64 x-values and re-propagates the tables; if every pair matches and the root equals the challenge, the proof is valid.">
          <Tex block expr={"\\text{re-propagate } x_0\\dots x_{63}\\ \\Rightarrow\\ \\text{all matches hold} \\wedge \\text{root}=c"} />
          <KV k="every level's matches hold" v={lookup.proof.matchOk.every((lv) => lv.every(Boolean)) ? "✓ yes" : "✗ no"} tone="ok" />
          <KV k="root == challenge top-k" v={lookup.rootTopK === lookup.challengeTopK ? "✓ yes" : "✗ no"} tone="ok" />
          <KV k="proof valid" v={lookup.proof.valid ? "✓ VALID" : "✗ invalid"} tone={lookup.proof.valid ? "ok" : "bad"} />
        </Body>
      );

    case "quality":
      return (
        <Body intro="The proof is condensed into a 32-byte quality string by hashing the challenge with two specific leaves, chosen deterministically by the challenge bits.">
          <Tex block expr={`\\text{quality} = H(c \\Vert x[${req.qualityIndex}] \\Vert x[${req.qualityIndex + 1}])`} />
          <KV k="chosen leaves" v={`x[${req.qualityIndex}] = ${lookup.xs[req.qualityIndex]}, x[${req.qualityIndex + 1}] = ${lookup.xs[req.qualityIndex + 1]}`} mono />
          <KV k="quality string" v={`0x${req.qualityHex.slice(0, 32)}…`} mono />
        </Body>
      );

    case "req": {
      const pct = Math.max(1, Math.round(req.u * 100));
      return (
        <Body intro="The quality is mixed with the signage point and read as a uniform number u in [0,1). Better space (more plots, bigger k) shrinks required_iters; a tiny required_iters means an early, winning proof.">
          <Tex block expr={"\\text{sp\\_quality}=H(\\text{quality}\\Vert sp),\\quad u=\\tfrac{\\text{sp\\_quality}}{2^{256}}"} />
          <Tex block expr={`r = \\Big\\lfloor \\dfrac{\\text{difficulty}\\cdot \\text{DCF}\\cdot u}{\\text{plot\\_size}} \\Big\\rfloor = ${req.requiredIters.toString()}`} />
          <KV k="sp_quality" v={`0x${req.spQualityHex.slice(0, 32)}…`} mono />
          <KV k="u = sp_quality / 2²⁵⁶" v={req.u.toFixed(6)} />
          <div className="lab-ubar"><span style={{ width: `${pct}%` }} /></div>
          <KV k="difficulty · DCF" v={`${req.difficulty} · 2²⁰`} />
          <KV k="plot_size = (2k+1)·2^(k-1)" v={req.plotSize.toString()} />
          <KV k="required_iters" v={req.requiredIters.toString()} tone="accent" />
        </Body>
      );
    }

    case "window": {
      const maxR = Number(req.interval) * 4;
      const clamp = (n: number) => Math.min(100, (n / maxR) * 100);
      return (
        <Body intro="A proof wins its signage point only if required_iters fits inside one interval — it must be ready before the next signage point arrives. Small required_iters wins comfortably; near the edge is a nail-biter.">
          <Tex block expr={`\\text{required\\_iters} < \\text{sp\\_interval\\_iters}\\ \\Leftrightarrow\\ ${req.requiredIters.toString()} < ${req.interval.toString()}`} />
          <div className="lab-gauge">
            <div className="lab-gauge-zone" style={{ width: `${clamp(Number(req.interval))}%` }} />
            <div className={`lab-gauge-needle ${req.win ? "win" : ""}`} style={{ left: `${clamp(Number(req.requiredIters))}%` }} />
          </div>
          <div className="lab-gauge-lab"><span className="lab-accent">0…{req.interval.toString()} = WIN</span><span className="lab-dim">{maxR}+ iters</span></div>
          <KV k="window fraction" v={`${req.windowFraction.toFixed(3)}×`} />
          <KV k="outcome" v={req.win ? "🏆 WINS this signage point" : "near-miss — outside the window"} tone={req.win ? "ok" : "bad"} />
        </Body>
      );
    }

    case "infusion":
      return (
        <Body intro="A winning proof does not infuse at the signage point — it infuses required_iters later (plus a fixed grace of NUM_SP_INTERVALS_EXTRA intervals), wrapped within the sub-slot.">
          <Tex block expr={"\\text{ip\\_iters} = (\\text{sp\\_iters} + 3\\cdot\\text{interval} + \\text{required\\_iters})\\bmod \\text{sub\\_slot\\_iters}"} />
          {req.win && req.ipIters !== null ? (
            <>
              <KV k="sp_iters" v={Number(sp.spIters).toString()} />
              <KV k="required_iters" v={req.requiredIters.toString()} />
              <KV k="infusion point ip_iters" v={req.ipIters.toString()} tone="accent" />
            </>
          ) : (
            <p className="lab-help">This proof did not win its window, so it is never infused — there is no ip_iters. Generate a new signage point to find a winning one.</p>
          )}
        </Body>
      );

    case "bls-split":
      return bls ? (
        <Body intro="The plot's signing key is split in two: the harvester holds local_sk, the farmer holds farmer_sk. The plot public key is the sum of their public keys — a single point addition on the curve G1.">
          <Tex block expr={"\\text{plot\\_pk} = \\text{local\\_pk} + \\text{farmer\\_pk}\\quad(\\text{point addition on } G_1)"} />
          <G1Card p={bls.localPk} title="local_pk" />
          <G1Card p={bls.farmerPk} title="farmer_pk" />
          <G1Card p={bls.plotPk} title="plot_pk = local_pk + farmer_pk" tone="accent" />
        </Body>
      ) : <Loading />;

    case "bls-hash":
      return bls ? (
        <Body intro="To sign, the message (here the cc_sp_output) is hashed onto the curve G2 — a deterministic map from bytes to a real curve point whose coordinates live in the field extension F_p² = c0 + c1·u.">
          <Tex block expr={"H(m): \\{0,1\\}^* \\to G_2 \\subset E(\\mathbb{F}_{p^2})"} />
          <KV k="message m (cc_sp_output)" v={`0x${bls.msgHex.slice(0, 24)}…`} mono />
          <G2Card p={bls.hMsg} title="H(m)" tone="accent" />
        </Body>
      ) : <Loading />;

    case "bls-sign":
      return bls ? (
        <Body intro="A BLS signature is just a scalar multiplication: sig = sk · H(m). Here is the harvester's partial signature, computed rung by rung with the textbook double-and-add ladder so every point doubling and addition is visible.">
          <LadderStepper bls={bls} />
        </Body>
      ) : <Loading />;

    case "bls-agg":
      return bls ? (
        <Body intro="The harvester and farmer each sign the same message with their half-key. Adding the two partial signatures (another G2 point addition) yields one signature that verifies under the aggregated plot key.">
          <Tex block expr={"\\text{sig} = \\text{sig}_{\\text{local}} + \\text{sig}_{\\text{farmer}} = (\\text{local\\_sk}+\\text{farmer\\_sk})\\cdot H(m)"} />
          <G2Card p={bls.localMul.result} title="sig_local = local_sk · H(m)" />
          <G2Card p={bls.farmerSig} title="sig_farmer = farmer_sk · H(m)" />
          <G2Card p={bls.sigAgg} title="sig = sig_local + sig_farmer" tone="accent" />
        </Body>
      ) : <Loading />;

    case "bls-verify":
      return bls ? (
        <Body intro="Verification uses the bilinear pairing e: G1 × G2 → G_T. Because the pairing is linear in each argument, e(plot_pk, H(m)) equals e(g1, sig) exactly when sig was made with plot_sk — without ever revealing the secret.">
          <Tex block expr={"e(\\text{plot\\_pk},\\, H(m)) \\overset{?}{=} e(g_1,\\, \\text{sig})"} />
          <KV k="e(plot_pk, H(m))  [G_T fingerprint]" v={`0x${bls.lhsFp12Hex}`} mono />
          <KV k="e(g1, sig)  [G_T fingerprint]" v={`0x${bls.rhsFp12Hex}`} mono />
          <KV k="signature valid" v={bls.verified ? "✓ VALID — the block is signed" : "✗ invalid"} tone={bls.verified ? "ok" : "bad"} />
          <p className="lab-help">That is the whole loop: the VDF proved time passed, the 7-table forest proved space was committed, required_iters decided the winner, and BLS bound the proof to the farmer's keys.</p>
        </Body>
      ) : <Loading />;

    default:
      return null;
  }
}

// ── the expandable "show the math" deep-dive ─────────────────────────────────
// BLS12-381 constants (the real curve Chia uses), for reference in the panels.
const BLS_R = "0x73EDA753299D7D483339D80809A1D80553BDA402FFFE5BFEFFFFFFFF00000001";
const BLS_Q = "0x1A0111EA397FE69A4B1BA7B6434BACD764774B84F38512BF6730D2A0F6B0F6241EABFFFEB153FFFFB9FEFFFFFFFFAAAB";

function MathPanel({ children }: { children: React.ReactNode }) {
  // Open by default — the math is the point of the Lab; the toggle only collapses it.
  const [open, setOpen] = useState(true);
  return (
    <div className="lab-math">
      <button className={`lab-math-toggle ${open ? "open" : ""}`} onClick={() => setOpen((o) => !o)}>
        {open ? "▾ hide the math" : "▸ show the math"}
      </button>
      {open && <div className="lab-math-body">{children}</div>}
    </div>
  );
}
function MNote({ children }: { children: React.ReactNode }) {
  return <p className="lab-mnote">{children}</p>;
}
function MH({ children }: { children: React.ReactNode }) {
  return <div className="lab-mh">{children}</div>;
}

/** The deep-dive math for a step (returns null when a step has no extra theory). */
function StepMath({ step, run, bls }: { step: StepDef; run: PipelineRun; bls: BlsTrace | null }) {
  const { sp, vdf, lookup, req } = run;

  switch (step.id) {
    case "sp":
      return (
        <>
          <MH>From time to a challenge</MH>
          <MNote>Each sub-slot the timelord runs <i>one</i> long verifiable delay function (next phase). Reading that single VDF's output at evenly spaced iterations produces the sub-slot's signage-point challenges — one per interval:</MNote>
          <Tex block expr={`\\text{sp\\_interval\\_iters} = \\frac{\\text{sub\\_slot\\_iters}}{\\text{NUM\\_SPS}} = \\frac{${vdf.subSlotIters}}{${sp.numSps}} = ${vdf.interval}`} />
          <MNote>Signage point <Tex expr={"i"} /> lives at iteration <Tex expr={`\\text{sp\\_iters}=i\\cdot${vdf.interval}`} />. Because you cannot know iteration <Tex expr={"i"} />'s output without first doing <Tex expr={"i"} /> sequential squarings, challenge <Tex expr={"i"} /> simply cannot exist until that fraction of the sub-slot has physically elapsed. That is how <b>Time</b> paces <b>Space</b>: the lottery clock is unforgeable.</MNote>
          <MNote>Mainnet runs 64 signage points over a 600 s sub-slot (one every ~9.4 s); this toy uses {sp.numSps}. The challenge a farmer answers is the hash of the VDF output at that iteration, here <code>0x{sp.spOutputHex.slice(0, 16)}…</code>.</MNote>
        </>
      );

    case "pot-disc":
      return (
        <>
          <MH>1. The one requirement: a group whose size nobody knows</MH>
          <MNote>The VDF computes <Tex expr={"y=g^{\\,2^{T}}"} /> in a finite commutative group <Tex expr={"G"} />. Everything hinges on one fact: the order <Tex expr={"|G|"} /> must be <b>unknown to everyone</b>. If you knew <Tex expr={"N=|G|"} /> you would first reduce the exponent, <Tex expr={"e = 2^{T}\\bmod N"} /> (fast, by squaring 2 modulo <Tex expr={"N"} />), then compute <Tex expr={"g^{e}"} /> — skipping the <Tex expr={"T"} /> steps entirely and destroying the delay. RSA groups <Tex expr={"(\\mathbb{Z}/N)^{*}"} /> also have hidden order, but only because someone chose the primes — a <i>trusted setup</i>. Class groups need no secret: a random negative number already gives a group of unknown order.</MNote>
          <MH>2. Imaginary quadratic fields, informally</MH>
          <MNote>Fix a negative integer <Tex expr={"\\Delta\\equiv 1\\pmod 4"} /> (Chia uses <Tex expr={"\\Delta\\equiv 1\\pmod 8"} />). Consider numbers <Tex expr={"a+b\\sqrt{\\Delta}"} /> — the field <Tex expr={"\\mathbb{Q}(\\sqrt{\\Delta})"} />. Since <Tex expr={"\\Delta<0"} />, <Tex expr={"\\sqrt{\\Delta}"} /> is imaginary, hence “imaginary quadratic.” Inside it is a ring of integers whose <i>ideals</i> can be multiplied; calling two ideals equivalent when they differ by a principal (one-generator) ideal collapses them into a <b>finite</b> group of ideal classes. We never need ideals directly — Gauss gave an equivalent, fully concrete model out of quadratic forms.</MNote>
          <MH>3. Forms are the group elements</MH>
          <MNote>A binary quadratic form is <Tex expr={"f(x,y)=ax^2+bxy+cy^2"} />, just the integer triple <Tex expr={"(a,b,c)"} />, with discriminant</MNote>
          <Tex block expr={"\\Delta = b^2 - 4ac \\;<\\; 0,\\qquad a>0\\ (\\text{positive-definite})"} />
          <MNote>We hold <Tex expr={"\\Delta"} /> fixed; every form with that discriminant is one element of the group, in exact correspondence with the ideal classes above.</MNote>
          <MH>4. The group operation</MH>
          <MNote>The product of <Tex expr={"(a_1,b_1,c_1)"} /> and <Tex expr={"(a_2,b_2,c_2)"} /> is <b>Gauss composition</b>: an explicit gcd-based recipe yielding a third form of the same <Tex expr={"\\Delta"} />. It is commutative and associative, with identity the principal form <Tex expr={"(1,1,\\tfrac{1-\\Delta}{4})"} /> and inverse <Tex expr={"(a,b,c)^{-1}=(a,-b,c)"} />. A squaring is composing a form with itself — the NUDUPL specialization, faster than general composition.</MNote>
          <MH>5. Reduction: one name per element</MH>
          <MNote>Composition can inflate <Tex expr={"a,b,c"} />, so after every step we <b>reduce</b> with a short Euclid-like loop to the <i>unique</i> representative satisfying</MNote>
          <Tex block expr={"-a < b \\le a \\le c \\quad(\\text{and } b\\ge 0 \\text{ if } a=c)"} />
          <MNote>Every class has exactly one reduced form — a canonical name — and reduction pins the coefficients near <Tex expr={"\\sqrt{|\\Delta|}"} /> no matter how many millions of squarings you do, while <Tex expr={"b^2-4ac"} /> stays exactly <Tex expr={"\\Delta"} />. Re-checking that equality is the cheap certificate that you never left the group.</MNote>
          <MH>6. The class number, and why it stays secret</MH>
          <MNote>The element count is the class number <Tex expr={"h(\\Delta)"} />. Gauss's formula gives <Tex expr={"h(\\Delta)\\approx \\tfrac{\\sqrt{|\\Delta|}}{\\pi}\\,L(1,\\chi_\\Delta)"} />, so it grows like <Tex expr={"\\sqrt{|\\Delta|}"} /> — but computing it exactly is subexponential, comparable to factoring. For the 1024-bit discriminants Chia uses it is infeasible, so <Tex expr={"|G|"} /> is hidden from everyone even though <Tex expr={"\\Delta"} /> itself is public (just a hash of the chain's challenge). No trusted setup, no shortcut.</MNote>
          <MH>7. This run</MH>
          <MNote><Tex expr={`\\Delta`} /> is ~{vdf.bits}-bit with <Tex expr={"\\Delta\\equiv 1\\pmod 8"} />, so the prime 2 splits and the generator <Tex expr={"g=(2,\\,1,\\,\\tfrac{1-\\Delta}{8})"} /> is a valid reduced form. Here <Tex expr={`\\Delta = -${dec(-vdf.D, 20)}`} />.</MNote>
        </>
      );

    case "pot-square":
      return (
        <>
          <MH>One squaring, concretely</MH>
          <MNote>Step <Tex expr={"i"} /> is <Tex expr={"y_i = y_{i-1}^2"} /> — compose the current reduced form <Tex expr={"(a,b,c)"} /> with itself, then reduce — so after <Tex expr={"T"} /> steps you reach</MNote>
          <Tex block expr={"y = g^{\\,2^{T}} = \\underbrace{\\big(\\cdots(g^2)^2\\cdots\\big)^2}_{T\\ \\text{squarings}}"} />
          <MH>Why it is inherently sequential</MH>
          <MNote>To get <Tex expr={"y_i"} /> you genuinely need <Tex expr={"y_{i-1}"} /> first — squaring cannot be parallelized, and with <Tex expr={"|G|"} /> unknown you cannot replace the exponent by <Tex expr={"2^{T}\\bmod|G|"} />. So wall-clock time is proportional to <Tex expr={"T"} />. Adding cores does not help; only a faster <i>single</i> squaring would, which is why timelords compete on latency, not throughput. Doing all <Tex expr={`${vdf.subSlotIters}`} /> steps <i>is</i> the proof that time passed.</MNote>
          <MH>Sanity invariant</MH>
          <MNote>The form shown at each iteration always satisfies <Tex expr={"b^2-4ac=\\Delta"} />; the instant it didn't, the value would be outside the class group. Reduction keeps <Tex expr={"|b|\\le a\\le c"} /> so nothing blows up across the whole run.</MNote>
        </>
      );

    case "pot-verify":
      return (
        <>
          <MH>The problem</MH>
          <MNote>The prover claims <Tex expr={"y=g^{\\,2^{T}}"} />. A verifier must not redo <Tex expr={"T"} /> squarings — that would defeat the point of a <i>delay</i> function being cheap to check.</MNote>
          <MH>The trick (Wesolowski)</MH>
          <MNote>Both sides derive a prime by Fiat–Shamir, <Tex expr={"\\ell = H_{\\text{prime}}(g,\\,y,\\,T)"} /> (~264-bit). Write <Tex expr={"2^{T}=q\\ell+r"} /> with</MNote>
          <Tex block expr={"r = 2^{T}\\bmod \\ell,\\qquad q = \\big\\lfloor 2^{T}/\\ell\\big\\rfloor"} />
          <MNote>The prover sends just one group element <Tex expr={"\\pi = g^{\\,q}"} />. Then anyone checks</MNote>
          <Tex block expr={"\\pi^{\\ell}\\cdot g^{\\,r} = g^{\\,q\\ell+r} = g^{\\,2^{T}} = y \\;?"} />
          <MH>Why it is sound and cheap</MH>
          <MNote>Computing <Tex expr={"r"} /> only needs <Tex expr={"2^{T}\\bmod \\ell"} /> (a tiny modulus → fast), and the check is a single exponentiation by the 264-bit <Tex expr={"\\ell"} /> — <Tex expr={"O(1)"} /> versus <Tex expr={"T"} />. Forging a fake <Tex expr={"(y,\\pi)"} /> means extracting an <Tex expr={"\\ell"} />-th root in a group of unknown order (the <i>adaptive-root</i> assumption), believed hard. The <i>n</i>-wesolowski variant splits the run into segments and recurses, trading a few extra elements for far less prover work. This run verified <b className={vdf.proofVerified ? "lab-ok" : "lab-bad"}>{vdf.proofVerified ? "✓" : "✗"}</b>.</MNote>
        </>
      );

    case "filter":
      return (
        <>
          <MH>A cheap pre-screen</MH>
          <MNote>Reading a proof out of a plot costs disk seeks, so before doing any of that a harvester applies a free gate. The filter hash <Tex expr={"H(\\text{plot\\_id}\\Vert c\\Vert sp)"} /> is uniform, so the chance a given plot needs <Tex expr={`\\ge ${run.filter.threshold}`} /> leading zero bits is</MNote>
          <Tex block expr={`\\Pr[\\text{pass}] = 2^{-${run.filter.threshold}} = \\tfrac{1}{${1 << run.filter.threshold}}`} />
          <MH>Why it's safe</MH>
          <MNote>With <Tex expr={"N"} /> plots the expected number doing real work each signage point is <Tex expr={`N\\cdot 2^{-${run.filter.threshold}}`} /> — mainnet's 9-bit filter means a harvester touches only ~1/512 of its plots per SP, cutting I/O ~512×. Crucially the filter is re-seeded by every signage point, so over time each plot passes its fair share: it changes <i>throughput</i>, not <i>expected rewards</i>. This run: <b>{run.filter.passed}/{run.filter.total}</b> passed.</MNote>
        </>
      );

    case "f1":
      return (
        <>
          <MH>What a plot actually is</MH>
          <MNote>A plot is 7 precomputed tables on disk that encode a huge many-to-one function so that, later, given a challenge you can quickly find a chain of values whose final hash matches it. Building it is expensive (hours, lots of RAM); reading a proof is cheap. That asymmetry is the whole game — you cannot cheaply fake having stored the tables.</MNote>
          <MH>Table 1: f1</MH>
          <MNote>Table 1 lists, for every <Tex expr={"x\\in[0,2^k)"} />, the value <Tex expr={"f_1(x)"} /> = the high bits of a <b>ChaCha8</b> keystream keyed by the plot_id at counter <Tex expr={"x"} />, with the top few bits of <Tex expr={"x"} /> appended so <Tex expr={"x"} /> stays partly recoverable:</MNote>
          <Tex block expr={"f_1(x) = \\text{ChaCha8}_{\\text{plot\\_id}}(x)\\big|_{\\text{high }k}\\ \\Vert\\ x\\big|_{\\text{high bits}}"} />
          <MNote>The <Tex expr={"\\text{plot\\_id}=H(\\text{pool\\_pk}\\Vert\\text{plot\\_pk})"} /> binds the whole forest to your keys, so no two plots share a table.</MNote>
          <MH>Scale</MH>
          <MNote>Mainnet <Tex expr={"k=32"} /> ⇒ <Tex expr={"2^{32}\\approx 4.3\\times 10^9"} /> entries (tens of GB after compression); this toy uses <Tex expr={"k=8"} /> ⇒ {1 << 8} entries so the whole forest fits on screen. (Here SHA-256 stands in for ChaCha8.)</MNote>
        </>
      );

    case "match":
      return (
        <>
          <MH>Pairing up entries</MH>
          <MNote>To go from one table to the next, chiapos pairs entries whose <Tex expr={"y"} />-values “match,” then hashes each matched pair forward. A good match rule must be <i>common</i> enough that tables don't die out, yet <i>structured</i> enough that you can't conjure matching chains without actually storing the table — that balance is what ties proving to real storage.</MNote>
          <MH>Bucketed coordinates</MH>
          <MNote>Slice the <Tex expr={"y"} />-axis into buckets of width <Tex expr={"BC=B\\cdot C"} />. Each <Tex expr={"y"} /> gets a bucket and an in-bucket coordinate split into <Tex expr={"(b,c)"} />:</MNote>
          <Tex block expr={"\\text{bucket}=\\lfloor y/BC\\rfloor,\\quad bc = y\\bmod BC,\\quad b=\\lfloor bc/C\\rfloor,\\quad c = bc\\bmod C"} />
          <MH>The condition</MH>
          <MNote><Tex expr={"y_L,y_R"} /> match iff they sit in adjacent buckets and, for some <Tex expr={"m\\in[0,M)"} /> with <Tex expr={"\\text{parity}=\\text{bucket}(y_L)\\bmod 2"} />:</MNote>
          <Tex block expr={"\\text{bucket}(y_R)=\\text{bucket}(y_L)+1"} />
          <Tex block expr={"(b_R-b_L)\\equiv m\\!\\!\\pmod B \\ \\wedge\\ (c_R-c_L)\\equiv (2m+\\text{parity})^2\\!\\!\\pmod C"} />
          <MH>Why a parabola</MH>
          <MNote>For each <Tex expr={"m"} /> the allowed offset is the single point <Tex expr={"\\big(m,\\,(2m+\\text{parity})^2\\big)"} /> on the <Tex expr={"(b,c)"} /> torus; over all <Tex expr={"m"} /> they trace a discrete <b>parabola</b> (the “Beyond Hellman” construction). It yields on average ~1 match per entry — so every table stays about the same size — while keeping matches pseudo-random and un-shortcuttable. Mainnet uses <Tex expr={"B=119,\\,C=127,\\,M=64"} />; this toy uses <Tex expr={`B=${POS.B},\\,C=${POS.C},\\,M=${POS.EXTRA_POW}`} />.</MNote>
        </>
      );

    case "propagate":
      return (
        <>
          <MH>Forward: build 7 tables</MH>
          <MNote>For <Tex expr={"t=2\\dots 7"} /> the plotter sorts table <Tex expr={"t\\!-\\!1"} /> by <Tex expr={"y"} />, scans adjacent buckets for matches, and emits a new entry holding the forward value and <b>back-pointers</b> to the two parents that made it:</MNote>
          <Tex block expr={"\\text{entry} = \\big(\\,y' = f_t(y_L,y_R),\\ \\text{pos}_L,\\ \\text{pos}_R\\,\\big)"} />
          <MNote>Because there is ~1 match per entry, all 7 tables stay roughly the same size.</MNote>
          <MH>Back-propagation: drop what you don't need</MH>
          <MNote>The forward pass keeps far more than a proof needs. <b>Back-propagation</b> walks <Tex expr={"T_7\\to T_1"} /> marking only entries reachable from some Table-7 root, discards the rest, and drops the <Tex expr={"y"} />-values entirely — a proof only needs the leaf <Tex expr={"x"} />'s and the tree shape.</MNote>
          <MH>Compression & size</MH>
          <MNote>The surviving position pairs are stored with line-point / delta encoding plus checkpoints for fast lookup. Net result for this toy:</MNote>
          <Tex block expr={"\\text{plot\\_size} \\approx (2k+1)\\cdot 2^{\\,k-1} \\;=\\; " + Number(req.plotSize) + "\\ \\text{bytes}"} />
        </>
      );

    case "t7":
      return (
        <>
          <MH>Farming is the inverse of plotting</MH>
          <MNote>Plotting built the tables forward; farming runs them backward. A proof exists for a challenge iff some Table-7 root agrees with the challenge in its top <Tex expr={"k"} /> bits:</MNote>
          <Tex block expr={"\\text{topK}(y_{\\text{root}}) = \\text{topK}(c)"} />
          <MNote>With <Tex expr={"\\sim 2^k"} /> roots roughly uniform over <Tex expr={"k"} />-bit prefixes, the expected number of matches is ~1, so a filter-passing plot has a proof with probability near <Tex expr={"1-e^{-1}\\approx 0.63"} />. Because Table 7 is sorted, the harvester binary-searches matching prefixes — <Tex expr={"O(\\log)"} /> seeks, not a rescan. This run found <b>{lookup.t7Matches}</b>.</MNote>
        </>
      );

    case "backptr":
      return (
        <>
          <MH>From root to 64 leaves</MH>
          <MNote>Each entry remembers two parents, so following both pointers down all 6 levels expands the single root into a full binary tree of <Tex expr={"2^{6}=64"} /> leaves — the original <Tex expr={"x"} />-values.</MNote>
          <MH>Self-contained</MH>
          <MNote>Those 64 numbers plus the plot_id are everything a verifier needs: it recomputes each <Tex expr={"f_1(x)"} />, re-checks every match up the tree, and confirms the root equals the challenge. The plot file is never touched during verification — storage is proven, not shown.</MNote>
        </>
      );

    case "quality":
      return (
        <>
          <MH>Why just two leaves</MH>
          <MNote>The proof has 64 leaves, but required_iters only needs a single uniform number. The quality folds the proof into 32 bytes by hashing the challenge with two adjacent leaves chosen by the challenge bits:</MNote>
          <Tex block expr={`\\text{quality} = H\\big(c \\,\\Vert\\, x[${req.qualityIndex}] \\,\\Vert\\, x[${req.qualityIndex + 1}]\\big)`} />
          <MNote>The leaves are pseudo-random and <Tex expr={"H"} /> is uniform, so the quality is a uniform 256-bit value — yet it still binds <i>this</i> exact proof. The full 64-leaf proof is only needed later to convince the network; the timing math below needs just this number.</MNote>
        </>
      );

    case "req":
      return (
        <>
          <MH>From quality to a deadline</MH>
          <MNote>Mix the quality with the signage point and read it as a uniform draw <Tex expr={"u\\in[0,1)"} />:</MNote>
          <Tex block expr={"u = \\frac{H(\\text{quality}\\Vert sp)}{2^{256}},\\qquad \\text{required\\_iters} = \\Big\\lfloor \\frac{\\text{difficulty}\\cdot \\text{DCF}\\cdot u}{\\text{plot\\_size}}\\Big\\rfloor"} />
          <MH>Why winning ∝ space</MH>
          <MNote>Since <Tex expr={"u"} /> is uniform, <Tex expr={"\\mathbb{E}[\\text{required\\_iters}] = \\tfrac{\\text{difficulty}\\cdot\\text{DCF}}{2\\,\\text{plot\\_size}}"} />. A plot wins iff <Tex expr={"\\text{required\\_iters}<\\text{interval}"} />, i.e. <Tex expr={"u < \\tfrac{\\text{interval}\\cdot\\text{plot\\_size}}{\\text{difficulty}\\cdot\\text{DCF}}"} />, so</MNote>
          <Tex block expr={"\\Pr[\\text{win}] \\approx \\frac{\\text{interval}\\cdot\\text{plot\\_size}}{\\text{difficulty}\\cdot\\text{DCF}} \\ \\propto\\ \\text{plot\\_size} = \\text{your space}"} />
          <MH>Difficulty as a thermostat</MH>
          <MNote>Summing <Tex expr={"\\Pr[\\text{win}]"} /> over every plot in netspace gives the expected winners per signage point; the protocol retargets <b>difficulty</b> to hold that near 1, so more netspace just lowers each plot's odds and block time stays steady. This run: <Tex expr={`u\\approx ${req.u.toFixed(4)}`} />, plot_size <Tex expr={`= ${Number(req.plotSize)}`} />, required_iters <b>{req.requiredIters.toString()}</b>.</MNote>
        </>
      );

    case "window":
      return (
        <>
          <MH>The window is one interval</MH>
          <MNote>A proof must be ready before the next signage point arrives, so it wins only if</MNote>
          <Tex block expr={"\\text{required\\_iters} < \\text{sp\\_interval\\_iters}"} />
          <MNote>A smaller required_iters means an earlier infusion, so among everyone answering the same signage point the one with the best proof (smallest required_iters) lands first. Signage points in the last <Tex expr={"\\text{NUM\\_SP\\_INTERVALS\\_EXTRA}=3"} /> intervals of a slot make <i>overflow</i> blocks that infuse into the next sub-slot — handled by the <Tex expr={"\\bmod"} /> in the next step.</MNote>
        </>
      );

    case "infusion":
      return (
        <>
          <MH>Where it lands on the VDF</MH>
          <Tex block expr={"\\text{ip\\_iters} = \\big(\\text{sp\\_iters} + 3\\cdot\\text{interval} + \\text{required\\_iters}\\big)\\bmod \\text{sub\\_slot\\_iters}"} />
          <MNote>Reading the terms: <Tex expr={"\\text{sp\\_iters}"} /> is where this signage point sits; <Tex expr={"+3\\cdot\\text{interval}"} /> is a fixed grace so the network can gather every farmer's proof for that SP and the signage-point VDF can finish; <Tex expr={"+\\,\\text{required\\_iters}"} /> is <i>your</i> specific delay (smaller = earlier = you beat a weaker proof at the same SP); and the <Tex expr={"\\bmod\\,\\text{sub\\_slot\\_iters}"} /> wraps overflow blocks into the following sub-slot.</MNote>
        </>
      );

    case "bls-split":
      return (
        <>
          <MH>1. Finite fields</MH>
          <MNote>A finite field <Tex expr={"\\mathbb{F}_q"} /> is the integers <Tex expr={"\\{0,1,\\dots,q-1\\}"} /> with <Tex expr={"+"} /> and <Tex expr={"\\times"} /> taken modulo a prime <Tex expr={"q"} /> — every nonzero element has an inverse, so you can also divide. BLS12-381's <Tex expr={"q"} /> is a fixed 381-bit prime, and <b>all</b> curve arithmetic happens mod <Tex expr={"q"} />.</MNote>
          <div className="lab-mono lab-const"><span className="lab-dim">q =</span> {BLS_Q}</div>
          <MH>2. Elliptic curves over a field</MH>
          <MNote>An elliptic curve is the set of solutions <Tex expr={"(x,y)\\in\\mathbb{F}_q^2"} /> of <Tex expr={"y^2=x^3+ax+b"} />, plus one extra “point at infinity” <Tex expr={"\\mathcal{O}"} />. Those points form an abelian group under the chord-and-tangent law (shown at the signing step). BLS12-381 uses <Tex expr={"a=0,\\,b=4"} />.</MNote>
          <MH>3. Two curves, two groups, one order r</MH>
          <MNote>Pairings need <i>two</i> source groups. Both have the same prime order <Tex expr={"r"} /> (a 255-bit prime):</MNote>
          <Tex block expr={"G_1\\subset E(\\mathbb{F}_q):\\ y^2=x^3+4, \\qquad G_2\\subset E'(\\mathbb{F}_{q^2}):\\ y^2=x^3+4(u+1)"} />
          <MNote>Public keys live in <Tex expr={"G_1"} /> (48-byte points over <Tex expr={"\\mathbb{F}_q"} />); signatures live in <Tex expr={"G_2"} /> over the extension <Tex expr={"\\mathbb{F}_{q^2}=\\mathbb{F}_q[u]/(u^2+1)"} />, so their coordinates print as <Tex expr={"c_0+c_1u"} />.</MNote>
          <div className="lab-mono lab-const"><span className="lab-dim">r =</span> {BLS_R}</div>
          <MH>4. The split key</MH>
          <MNote>A private key is a scalar <Tex expr={"\\text{sk}\\in\\mathbb{Z}_r"} /> and its public key is <Tex expr={"\\text{pk}=\\text{sk}\\cdot g_1"} />. Chia splits each plot key so the harvester holds <Tex expr={"\\text{local\\_sk}"} /> and the farmer holds <Tex expr={"\\text{farmer\\_sk}"} />. Because <Tex expr={"\\text{sk}\\mapsto\\text{sk}\\cdot g_1"} /> is linear, adding the two public keys in <Tex expr={"G_1"} /> reconstructs the plot key:</MNote>
          <Tex block expr={"\\text{plot\\_pk} = \\text{local\\_sk}\\cdot g_1 + \\text{farmer\\_sk}\\cdot g_1 = (\\text{local\\_sk}+\\text{farmer\\_sk})\\cdot g_1"} />
        </>
      );

    case "bls-hash":
      return (
        <>
          <MH>Why hashing to a point is subtle</MH>
          <MNote>To sign we need <Tex expr={"H(m)\\in G_2"} /> that is deterministic, uniform over the subgroup, and whose discrete log nobody can find (otherwise signatures could be forged). You cannot just hash to an <Tex expr={"x"} /> and solve for <Tex expr={"y"} /> — not every <Tex expr={"x"} /> is on the curve, and the structure would leak.</MNote>
          <MH>The construction (RFC 9380)</MH>
          <MNote>The standard map composes four well-defined steps:</MNote>
          <Tex block expr={"H:\\{0,1\\}^{*}\\xrightarrow{\\text{expand\\_xmd}}\\mathbb{F}_{q^2}^{2}\\xrightarrow{\\text{SSWU}}E'\\times E'\\xrightarrow{+}E'\\xrightarrow{\\times h_2}G_2"} />
          <MNote>First <b>expand_message_xmd</b> (SHA-256 with a domain-separation tag unique to Chia) stretches the message to two field elements; the <b>simplified SWU</b> map sends each to an on-curve point; the two are added; finally multiplying by the cofactor <Tex expr={"h_2"} /> forces the result into the prime-order subgroup <Tex expr={"G_2"} />. The output is a uniform-looking point with unknown discrete log.</MNote>
        </>
      );

    case "bls-sign":
      return (
        <>
          <MH>The chord-and-tangent law</MH>
          <MNote>To add two curve points <Tex expr={"P,Q"} />: draw the line through them; it meets the cubic at a third point; reflect that over the <Tex expr={"x"} />-axis to get <Tex expr={"P+Q"} />. For <Tex expr={"P+P"} /> use the tangent at <Tex expr={"P"} />. The point at infinity <Tex expr={"\\mathcal{O}"} /> is the identity and <Tex expr={"-P=(x,-y)"} />, making the points an abelian group.</MNote>
          <MH>The explicit formulas</MH>
          <MNote>Over <Tex expr={"\\mathbb{F}_q"} /> with <Tex expr={"a=0"} />, writing <Tex expr={"\\lambda"} /> for the slope (division is a modular inverse mod <Tex expr={"q"} />):</MNote>
          <Tex block expr={"\\lambda_{\\text{add}}=\\frac{y_2-y_1}{x_2-x_1},\\qquad \\lambda_{\\text{dbl}}=\\frac{3x_1^2}{2y_1}"} />
          <Tex block expr={"x_3=\\lambda^2-x_1-x_2,\\qquad y_3=\\lambda(x_1-x_3)-y_1"} />
          <MH>A worked example over 𝔽₁₁</MH>
          <MNote>Same curve shape <Tex expr={"y^2=x^3+4"} /> over the tiny field <Tex expr={"\\mathbb{F}_{11}"} />, with <Tex expr={"P=(0,2),\\,Q=(1,4)"} />:</MNote>
          <Tex block expr={"\\lambda=\\tfrac{4-2}{1-0}=2,\\quad x_3=2^2-0-1=3,\\quad y_3=2(0-3)-2=-8\\equiv 3"} />
          <MNote>So <Tex expr={"P+Q=(3,3)"} />, and indeed <Tex expr={"3^3+4=31\\equiv 9=3^2"} /> ✓. The real curve runs the <i>identical</i> formulas, just with a 381-bit <Tex expr={"q"} />.</MNote>
          <MH>Signing & the ECDLP</MH>
          <MNote>A signature is <Tex expr={"\\sigma=\\text{sk}\\cdot H(m)"} /> — add <Tex expr={"H(m)"} /> to itself <Tex expr={"\\text{sk}"} /> times via the {bls ? bls.localMul.bits.length : 255}-bit double-and-add ladder you are stepping. Security is the <b>elliptic-curve discrete log problem</b>: from <Tex expr={"P"} /> and <Tex expr={"k\\!\\cdot\\! P"} />, finding <Tex expr={"k"} /> costs <Tex expr={"\\sim 2^{128}"} /> here, so publishing <Tex expr={"\\text{pk}=\\text{sk}\\cdot g_1"} /> hides <Tex expr={"\\text{sk}"} />.</MNote>
        </>
      );

    case "bls-agg":
      return (
        <>
          <MH>Same-message aggregation</MH>
          <MNote>The harvester and farmer sign the <i>same</i> signage-point message with their half-keys. Because a pairing is linear in each slot, the sum of their signatures verifies against the sum of their public keys:</MNote>
          <Tex block expr={"e\\!\\Big(g_1,\\sum_i\\sigma_i\\Big)=\\prod_i e(g_1,\\sigma_i)=\\prod_i e(\\text{pk}_i,H(m))=e\\!\\Big(\\sum_i\\text{pk}_i,\\,H(m)\\Big)"} />
          <MNote>So summing the two <Tex expr={"G_2"} /> partial signatures yields one <Tex expr={"\\sigma"} /> that verifies against the single aggregated <Tex expr={"\\text{plot\\_pk}=\\sum_i\\text{pk}_i"} />. (General BLS also aggregates <i>different</i> messages as a product of pairings; the plot signature is the same-message case.)</MNote>
        </>
      );

    case "bls-verify":
      return (
        <>
          <MH>What a pairing is</MH>
          <MNote>A pairing <Tex expr={"e:G_1\\times G_2\\to G_T"} /> maps a pair of points to an element of <Tex expr={"G_T"} /> (the order-<Tex expr={"r"} /> subgroup of <Tex expr={"\\mathbb{F}_{q^{12}}"} />). It is efficiently computable (Miller's algorithm plus a final exponentiation) and non-degenerate, <Tex expr={"e(g_1,g_2)\\neq 1"} />.</MNote>
          <MH>Bilinearity — the one magic property</MH>
          <MNote>Scalars slide out of the points and multiply in the exponent:</MNote>
          <Tex block expr={"e(\\alpha P,\\,\\beta Q)=e(P,Q)^{\\alpha\\beta}"} />
          <MH>The verification identity, derived</MH>
          <MNote>For a signature <Tex expr={"\\sigma=\\text{sk}\\cdot H(m)"} /> under <Tex expr={"\\text{pk}=\\text{sk}\\cdot g_1"} />, push the secret across the pairing:</MNote>
          <Tex block expr={"e(g_1,\\sigma)=e(g_1,\\text{sk}\\!\\cdot\\! H(m))=e(g_1,H(m))^{\\text{sk}}=e(\\text{sk}\\!\\cdot\\! g_1,H(m))=e(\\text{pk},H(m))"} />
          <MNote>So checking <Tex expr={"e(g_1,\\sigma)=e(\\text{pk},H(m))"} /> confirms <Tex expr={"\\sigma"} /> was made with the secret behind <Tex expr={"\\text{pk}"} /> — without ever revealing it. Both sides are elements of <Tex expr={"\\mathbb{F}_{q^{12}}"} />; the run compares their fingerprints and they agree (<b className={bls?.verified ? "lab-ok" : "lab-bad"}>{bls?.verified ? "✓" : "✗"}</b>). Forging <Tex expr={"\\sigma"} /> without the secret is the co-CDH problem, believed hard.</MNote>
        </>
      );

    default:
      return null;
  }
}

/** A step = its live body, plus an optional expandable math deep-dive. */
export function StepView({ step, run, bls }: { step: StepDef; run: PipelineRun; bls: BlsTrace | null }) {
  const math = StepMath({ step, run, bls });
  return (
    <>
      <StepBody step={step} run={run} bls={bls} />
      {math && <MathPanel>{math}</MathPanel>}
    </>
  );
}

// ── presentational atoms ─────────────────────────────────────────────────────
function Body({ intro, children }: { intro: string; children: React.ReactNode }) {
  return (
    <div className="lab-body">
      <p className="lab-intro">{intro}</p>
      {children}
    </div>
  );
}
function KV({ k, v, mono, tone }: { k: string; v: string; mono?: boolean; tone?: "ok" | "bad" | "accent" }) {
  return (
    <div className="lab-kv">
      <span className="lab-kv-k">{k}</span>
      <span className={`lab-kv-v ${mono ? "mono" : ""} ${tone ? `lab-${tone}` : ""}`}>{v}</span>
    </div>
  );
}
function Loading() {
  return <div className="lab-body"><p className="lab-help">computing elliptic-curve trace…</p></div>;
}
function SpWheel({ sp }: { sp: PipelineRun["sp"] }) {
  return (
    <div className="lab-wheel">
      {Array.from({ length: sp.numSps }).map((_, i) => (
        <span key={i} className={`lab-tick ${i === sp.spIndex ? "now" : i < sp.spIndex ? "lit" : ""}`} />
      ))}
    </div>
  );
}
function toHexShort(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < Math.min(8, b.length); i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}
