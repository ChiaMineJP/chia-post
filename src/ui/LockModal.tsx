import { useMemo, useState } from "react";
import type { Plot } from "../sim/plot.ts";
import { aggregateSigs, sign, verify } from "../crypto/bls.ts";
import { stdHash, u32be, utf8, hexToBytes, toHex } from "../crypto/hash.ts";
import { Tex } from "./Math.tsx";

export interface LockMeta {
  blockHeight: number;
  plotIndex: number;
  farmerId: number;
  farmerColor: string;
  ccSpHex: string;
  rcSpHex: string;
}

/** plot-key signature = harvester + farmer partial signatures aggregated. */
function plotSign(plot: Plot, msg: Uint8Array): Uint8Array {
  return aggregateSigs([sign(plot.local.sk, msg), sign(plot.farmer.sk, msg)]);
}

export function LockModal({ plot, meta, onClose }: { plot: Plot; meta: LockMeta; onClose: () => void }) {
  const [tampered, setTampered] = useState(false);

  const d = useMemo(() => {
    const ccSp = hexToBytes(meta.ccSpHex);
    const rcSp = hexToBytes(meta.rcSpHex);
    // synthetic foliage fields (faithful shape; values are stand-ins)
    const rewardBlockHash = stdHash(utf8("rc-block"), u32be(meta.blockHeight), ccSp);
    const poolTarget = stdHash(utf8("pool-target"), u32be(meta.farmerId));
    const farmerRewardHonest = stdHash(utf8("farmer-reward"), u32be(meta.farmerId));
    const farmerRewardShown = tampered ? stdHash(utf8("ATTACKER-reward")) : farmerRewardHonest;
    const extensionData = stdHash(utf8("ext"), u32be(meta.blockHeight));
    const foliageHashHonest = stdHash(rewardBlockHash, poolTarget, farmerRewardHonest, extensionData);
    const foliageHashShown = stdHash(rewardBlockHash, poolTarget, farmerRewardShown, extensionData);

    // the farmer signed the HONEST block with the plot key; verify against what's shown
    const ccSpSig = plotSign(plot, ccSp);
    const rcSpSig = plotSign(plot, rcSp);
    const foliageSig = plotSign(plot, foliageHashHonest);
    const poolSig = sign(plot.pool.sk, poolTarget);

    return {
      ccSpSig, ccSpValid: verify(plot.plotPk, ccSp, ccSpSig),
      rcSpSig, rcSpValid: verify(plot.plotPk, rcSp, rcSpSig),
      foliageSig, foliageValid: verify(plot.plotPk, foliageHashShown, foliageSig),
      poolSig, poolValid: verify(plot.pool.pk, poolTarget, poolSig),
      poolTarget: toHex(poolTarget, 6),
      farmerReward: toHex(farmerRewardShown, 6),
      rewardBlockHash: toHex(rewardBlockHash, 6),
    };
  }, [plot, meta, tampered]);

  const allValid = d.ccSpValid && d.rcSpValid && d.foliageValid && d.poolValid;
  const badge = (ok: boolean) => <b style={{ color: ok ? "#3fb950" : "#ff7b72" }}>{ok ? "✓" : "✗"}</b>;
  const c = meta.farmerColor;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "min(960px, 95vw)", width: "min(960px, 95vw)" }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2>The puzzle — how block B{meta.blockHeight + 1} is locked</h2>
        <p className="help" style={{ marginTop: 2 }}>
          A block is locked by nested signatures. Only the winning farmer — who holds the <b>plot key</b> — can produce
          them, and each signature <b>binds the exact contents</b>: change anything and verification fails. Try the
          tamper toggle below.
        </p>

        {/* lock stack */}
        <div className="lockstack">
          <div className="lockrow">
            <span className="lockkey">signage point</span>
            <span>the challenge this block answers: <code>cc_sp = {meta.ccSpHex.slice(0, 14)}…</code>, <code>rc_sp = {meta.rcSpHex.slice(0, 10)}…</code></span>
          </div>
          <div className="lockarrow">▼ only a plot whose proof of space qualifies for <code>cc_sp</code> may attempt</div>
          <div className="lockrow">
            <span className="lockkey">proof of space</span>
            <span><code style={{ color: c }}>plot #{meta.plotIndex}</code> qualifies → the winner holds its <b>plot key</b> <Tex expr={"=\\mathrm{local\\_pk}\\oplus\\mathrm{farmer\\_pk}"} /></span>
          </div>
          <div className="lockarrow">▼ the plot key signs (harvester ⊕ farmer halves), verified against <code>plot_pk</code></div>

          <div className="lockrow lockbox">
            <span className="lockkey" style={{ color: c }}>plot key signs ×2</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: "var(--muted)" }}>① at the signage point — claims the win:</div>
              <div style={{ paddingLeft: 12 }}><Tex expr={"\\mathrm{sig}_{cc} = \\mathrm{plot\\_sk}\\cdot \\mathrm{cc\\_sp}"} /> → <code>{toHex(d.ccSpSig, 5)}</code> {badge(d.ccSpValid)}</div>
              <div style={{ paddingLeft: 12 }}><Tex expr={"\\mathrm{sig}_{rc} = \\mathrm{plot\\_sk}\\cdot \\mathrm{rc\\_sp}"} /> → <code>{toHex(d.rcSpSig, 5)}</code> {badge(d.rcSpValid)}</div>
              <div style={{ color: "var(--muted)", marginTop: 4 }}>② on the foliage — commits the block's contents:</div>
              <div style={{ paddingLeft: 12 }}><Tex expr={"\\mathrm{sig}_{foliage} = \\mathrm{plot\\_sk}\\cdot H(\\mathrm{foliage\\_data})"} /> → <code>{toHex(d.foliageSig, 5)}</code> {badge(d.foliageValid)}</div>
              <div style={{ color: "var(--muted)", fontSize: 11, paddingLeft: 12 }}>(a transaction block adds a 3rd: foliage_transaction_block_signature)</div>
            </div>
          </div>
          <div className="lockrow lockbox">
            <span className="lockkey">pool-key signature</span>
            <div style={{ flex: 1 }}>
              <div><Tex expr={"\\mathrm{sig}_{pool} = \\mathrm{pool\\_sk}\\cdot \\mathrm{pool\\_target}"} /> → <code>{toHex(d.poolSig, 5)}</code> {badge(d.poolValid)}</div>
            </div>
          </div>
          <div className="lockrow lockbox">
            <span className="lockkey">foliage data</span>
            <div style={{ flex: 1, lineHeight: 1.7 }}>
              <div>reward_block_hash <code>{d.rewardBlockHash}</code></div>
              <div>pool_target <code>{d.poolTarget}</code></div>
              <div>farmer_reward_puzzle_hash <code style={{ color: tampered ? "#ff7b72" : undefined }}>{d.farmerReward}</code>{tampered && <b style={{ color: "#ff7b72" }}> ← rewritten by attacker</b>}</div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12 }}>
          <button
            onClick={() => setTampered((t) => !t)}
            style={{ background: tampered ? "#ff7b72" : "var(--panel-2)", color: tampered ? "#07140c" : "var(--text)", border: "1px solid var(--line)", borderRadius: 5, padding: "5px 12px", cursor: "pointer", font: "inherit", fontWeight: 600 }}
          >
            {tampered ? "↩ undo tamper" : "✏️ tamper: steal the reward (rewrite farmer_reward_puzzle_hash)"}
          </button>
          <span style={{ fontWeight: 700, color: allValid ? "#3fb950" : "#ff7b72" }}>
            {allValid ? "✓ block valid — all signatures verify" : "✗ block REJECTED — foliage signature no longer verifies"}
          </span>
        </div>
        <p className="help" style={{ marginTop: 8 }}>
          The attacker can change the reward address, but <b>cannot re-sign</b>: the plot-key signature is over the
          original foliage, and forging a new one needs <code>plot_sk</code> (the harvester ⊕ farmer secret), which only
          the real farmer has. So the signage point + plot key are the only thing that opens this lock — that's what
          binds a block to <i>this</i> farmer and <i>this</i> reward.
        </p>
      </div>
    </div>
  );
}
