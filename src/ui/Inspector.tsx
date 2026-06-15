import type { ChainSample, TimelordEvent } from "../sim/events.ts";
import { TOY_CONSTANTS, spIntervalIters } from "../sim/constants.ts";
import { CHAIN_COLORS, farmerColor } from "./colors.ts";
import { Tex } from "./Math.tsx";

const INT = Number(spIntervalIters(TOY_CONSTANTS));
const SSI = Number(TOY_CONSTANTS.SUB_SLOT_ITERS);
const EXTRA = TOY_CONSTANTS.NUM_SP_INTERVALS_EXTRA;

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="row">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

/** One VDFInfo struct: { challenge, number_of_iterations, output }, shown compactly. */
function VdfInfo({ name, color, s }: { name: string; color: string; s: ChainSample }) {
  return (
    <div style={{ marginBottom: 5 }}>
      <div style={{ color, fontWeight: 600 }}>{name}</div>
      <div style={{ color: "var(--muted)", fontSize: 11 }}>
        output <code style={{ color }}>{s.outputHex}</code> · chal <code>{s.challengeHex}</code> · {s.iterInSlot.toLocaleString()} it
      </div>
    </div>
  );
}

export interface NowState {
  slotIndex: number;
  challengeHex: string;
  ccOut: string;
  rcOut: string;
  iccOut: string | null;
  iccRunning: boolean;
  deficit: number;
  eos?: Extract<TimelordEvent, { kind: "end_of_sub_slot" }>;
}

const ccStyle = { color: CHAIN_COLORS.cc };
const iccStyle = { color: CHAIN_COLORS.icc };
const rcStyle = { color: CHAIN_COLORS.rc };

function NowCol({ now }: { now: NowState }) {
  return (
    <div className="dock-col">
      <h2>Now · sub-slot {now.slotIndex}</h2>
      <Row k="challenge" v={<code style={ccStyle}>c{now.slotIndex} = {now.challengeHex}</code>} />
      <Row k="cc output" v={<code style={ccStyle}>{now.ccOut}</code>} />
      <Row
        k="icc chain"
        v={
          now.iccRunning ? (
            <span><code style={iccStyle}>{now.iccOut ?? "…"}</code> · running</span>
          ) : (
            <span style={{ color: "var(--muted)" }}>idle</span>
          )
        }
      />
      <Row k="rc output" v={<code style={rcStyle}>{now.rcOut}</code>} />
      <Row k="deficit" v={now.deficit} />
    </div>
  );
}

function NextChangeCol({ now }: { now: NowState }) {
  const eos = now.eos;
  return (
    <div className="dock-col">
      <h2>Next slot change → c{now.slotIndex + 1}</h2>
      {!eos && <p className="help">End of the timeline.</p>}
      {eos && (
        <>
          <span className="tag" style={{ background: eos.hasIcc ? CHAIN_COLORS.icc : "#2a4636", color: "#07140c" }}>
            {eos.hasIcc ? "ICC FOLDS IN (deficit 0)" : "ICC STAYS OPEN"}
          </span>
          <Row k="cc end output" v={<code style={ccStyle}>{eos.cc.outputHex}</code>} />
          {eos.hasIcc && eos.icc && <Row k="icc end output" v={<code style={iccStyle}>{eos.icc.outputHex}</code>} />}
          <Row k="= H(struct) →" v={<code style={ccStyle}>{eos.nextCcChallengeHex}</code>} />
          <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 4 }}>
            output ≠ challenge — see 📖 Textbook
          </div>
        </>
      )}
    </div>
  );
}

