import { useEffect, useRef } from "react";
import { Tex } from "./Math.tsx";

export interface TxBlock {
  height: number;
  isTx: boolean;
  prevTxBlockHeight: number | null;
  color: string;
}

export interface TxFocus {
  height: number;
  isTx: boolean;
  spTotal: number;
  prevTxHeight: number | null;
  prevTxTotal: number | null;
  rewardClaims: number[];
}

export function TxModal({ blocks, focus, onClose }: { blocks: TxBlock[]; focus: TxFocus; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const w = host.clientWidth;
    const h = 170;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, w, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, focus]);

  function head(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dir * 6, y - 4);
    ctx.lineTo(x + dir * 6, y + 4);
    ctx.closePath();
    ctx.fill();
  }

  function draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = "#0c1410";
    ctx.fillRect(0, 0, w, h);
    const N = blocks.length;
    const padX = 70;
    const blockY = 52;
    const txY = 128;
    const xAt = (i: number) => padX + ((i + 0.5) * (w - padX - 24)) / Math.max(1, N);

    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = "#6f9a85";
    ctx.fillText("block chain", 6, blockY - 18);
    ctx.fillText("(prev_block_hash)", 6, blockY - 6);
    ctx.fillStyle = "#e3b341";
    ctx.fillText("tx chain", 6, txY - 6);
    ctx.fillText("(prev_tx_hash)", 6, txY + 8);

    // block-chain edges (every block → previous)
    ctx.strokeStyle = "#3fb950";
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.4;
    for (let i = 1; i < N; i++) {
      ctx.beginPath();
      ctx.moveTo(xAt(i) - 9, blockY);
      ctx.lineTo(xAt(i - 1) + 9, blockY);
      ctx.stroke();
      head(ctx, xAt(i - 1) + 9, blockY, 1, "#3fb950");
    }
    ctx.globalAlpha = 1;

    // tx-chain edges (tx block → previous tx block, skipping non-tx)
    ctx.strokeStyle = "#e3b341";
    ctx.lineWidth = 1.8;
    for (const b of blocks) {
      if (!b.isTx || b.prevTxBlockHeight === null) continue;
      const x0 = xAt(b.height), x1 = xAt(b.prevTxBlockHeight);
      ctx.beginPath();
      ctx.moveTo(x0 - 9, txY);
      ctx.lineTo(x1 + 9, txY);
      ctx.stroke();
      head(ctx, x1 + 9, txY, 1, "#e3b341");
    }

    // nodes
    for (const b of blocks) {
      const x = xAt(b.height);
      const isFocus = b.height === focus.height;
      // link the two rails for tx blocks
      if (b.isTx) {
        ctx.strokeStyle = "rgba(227,179,65,0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, blockY + 9);
        ctx.lineTo(x, txY - 9);
        ctx.stroke();
      }
      // block-chain node
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(x, blockY, 8, 0, Math.PI * 2);
      ctx.fill();
      if (b.isTx) { ctx.strokeStyle = "#e3b341"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, blockY, 8, 0, Math.PI * 2); ctx.stroke(); }
      if (isFocus) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, blockY, 11, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = "#d8efe2";
      ctx.font = "bold 11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`B${b.height + 1}`, x, blockY - 14);
      // tx-chain node
      if (b.isTx) {
        ctx.fillStyle = "#e3b341";
        ctx.beginPath();
        ctx.arc(x, txY, 7, 0, Math.PI * 2);
        ctx.fill();
        if (isFocus) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, txY, 10, 0, Math.PI * 2); ctx.stroke(); }
      }
      ctx.textAlign = "left";
    }
  }

  const ruleHolds = focus.prevTxTotal === null ? true : focus.spTotal > focus.prevTxTotal;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "min(1000px, 95vw)", width: "min(1000px, 95vw)" }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2>Transaction blocks & the two chains</h2>
        <p className="help" style={{ marginTop: 2 }}>
          <b style={{ color: "#3fb950" }}>Every</b> block links to the previous one (<code>prev_block_hash</code>) — that's the
          block chain. Only <b style={{ color: "#e3b341" }}>transaction blocks</b> also link via{" "}
          <code>prev_transaction_block_hash</code>, forming a sparser second rail that carries the actual transactions.
        </p>
        <div style={{ width: "100%" }}>
          <canvas ref={canvasRef} style={{ width: "100%", display: "block" }} />
        </div>

        <div className="tradeoff" style={{ marginTop: 8 }}>
          <div className="tradeoff-col">
            <h3>Is block B{focus.height + 1} a transaction block?</h3>
            <p className="help" style={{ marginTop: 0 }}>
              A block is a tx block iff its <b>signage-point</b> total_iters exceeds the previous tx block's <b>infusion-point</b> total_iters:
            </p>
            <div style={{ margin: "4px 0" }}>
              <Tex expr={"\\text{is\\_tx} \\iff \\text{total}_{sp}(\\text{new}) > \\text{total}_{ip}(\\text{prev tx})"} />
            </div>
            {focus.prevTxHeight === null ? (
              <div>genesis → always a <b style={{ color: "#e3b341" }}>transaction block</b>.</div>
            ) : (
              <div>
                <Tex expr={`${focus.spTotal} ${ruleHolds ? ">" : "\\le"} ${focus.prevTxTotal}`} />{" "}
                (prev tx = B{focus.prevTxHeight + 1}) →{" "}
                <b style={{ color: focus.isTx ? "#e3b341" : "var(--muted)" }}>{focus.isTx ? "transaction block" : "not a tx block"}</b>
              </div>
            )}
            <p className="help" style={{ marginTop: 6 }}>
              Note the asymmetry: <b>left = this block's signage point</b>, <b>right = the prev tx block's infusion point</b>.
              Since <Tex expr={"\\text{ip}=\\text{sp}+3\\cdot\\text{interval}+r"} />, a tx block's infusion sits ≥3 intervals
              ahead of its signage point — so the next tx block's signage point must clear that gap. Tx blocks land ≳3
              signage-point intervals apart; blocks launched inside that shadow are non-tx (so <b>not</b> every block is a tx block).
            </p>
          </div>
          <div className="tradeoff-col">
            <h3>{focus.isTx ? `What B${focus.height + 1} carries (tx block)` : `B${focus.height + 1} is a non-tx block`}</h3>
            {focus.isTx ? (
              <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                <div><b style={{ color: "var(--muted)" }}>foliage_transaction_block:</b> prev_transaction_block_hash → {focus.prevTxHeight === null ? "genesis" : `B${focus.prevTxHeight + 1}`}, timestamp, additions_root, removals_root</div>
                <div><b style={{ color: "var(--muted)" }}>transactions_info:</b> fees, cost, aggregated_signature, reward_claims</div>
                <div><b style={{ color: "var(--muted)" }}>+ 3rd plot-key signature</b> over the foliage_transaction_block</div>
                <div style={{ marginTop: 4 }}>
                  <b style={{ color: "#e3b341" }}>settles rewards</b> for {focus.rewardClaims.length === 0 ? "no earlier blocks (genesis)" : focus.rewardClaims.map((h) => `B${h + 1}`).join(", ")}
                </div>
              </div>
            ) : (
              <p className="help" style={{ marginTop: 0 }}>
                It still chains via <code>prev_block_hash</code> and carries its proof + signage-point signatures, but holds
                <b> no transactions</b> and no <code>foliage_transaction_block</code>. Its reward is settled by the next tx block.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
