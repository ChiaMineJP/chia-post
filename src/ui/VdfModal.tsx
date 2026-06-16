import { useEffect, useMemo, useState } from "react";
import { defaultVdf } from "../crypto/vdf.ts";
import { discriminantOf, type Form } from "../crypto/classgroup.ts";
import { hexToBytes } from "../crypto/hash.ts";
import { TOY_CONSTANTS, spIntervalIters } from "../sim/constants.ts";
import { Tex } from "./Math.tsx";

const T = Number(TOY_CONSTANTS.SUB_SLOT_ITERS); // one sub-slot of squarings
const INTERVAL = Number(spIntervalIters(TOY_CONSTANTS));

function short(n: bigint, digits = 14): string {
  const s = n.toString();
  return s.length > digits ? s.slice(0, digits) + "…" : s;
}

export function VdfModal({ challengeHex, onClose }: { challengeHex: string; onClose: () => void }) {
  const data = useMemo(() => {
    const challenge = hexToBytes(challengeHex);
    let el = defaultVdf.start(challenge);
    const forms: Form[] = [el.form];
    for (let i = 1; i <= T; i++) {
      el = defaultVdf.step(el);
      forms.push(el.form);
    }
    const proof = defaultVdf.prove(challenge, T, 3);
    return { forms, D: el.D, proof };
  }, [challengeHex]);

  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setI((p) => {
        if (p >= T) {
          setPlaying(false);
          return T;
        }
        return p + 2;
      });
    }, 40);
    return () => clearInterval(id);
  }, [playing]);

  const f = data.forms[Math.min(i, T)];
  const disc = discriminantOf(f); // == D, the invariant
  const lastSeg = data.proof.segments[data.proof.segments.length - 1];
  const onSp = i % INTERVAL === 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "min(900px, 94vw)", width: "min(900px, 94vw)" }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2>Proof of Time — class-group VDF</h2>
        <p className="help" style={{ marginTop: 2 }}>
          The timelord computes <Tex expr={"y = g^{\\,2^{T}}"} /> by <b>T sequential squarings</b>. Each step needs the
          previous one — you cannot parallelize or skip ahead, so finishing <i>proves</i> that time elapsed.
        </p>
        <p className="help" style={{ marginTop: 6 }}>
          There is no separate scalar <Tex expr={"y"} />. The group is the <b>class group</b> of discriminant <Tex expr={"\\Delta"} />,
          and every element <i>is</i> a <b>reduced binary quadratic form</b> <Tex expr={"f(x,y)=ax^2+bxy+cy^2"} /> — just the
          triple <Tex expr={"(a,b,c)"} />. So the running value <Tex expr={"y_i"} /> and the coefficients <Tex expr={"a,b,c"} /> shown
          below are the <i>same object</i>: <Tex expr={"y_i=(a,b,c)"} />. A “squaring” means <b>compose the form with itself, then
          reduce</b> to the unique small representative — that reduction keeps <Tex expr={"a,b,c"} /> from blowing up while the
          discriminant <Tex expr={"b^2-4ac=\\Delta"} /> never changes, which is exactly what proves you stayed in the group.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--muted)", margin: "4px 0 10px" }}>
          <span>challenge <code>{challengeHex.slice(0, 14)}…</code></span>
          <span>→ discriminant <code>Δ = −{short((-data.D), 18)}</code> (64-bit, ≡ 1 mod 8)</span>
          <span>→ generator <code>g = (2, 1, …)</code></span>
        </div>

        {/* current step */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "12px 16px", background: "var(--panel-2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 14 }}>
              iteration <b style={{ color: "var(--cc)", fontSize: 18 }}>{i}</b> <span style={{ color: "var(--muted)" }}>/ {T}</span>
              {onSp && <span style={{ color: "var(--icc)", marginLeft: 10 }}>← signage point {i / INTERVAL}</span>}
            </div>
            <Tex expr={i === 0 ? "y_0 = g" : `y_{${i}} = y_{${i - 1}}^{2} = g^{\\,2^{${i}}}`} />
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
            <Tex expr={`y_{${i}}`} /> <i>is</i> this reduced form <Tex expr={"(a,b,c)"} />:
          </div>
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, marginTop: 4, lineHeight: 1.7 }}>
            <div><span style={{ color: "var(--muted)" }}>a =</span> <b style={{ color: "var(--cc)" }}>{f.a.toString()}</b></div>
            <div><span style={{ color: "var(--muted)" }}>b =</span> <b style={{ color: "var(--cc)" }}>{f.b.toString()}</b></div>
            <div><span style={{ color: "var(--muted)" }}>c =</span> <b style={{ color: "var(--cc)" }}>{short(f.c, 40)}</b></div>
          </div>
          <div style={{ marginTop: 8, color: disc === data.D ? "#3fb950" : "#ff7b72" }}>
            <Tex expr={"b^2 - 4ac = \\Delta"} /> <span style={{ fontSize: 12 }}>— so <Tex expr={`y_{${i}}`} /> is still a valid reduced element of the same class group {disc === data.D ? "✓" : "✗"}</span>
          </div>
        </div>

        {/* controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <button className="primary" onClick={() => { if (i >= T) setI(0); setPlaying((p) => !p); }} style={{ background: "var(--cc)", color: "#07140c", border: "none", borderRadius: 5, padding: "5px 12px", cursor: "pointer", fontWeight: 600 }}>
            {playing ? "❚❚ pause" : "▶ play"}
          </button>
          <button onClick={() => setI((p) => Math.max(0, p - 1))} style={btn}>− step</button>
          <button onClick={() => setI((p) => Math.min(T, p + 1))} style={btn}>step +</button>
          <input type="range" min={0} max={T} value={i} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }} style={{ flex: 1, accentColor: "var(--cc)" }} />
        </div>

        {/* the shortcut */}
        <div className="tradeoff" style={{ marginTop: 14 }}>
          <div className="tradeoff-col">
            <h3>Why it takes time</h3>
            <p className="help" style={{ marginTop: 0 }}>
              Squaring is the slowest-known way to evaluate this — there is no shortcut through a group of unknown order.
              Doing all {T.toLocaleString()} steps is the delay. (Chia uses a class group so no one knows |G|, so no trusted setup.)
            </p>
          </div>
          <div className="tradeoff-col">
            <h3>Cheap to verify — n-wesolowski</h3>
            <div style={{ margin: "2px 0" }}><Tex expr={"\\pi^{\\ell}\\,g^{\\,r} = y, \\quad r = 2^{T} \\bmod \\ell"} /></div>
            <p className="help" style={{ marginTop: 2 }}>
              The verifier does <b>not</b> redo the {T.toLocaleString()} squarings — it checks the equation above in O(1).
              {" "}prime <code>ℓ = 0x{lastSeg.l.toString(16).slice(0, 12)}…</code> ·{" "}
              <b style={{ color: data.proof.verified ? "#3fb950" : "#ff7b72" }}>{data.proof.verified ? "verified ✓" : "invalid ✗"}</b>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "var(--panel-2)",
  color: "var(--text)",
  border: "1px solid var(--line)",
  borderRadius: 5,
  padding: "5px 10px",
  cursor: "pointer",
  font: "inherit",
};