function EventCol({ event }: { event: TimelordEvent | null }) {
  return (
    <div className="dock-col grow">
      <h2>Selected element</h2>
      {!event && <p className="help">Click a block or signage point (⊗) to pin its info (click again to unpin). Drag to scrub.</p>}

      {event?.kind === "infusion" && (
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div style={{ minWidth: 250 }}>
            <span className="tag" style={{ background: farmerColor(event.blockHeight), color: "#07140c" }}>
              BLOCK B{event.blockHeight + 1}{event.isChallengeBlock ? " · challenge block" : ""}
            </span>
            <Row k="farmer / SP" v={`#${event.farmerId} / sp ${event.spIndex}${event.overflow ? " (overflow)" : ""}`} />
            <Row k="required_iters" v={event.requiredIters.toLocaleString()} />
            <Row k="deficit / tx" v={`${event.deficit}${event.isTransactionBlock ? " / tx block" : ""}`} />
            {event.pos ? (
              <>
                <div style={{ color: "var(--muted)", margin: "6px 0 2px" }}>proof of space + signature:</div>
                <Row k="plot" v={`#${event.pos.plotIndex} (k=8)`} />
                <Row k="plot_id" v={<code>{event.pos.plotIdHex}</code>} />
                <Row k="plot filter" v={`${event.pos.filterBits} ≥ ${event.pos.filterThreshold} zero bits ✓`} />
                <Row k="quality" v={<code>{event.pos.qualityHex}</code>} />
                <Row k="plot_pk" v={<code>{event.pos.plotPkHex}</code>} />
                <Row
                  k="plot sig (BLS)"
                  v={<span><code>{event.pos.signatureHex}</code> {event.pos.signatureValid ? <b style={{ color: "#3fb950" }}>✓</b> : <b style={{ color: "#ff7b72" }}>✗</b>}</span>}
                />
              </>
            ) : (
              <Row k="proof of space" v={<span style={{ color: "var(--muted)" }}>seeded (no farmer)</span>} />
            )}
          </div>
          <div style={{ minWidth: 240, flex: 1 }}>
            <div style={{ color: "var(--muted)", marginBottom: 6 }}>
              Holds — VDFInfo <code>{"{ chal, iters, output }"}</code>:
            </div>
            <VdfInfo name="challenge_chain_ip_vdf" color={CHAIN_COLORS.cc} s={event.cc} />
            {event.icc && <VdfInfo name="infused_challenge_chain_ip_vdf" color={CHAIN_COLORS.icc} s={event.icc} />}
            <VdfInfo name="reward_chain_ip_vdf" color={CHAIN_COLORS.rc} s={event.rc} />
            <div style={{ color: "var(--muted)", margin: "6px 0 2px" }}>iteration math:</div>
            <Tex expr={`r=\\lfloor \\Delta{\\cdot}2^{20}{\\cdot}H(Q\\Vert\\mathrm{sp})\\,/\\,(2^{256}{\\cdot}2176)\\rfloor=${event.requiredIters}`} />
            <br />
            <Tex expr={`\\mathrm{ip}=(${event.spIndex}{\\cdot}${INT}+${EXTRA}{\\cdot}${INT}+${event.requiredIters})\\bmod ${SSI}=${event.iterInSlot}`} />
          </div>
        </div>
      )}

      {event?.kind === "signage_point" && (
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div style={{ minWidth: 205 }}>
            <span className="tag" style={{ background: "#1f3a2d", color: "#d8efe2" }}>
              SIGNAGE POINT {event.spIndex} · sub-slot {event.subSlot}
            </span>
            <Row k="iter in slot" v={event.iterInSlot.toLocaleString()} />
            <Row k="total_iters" v={event.totalIters.toLocaleString()} />
          </div>
          <div style={{ minWidth: 250, flex: 1 }}>
            <div style={{ color: "var(--muted)", marginBottom: 6 }}>VDFInfo published here:</div>
            <VdfInfo name="challenge_chain_sp_vdf" color={CHAIN_COLORS.cc} s={event.cc} />
            <VdfInfo name="reward_chain_sp_vdf" color={CHAIN_COLORS.rc} s={event.rc} />
          </div>
        </div>
      )}

      {event?.kind === "end_of_sub_slot" && (
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div style={{ minWidth: 235 }}>
            <span className="tag" style={{ background: event.hasIcc ? CHAIN_COLORS.icc : "#2a4636", color: "#07140c" }}>
              END OF SUB-SLOT {event.subSlot}
            </span>
            <Row k="deficit at end" v={event.deficitAtEnd} />
            <Row k="ICC sub-slot?" v={event.hasIcc ? "yes (deficit==0)" : "no"} />
            <Row k="cc end output" v={<code style={ccStyle}>{event.cc.outputHex}</code>} />
            {event.icc && <Row k="icc end output" v={<code style={iccStyle}>{event.icc.outputHex}</code>} />}
            <Row k="→ new challenge" v={<code style={ccStyle}>{event.nextCcChallengeHex}</code>} />
            <div style={{ marginTop: 4 }}>
              <Tex expr={event.hasIcc ? "c_{n+1}=H(\\text{cc\\_end}\\Vert\\text{icc\\_end})" : "c_{n+1}=H(\\text{cc\\_end})"} />
            </div>
          </div>
          <div style={{ minWidth: 235 }}>
            <span
              className="tag"
              style={{ background: event.ccProof.verified ? "#3fb950" : "#ff7b72", color: "#07140c" }}
            >
              {event.ccProof.verified ? "✓ VERIFIED" : "✗ INVALID"} · {event.ccProof.segments}-wesolowski
            </span>
            <div style={{ margin: "2px 0 4px" }}>
              <Tex expr={"y=g^{2^{T}},\\ \\ \\pi^{\\ell}g^{r}=y,\\ r=2^{T}\\!\\bmod \\ell"} />
            </div>
            <Row k="iterations proven" v={event.ccProof.iterations.toLocaleString()} />
            <Row k="segments" v={event.ccProof.segments} />
            <Row k="Fiat-Shamir l" v={<code>0x{event.ccProof.lHex.slice(0, 12)}…</code>} />
            <Row k="proof element π" v={<code>{event.ccProof.piHex}</code>} />
          </div>
        </div>
      )}
    </div>
  );
}

function LegendCol() {
  return (
    <div className="dock-col">
      <h2>Legend</h2>
      <div className="legend">
        <span><i className="swatch" style={{ background: CHAIN_COLORS.cc }} /> cc</span>
        <span><i className="swatch" style={{ background: CHAIN_COLORS.icc }} /> ic</span>
        <span><i className="swatch" style={{ background: CHAIN_COLORS.rc }} /> rc</span>
        <span><b>⊗</b> VDF point</span>
        <span><b>━</b> solid = dependency</span>
        <span><b>┈</b> dashed = infusion</span>
        <span><code>cc Bn</code> challenge block</span>
      </div>
      <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 8 }}>
        Concepts &amp; the spec table live in <b>📖 Textbook</b> (top controls).
      </div>
    </div>
  );
}

export function Inspector({ event, now }: { event: TimelordEvent | null; now: NowState }) {
  return (
    <div className="dock">
      <NowCol now={now} />
      <NextChangeCol now={now} />
      <EventCol event={event} />
      <LegendCol />
    </div>
  );
}
