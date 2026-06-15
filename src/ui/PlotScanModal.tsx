import type { PlotScan } from "../sim/farmer.ts";
import { farmerColor } from "./colors.ts";
import { Tex } from "./Math.tsx";

export interface ScanMeta {
  subSlot: number;
  spIndex: number;
  spOutputHex: string;
  challengeHex: string;
  threshold: number;
  interval: number;
  maxRequired: number;
}

/** Render the first 16 bits of a value, highlighting the leading-zero run + threshold. */
function BitStrip({ value16, leadingZeros, threshold }: { value16: number; leadingZeros: number; threshold: number }) {
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < 16; i++) {
    const bit = (value16 >> (15 - i)) & 1;
    const cls = i < leadingZeros ? "bit lead" : bit === 0 ? "bit zero" : "bit one";
    cells.push(<span key={i} className={cls}>{bit}</span>);
    if (threshold !== undefined && i === threshold - 1) cells.push(<span key={`t${i}`} className="bit-thresh" />);
  }
  return <span className="bits">{cells}</span>;
}

function Meter({ required, interval, max }: { required: number; interval: number; max: number }) {
  const winPct = Math.min(100, (interval / max) * 100);
  const needlePct = Math.min(100, Math.max(0, (required / max) * 100));
  return (
    <span className="meter" title={`required_iters ${required} (win if < ${interval})`}>
      <span className="win-zone" style={{ width: `${winPct}%` }} />
      <span className="needle" style={{ left: `${needlePct}%` }} />
    </span>
  );
}

export function PlotScanModal({ meta, scans, onClose }: { meta: ScanMeta; scans: PlotScan[]; onClose: () => void }) {
  const sorted = [...scans].sort(
    (a, b) =>
      Number(b.wins) - Number(a.wins) ||
      Number(b.passes) - Number(a.passes) ||
      b.filterLeadingZeros - a.filterLeadingZeros,
  );
  const passed = scans.filter((s) => s.passes).length;
  const won = scans.filter((s) => s.wins).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 860 }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2>Plot scan — sub-slot {meta.subSlot}, signage point sp{meta.spIndex}</h2>
        <p className="help" style={{ marginTop: 2 }}>
          A plot is <b>eligible</b> iff its filter hash has ≥ {meta.threshold} leading zero bits (green); it <b>wins</b> iff its
          real proof-of-space quality is small enough — also leading zeros! — that required_iters lands in the window.
        </p>
        <div style={{ margin: "2px 0 8px", color: "var(--muted)" }}>
          <Tex
            block
            expr={`\\text{eligible} \\iff \\mathrm{lz}\\big(H(\\mathrm{id}\\Vert\\mathrm{ch}\\Vert\\mathrm{sp})\\big)\\ge ${meta.threshold}, \\qquad \\text{win} \\iff r=\\Big\\lfloor\\tfrac{\\Delta\\cdot 2^{20}\\cdot H(Q\\Vert\\mathrm{sp})}{2^{256}\\cdot 2176}\\Big\\rfloor < ${meta.interval}`}
          />
        </div>
        <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 8 }}>
          challenge <code>{meta.challengeHex.slice(0, 16)}…</code> · sp output <code>{meta.spOutputHex.slice(0, 16)}…</code>
          <br />
          <b style={{ color: "var(--text)" }}>{passed}/{scans.length}</b> passed the filter · <b style={{ color: "#3fb950" }}>{won}</b> won
        </div>
        <table className="scan-grid">
          <thead>
            <tr>
              <th>plot</th>
              <th>plot filter — H(plot_id ‖ challenge ‖ sp), first 16 bits</th>
              <th>elig.</th>
              <th>quality bits</th>
              <th>required_iters &lt; {meta.interval}?</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.plotIndex} style={{ opacity: s.passes ? 1 : 0.45 }}>
                <td style={{ color: farmerColor(s.plotIndex), fontWeight: 600, whiteSpace: "nowrap" }}>#{s.plotIndex}</td>
                <td>
                  <BitStrip value16={s.filter16} leadingZeros={s.filterLeadingZeros} threshold={s.filterThreshold} />
                  <span style={{ color: "var(--muted)", marginLeft: 8, fontSize: 11 }}>{s.filterLeadingZeros}z</span>
                </td>
                <td className={s.passes ? "badge-pass" : "badge-fail"}>{s.passes ? "pass" : "—"}</td>
                <td>
                  {s.passes && s.quality16 !== null && s.qualityLeadingZeros !== null ? (
                    <BitStrip value16={s.quality16} leadingZeros={s.qualityLeadingZeros} threshold={0} />
                  ) : (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  )}
                </td>
                <td>
                  {s.passes && s.requiredIters !== null ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <Meter required={s.requiredIters} interval={meta.interval} max={meta.maxRequired} />
                      <span className={s.wins ? "badge-win" : "badge-lose"}>
                        {s.requiredIters} {s.wins ? "✓ win" : "lose"}
                      </span>
                    </span>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
