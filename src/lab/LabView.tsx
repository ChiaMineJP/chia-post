/**
 * PoST Lab — a click-driven, single-plot deep dive through one signage point's
 * complete Proof-of-Space-and-Time computation. No timers, no network: every
 * "Next" reveals the next granular step (with its formula and real values), and
 * "New signage point" runs the genuine VDF + chiapos + BLS pipeline afresh.
 */
import { useEffect, useMemo, useState } from "react";
import { LabFarm, type PipelineRun } from "./runPipeline.ts";
import { buildBlsTrace, type BlsTrace } from "./blsTrace.ts";
import { PHASES, STEPS, StepView, type Phase } from "./steps.tsx";

export function LabView() {
  const farm = useMemo(() => new LabFarm(), []);
  const [run, setRun] = useState<PipelineRun | null>(() => farm.runSignagePoint(1));
  const [stepIndex, setStepIndex] = useState(0);

  const bls = useMemo<BlsTrace | null>(
    () => (run ? buildBlsTrace(run.plot.local.sk, run.plot.farmer.sk, run.sp.spOutput, run.sp.spOutputHex) : null),
    [run],
  );

  const newSp = () => {
    const next = farm.runSignagePoint((run?.sp.seed ?? 0) + 1);
    if (next) {
      setRun(next);
      setStepIndex(0);
    }
  };

  const go = (i: number) => setStepIndex(Math.max(0, Math.min(STEPS.length - 1, i)));

  // ← / → walk the steps (ignore when focus is in a slider/input).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") { e.preventDefault(); setStepIndex((i) => Math.min(STEPS.length - 1, i + 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setStepIndex((i) => Math.max(0, i - 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!run) {
    return <div className="lab"><div className="lab-empty">No proof found nearby — try reloading.</div></div>;
  }

  const step = STEPS[stepIndex];
  const phaseMeta = PHASES.find((p) => p.key === step.phase)!;
  const phaseStepIndex = (phase: Phase) => STEPS.findIndex((s) => s.phase === phase);

  return (
    <div className="lab">
      <div className="lab-bar">
        <button className="lab-newsp" onClick={newSp}>↻ New signage point</button>
        <span className="lab-runinfo">
          plot <b>#{run.plot.index}</b> · sp <b>{run.sp.spIndex}</b> ·{" "}
          <span className={`lab-badge ${run.req.win ? "win" : "miss"}`}>{run.req.win ? "WINS" : "near-miss"}</span>
        </span>
        <span className="lab-spacer" />
        <span className="lab-hint">use ← → or the rail · step {stepIndex + 1} / {STEPS.length}</span>
      </div>

      <div className="lab-grid">
        <nav className="lab-rail">
          {PHASES.map((p) => {
            const first = phaseStepIndex(p.key);
            const active = step.phase === p.key;
            return (
              <div key={p.key} className={`lab-phase ${active ? "active" : ""}`}>
                <button className="lab-phase-h" onClick={() => go(first)}>
                  <span className="lab-phase-i">{p.icon}</span>
                  <span>{p.label}</span>
                </button>
                <div className="lab-phase-steps">
                  {STEPS.map((s, i) => s.phase === p.key && (
                    <button
                      key={s.id}
                      className={`lab-step ${i === stepIndex ? "cur" : i < stepIndex ? "done" : ""}`}
                      onClick={() => go(i)}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <section className="lab-content">
          <header className="lab-step-head">
            <span className="lab-step-icon">{phaseMeta.icon}</span>
            <div>
              <div className="lab-step-phase">{phaseMeta.label}</div>
              <h2 className="lab-step-title">{step.title}</h2>
            </div>
            <span className="lab-step-no">{stepIndex + 1} / {STEPS.length}</span>
          </header>

          <StepView key={`${step.id}:${run.sp.seed}`} step={step} run={run} bls={bls} />

          <footer className="lab-nav">
            <button onClick={() => go(stepIndex - 1)} disabled={stepIndex === 0}>← Prev</button>
            <div className="lab-progress">
              {STEPS.map((_, i) => (
                <span key={i} className={`lab-dotmini ${i === stepIndex ? "cur" : i < stepIndex ? "done" : ""}`} onClick={() => go(i)} />
              ))}
            </div>
            <button className="primary" onClick={() => go(stepIndex + 1)} disabled={stepIndex === STEPS.length - 1}>Next →</button>
          </footer>
        </section>
      </div>
    </div>
  );
}
