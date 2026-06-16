import type { InfusionEvent } from "../sim/events.ts";
import { Tex } from "./Math.tsx";

/**
 * Infusion — what the timelord does when it reaches a block's infusion point:
 * it hashes the block into each *running* VDF chain and continues from a new
 * challenge. Because that challenge depends on the block (which depends on a
 * proof of space), the timelord cannot run ahead — this is the exact moment
 * Space and Time get interleaved.
 */
export function InfusionModal({
  block,
  intervalIters,
  minBlocksPerChallenge,
  onClose,
}: {
  block: InfusionEvent;
  intervalIters: number;
  minBlocksPerChallenge: number;
  onClose: () => void;
}) {
  const n = block.blockHeight + 1;
  const min = minBlocksPerChallenge;

  // The three chains and whether this block folds into each, with the reason.
  const chains: { id: string; name: string; color: string; folded: boolean; reason: string; formula: string; out?: string }[] = [
    {
      id: "rc",
      name: "Reward Chain (rc)",
      color: "var(--rc)",
      folded: true,
      reason: "Every block infuses into the rc — this is what binds the whole block history to elapsed time.",
      formula: "rc_{next} = H(\\,rc_{out} \\,\\Vert\\, B_{" + n + "}\\,)",
      out: block.rc.outputHex,
    },
    {
      id: "cc",
      name: "Challenge Chain (cc)",
      color: "var(--cc)",
      folded: block.isChallengeBlock,
      reason: block.isChallengeBlock
        ? "This is the challenge block (deficit = MIN−1), so it is infused into the cc — it anchors a fresh Infused Challenge Chain."
        : "Only the challenge block infuses into the cc; ordinary blocks leave the cc VDF running untouched.",
      formula: "cc\\,B_{" + n + "} \\;\\Rightarrow\\; \\text{anchors ICC}",
      out: block.cc.outputHex,
    },
    {
      id: "icc",
      name: "Infused Challenge Chain (ic)",
      color: "var(--icc)",
      folded: block.iccActive,
      reason: block.iccActive
        ? "The ICC is running (open between the challenge block and the end of the sub-slot), so this block folds into it too."
        : "The ICC is not running here (deficit hasn't opened it, or it has already closed), so nothing is folded.",
      formula: "ic_{next} = H(\\,ic_{out} \\,\\Vert\\, B_{" + n + "}\\,)",
      out: block.icc?.outputHex,
    },
  ];

  // deficit ladder: MIN .. 0
  const ladder: number[] = [];
  for (let d = min; d >= 0; d--) ladder.push(d);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "min(860px, 94vw)", width: "min(860px, 94vw)" }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2>Infusion — folding B{n} into the chains</h2>
        <p className="help" style={{ marginTop: 2 }}>
          The block was launched at <b>signage point {block.spIndex}</b>. The timelord keeps squaring for <b>3 more
          signage-point intervals</b> (the overflow grace), and at the block's <b>infusion point</b> it stops, hashes the
          block into each <i>running</i> VDF chain, and continues from a new challenge. Because that next challenge depends
          on B{n} — which only exists because a <i>proof of space</i> won — the timelord can't precompute ahead. This is the
          precise moment <b>Space and Time interleave</b>.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--muted)", margin: "8px 0 12px" }}>
          <span>block <code>B{n}</code></span>
          <span>required_iters <code>{block.requiredIters}</code> {"<"} {intervalIters}</span>
          <span>ip_iters (in slot) <code>{block.iterInSlot}</code></span>
          <span>total_iters <code>{block.totalIters}</code></span>
          {block.overflow && <span style={{ color: "var(--win)" }}>overflow block</span>}
        </div>

        {/* which chains get folded */}
        <h3 style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, margin: "0 0 8px" }}>
          What gets folded in
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {chains.map((ch) => (
            <div
              key={ch.id}
              style={{
                border: "1px solid var(--line)",
                borderLeft: `3px solid ${ch.color}`,
                borderRadius: 6,
                padding: "8px 12px",
                background: "var(--panel-2)",
                opacity: ch.folded ? 1 : 0.55,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <b style={{ color: ch.color }}>{ch.name}</b>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    borderRadius: 4,
                    padding: "1px 8px",
                    background: ch.folded ? "rgba(63,185,80,0.18)" : "transparent",
                    border: `1px solid ${ch.folded ? "#3fb950" : "var(--line)"}`,
                    color: ch.folded ? "#3fb950" : "var(--muted)",
                  }}
                >
                  {ch.folded ? "✓ folded in" : "— skipped"}
                </span>
                {ch.folded && <Tex expr={ch.formula} />}
                {ch.folded && ch.out && (
                  <span style={{ marginLeft: "auto", fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--muted)" }}>
                    out = <span style={{ color: ch.color }}>{ch.out}</span>
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>{ch.reason}</div>
            </div>
          ))}
        </div>

        {/* deficit lifecycle */}
        <h3 style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, margin: "16px 0 8px" }}>
          Deficit after this block
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {ladder.map((d) => {
            const active = d === block.deficit;
            const isAnchor = d === min - 1;
            return (
              <div key={d} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 14,
                    border: active ? "2px solid var(--icc)" : "1px solid var(--line)",
                    background: active ? "rgba(210,153,34,0.22)" : d === 0 ? "rgba(63,185,80,0.12)" : "var(--panel-2)",
                    color: active ? "var(--icc)" : d === 0 ? "#3fb950" : "var(--muted)",
                  }}
                >
                  {d}
                </div>
                <span style={{ fontSize: 9, color: "var(--muted)", height: 12 }}>
                  {isAnchor ? "anchor" : d === 0 ? "ICC closes" : ""}
                </span>
              </div>
            );
          })}
        </div>
        <p className="help" style={{ marginTop: 10 }}>
          The <b>deficit</b> counts how many more blocks the Infused Challenge Chain stays open. The challenge block sets it
          to <Tex expr={`\\text{MIN}-1 = ${min - 1}`} />; each later infused block drops it by one. When it reaches{" "}
          <b style={{ color: "#3fb950" }}>0</b>, the ICC sub-slot is emitted at the end of the sub-slot and folded into the{" "}
          <i>next</i> cc challenge: <Tex expr={"c_{next} = H(cc_{end} \\oplus ic_{end})"} />. Here the deficit is now{" "}
          <b style={{ color: "var(--icc)" }}>{block.deficit}</b>.
        </p>
      </div>
    </div>
  );
}
