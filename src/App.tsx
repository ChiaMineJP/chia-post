import { useEffect, useMemo, useRef, useState } from "react";
import { TOY_CONSTANTS } from "./sim/constants.ts";
import { expectedPlotSize } from "./sim/iterations.ts";
import { generatePlots } from "./sim/plot.ts";
import { Farmer } from "./sim/farmer.ts";
import { runTimelord } from "./sim/timelord.ts";
import { verifyProof, findProofs, proofPathIndices } from "./sim/proofofspace.ts";
import { buildStory, type InspectKind } from "./sim/story.ts";
import type { TimelordEvent } from "./sim/events.ts";
import { hexToBytes, toHex } from "./crypto/hash.ts";
import { TimelineCanvas } from "./ui/TimelineCanvas.tsx";
import { Inspector } from "./ui/Inspector.tsx";
import { Textbook } from "./ui/Textbook.tsx";
import { PlotScanModal } from "./ui/PlotScanModal.tsx";
import { ProofModal } from "./ui/ProofModal.tsx";
import { StoryView } from "./ui/StoryView.tsx";
import { PlotModal } from "./ui/PlotModal.tsx";
import { LockModal } from "./ui/LockModal.tsx";
import { TxModal } from "./ui/TxModal.tsx";
import { VdfModal } from "./ui/VdfModal.tsx";
import { InfusionModal } from "./ui/InfusionModal.tsx";
import { LabView } from "./lab/LabView.tsx";
import { farmerColor } from "./ui/colors.ts";

const NUM_SUB_SLOTS = 4;
const NUM_PLOTS = 16;
const NUM_FARMERS = 4;
const MAX_REQUIRED = Number(
  (TOY_CONSTANTS.DIFFICULTY_STARTING * TOY_CONSTANTS.DIFFICULTY_CONSTANT_FACTOR) / expectedPlotSize(TOY_CONSTANTS.K),
);

export function App() {
  const [seed, setSeed] = useState(1234);
  const plots = useMemo(() => generatePlots(seed, NUM_PLOTS, NUM_FARMERS), [seed]);
  const farmer = useMemo(() => new Farmer(TOY_CONSTANTS, plots), [plots]);
  const trace = useMemo(
    () => runTimelord(TOY_CONSTANTS, farmer, { numSubSlots: NUM_SUB_SLOTS }),
    [farmer],
  );

  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(800); // iters per second of wall clock
  // Mini PoST is small enough to show the whole chain by default.
  const [viewIters, setViewIters] = useState(trace.totalItersEnd);
  const [hover, setHover] = useState<TimelordEvent | null>(null);
  const [selected, setSelected] = useState<TimelordEvent | null>(null);
  const [showDeps, setShowDeps] = useState(true);
  const [showBook, setShowBook] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [showProof, setShowProof] = useState(false);
  const [showVdf, setShowVdf] = useState(false);
  const [showPlot, setShowPlot] = useState(false);
  const [showLock, setShowLock] = useState(false);
  const [showTx, setShowTx] = useState(false);
  const [showInfusion, setShowInfusion] = useState(false);
  const [view, setView] = useState<"mini" | "lab">("mini");

  // Guided story (dedicated sequence-diagram walkthrough), reusing the modals.
  const story = useMemo(() => buildStory(trace, TOY_CONSTANTS), [trace]);
  const [showStory, setShowStory] = useState(false);
  const [storyIndex, setStoryIndex] = useState(0);
  const [storyPlaying, setStoryPlaying] = useState(false);
  const infusionByHeight = useMemo(() => {
    const m = new Map<number, Extract<TimelordEvent, { kind: "infusion" }>>();
    for (const e of trace.events) if (e.kind === "infusion") m.set(e.blockHeight, e);
    return m;
  }, [trace]);
  const storyFocus = (iter: number, h: number | null) => {
    setPlayhead(iter);
    setSelected(h === null ? null : infusionByHeight.get(h) ?? null);
  };
  const storyInspect = (kind: InspectKind, h: number | null) => {
    if (h !== null) setSelected(infusionByHeight.get(h) ?? null);
    if (kind === "scan") setShowScan(true);
    else if (kind === "proof") setShowProof(true);
    else if (kind === "lock") setShowLock(true);
    else if (kind === "tx") setShowTx(true);
    else if (kind === "vdf") setShowVdf(true);
    else if (kind === "plot") setShowPlot(true);
    else if (kind === "infusion") setShowInfusion(true);
  };

  // The infused block for the infusion modal: the selected block, else nearest.
  const infusionData = useMemo(() => {
    if (!showInfusion) return null;
    let block: Extract<TimelordEvent, { kind: "infusion" }> | null =
      selected?.kind === "infusion" ? selected : null;
    if (!block) {
      let bd = Infinity;
      for (const e of trace.events) {
        if (e.kind !== "infusion") continue;
        const d = Math.abs(e.totalIters - playhead);
        if (d < bd) { bd = d; block = e; }
      }
    }
    return block;
  }, [showInfusion, selected, playhead, trace]);

  // Transaction-block rails: all blocks + the focused block's tx-rule values.
  const txData = useMemo(() => {
    if (!showTx) return null;
    const infusions = trace.events.filter((e) => e.kind === "infusion") as Extract<TimelordEvent, { kind: "infusion" }>[];
    if (infusions.length === 0) return null;
    const ssi = trace.subSlotIters;
    const interval = trace.spIntervalIters;
    const blocks = infusions.map((b) => ({
      height: b.blockHeight,
      isTx: b.isTransactionBlock,
      prevTxBlockHeight: b.prevTxBlockHeight,
      color: farmerColor(b.blockHeight),
    }));
    // focus: selected block, else nearest to playhead
    let f = selected?.kind === "infusion" ? selected : null;
    if (!f) {
      let bd = Infinity;
      for (const b of infusions) { const d = Math.abs(b.totalIters - playhead); if (d < bd) { bd = d; f = b; } }
    }
    if (!f) return null;
    const launchSlot = f.overflow ? f.subSlot - 1 : f.subSlot;
    const spTotal = launchSlot * ssi + f.spIndex * interval;
    const prevTxTotal = f.prevTxBlockHeight !== null
      ? infusions.find((b) => b.blockHeight === f!.prevTxBlockHeight)?.totalIters ?? null
      : null;
    return {
      blocks,
      focus: {
        height: f.blockHeight,
        isTx: f.isTransactionBlock,
        spTotal,
        prevTxHeight: f.prevTxBlockHeight,
        prevTxTotal,
        rewardClaims: f.rewardClaims,
      },
    };
  }, [showTx, selected, playhead, trace]);

  // The lock/puzzle for the selected (or nearest) block: its plot keys + signage point.
  const lockData = useMemo(() => {
    if (!showLock) return null;
    let block: Extract<TimelordEvent, { kind: "infusion" }> | null = null;
    if (selected?.kind === "infusion" && selected.pos) block = selected;
    if (!block) {
      let bd = Infinity;
      for (const e of trace.events) {
        if (e.kind !== "infusion" || !e.pos) continue;
        const d = Math.abs(e.totalIters - playhead);
        if (d < bd) { bd = d; block = e; }
      }
    }
    if (!block?.pos) return null;
    const launchSlot = block.overflow ? block.subSlot - 1 : block.subSlot;
    const spEv = trace.events.find(
      (e) => e.kind === "signage_point" && e.subSlot === launchSlot && e.spIndex === block!.spIndex,
    ) as Extract<TimelordEvent, { kind: "signage_point" }> | undefined;
    if (!spEv) return null;
    const plot = plots[block.pos.plotIndex];
    return {
      plot,
      meta: {
        blockHeight: block.blockHeight,
        plotIndex: block.pos.plotIndex,
        farmerId: plot.farmerId,
        farmerColor: farmerColor(block.blockHeight),
        ccSpHex: spEv.ccSpOutputFullHex,
        rcSpHex: spEv.rc.outputHex,
      },
    };
  }, [showLock, selected, playhead, trace, plots]);

  // The full plot (forest) for the selected block's plot, with its proof path.
  const plotData = useMemo(() => {
    if (!showPlot) return null;
    let block: Extract<TimelordEvent, { kind: "infusion" }> | null = null;
    if (selected?.kind === "infusion" && selected.pos) block = selected;
    if (!block) {
      let bd = Infinity;
      for (const e of trace.events) {
        if (e.kind !== "infusion" || !e.pos) continue;
        const d = Math.abs(e.totalIters - playhead);
        if (d < bd) { bd = d; block = e; }
      }
    }
    if (!block?.pos) return null;
    const launchSlot = block.overflow ? block.subSlot - 1 : block.subSlot;
    const spEv = trace.events.find(
      (e) => e.kind === "signage_point" && e.subSlot === launchSlot && e.spIndex === block!.spIndex,
    ) as Extract<TimelordEvent, { kind: "signage_point" }> | undefined;
    if (!spEv) return null;
    const forest = farmer.forest(block.pos.plotIndex);
    const t7 = findProofs(forest, hexToBytes(spEv.ccSpOutputFullHex));
    const path = t7.length ? proofPathIndices(forest, t7[0]) : null;
    const plot = plots[block.pos.plotIndex];
    return {
      forest,
      path,
      meta: {
        plotIndex: block.pos.plotIndex,
        farmerId: plot.farmerId,
        farmerColor: farmerColor(block.blockHeight),
        challengeHex: spEv.ccSpOutputFullHex,
        localPkHex: toHex(plot.local.pk, 6),
        farmerPkHex: toHex(plot.farmer.pk, 6),
        poolPkHex: toHex(plot.pool.pk, 6),
        plotPkHex: toHex(plot.plotPk, 6),
        plotIdHex: toHex(plot.plotId, 8),
      },
    };
  }, [showPlot, selected, playhead, trace, farmer]);

  // Proof-of-space tree for the selected block (or the block nearest the playhead).
  const proofData = useMemo(() => {
    if (!showProof) return null;
    let block: Extract<TimelordEvent, { kind: "infusion" }> | null = null;
    if (selected?.kind === "infusion" && selected.pos?.proofXs) block = selected;
    if (!block) {
      let bd = Infinity;
      for (const e of trace.events) {
        if (e.kind !== "infusion" || !e.pos?.proofXs) continue;
        const d = Math.abs(e.totalIters - playhead);
        if (d < bd) { bd = d; block = e; }
      }
    }
    if (!block?.pos?.proofXs) return null;
    const launchSlot = block.overflow ? block.subSlot - 1 : block.subSlot;
    const spEv = trace.events.find(
      (e) => e.kind === "signage_point" && e.subSlot === launchSlot && e.spIndex === block!.spIndex,
    ) as Extract<TimelordEvent, { kind: "signage_point" }> | undefined;
    if (!spEv) return null;
    const proof = verifyProof(plots[block.pos.plotIndex].plotId, block.pos.proofXs, hexToBytes(spEv.ccSpOutputFullHex));
    return {
      proof,
      meta: {
        blockHeight: block.blockHeight,
        plotIndex: block.pos.plotIndex,
        challengeHex: spEv.ccSpOutputFullHex,
        farmerColor: farmerColor(block.blockHeight),
        tableSizes: farmer.forestSizes(block.pos.plotIndex),
      },
    };
  }, [showProof, selected, playhead, trace, plots]);

  // Plot scan for the relevant signage point: the selected sp, a selected block's
  // launch sp, or the signage point nearest the playhead.
  const scanData = useMemo(() => {
    if (!showScan) return null;
    let spEv: Extract<TimelordEvent, { kind: "signage_point" }> | null = null;
    if (selected?.kind === "signage_point") {
      spEv = selected;
    } else if (selected?.kind === "infusion") {
      const launchSlot = selected.overflow ? selected.subSlot - 1 : selected.subSlot;
      spEv = (trace.events.find(
        (e) => e.kind === "signage_point" && e.subSlot === launchSlot && e.spIndex === selected.spIndex,
      ) as Extract<TimelordEvent, { kind: "signage_point" }> | undefined) ?? null;
    }
    if (!spEv) {
      let bd = Infinity;
      for (const e of trace.events) {
        if (e.kind !== "signage_point") continue;
        const d = Math.abs(e.totalIters - playhead);
        if (d < bd) { bd = d; spEv = e; }
      }
    }
    if (!spEv) return null;
    const slot = trace.slots[spEv.subSlot];
    const scans = farmer.scan(
      hexToBytes(slot.ccChallengeFullHex),
      hexToBytes(spEv.ccSpOutputFullHex),
      TOY_CONSTANTS.DIFFICULTY_STARTING,
    );
    return {
      scans,
      meta: {
        subSlot: spEv.subSlot,
        spIndex: spEv.spIndex,
        spOutputHex: spEv.ccSpOutputFullHex,
        challengeHex: slot.ccChallengeFullHex,
        threshold: TOY_CONSTANTS.NUMBER_ZERO_BITS_PLOT_FILTER,
        interval: trace.spIntervalIters,
        maxRequired: MAX_REQUIRED,
      },
    };
  }, [showScan, selected, playhead, trace, farmer]);

  // Click an element to pin it in the panel; click it again to unpin.
  const toggleSelect = (ev: TimelordEvent) => setSelected((prev) => (prev === ev ? null : ev));

  // Keep the view window centred-ish on the playhead.
  const viewStart = useMemo(() => {
    const half = viewIters / 2;
    let start = playhead - half;
    start = Math.max(0, Math.min(start, Math.max(0, trace.totalItersEnd - viewIters)));
    return start;
  }, [playhead, viewIters, trace.totalItersEnd]);

  // Animation loop.
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) {
      lastRef.current = null;
      return;
    }
    const tick = (t: number) => {
      if (lastRef.current != null) {
        const dt = (t - lastRef.current) / 1000;
        setPlayhead((p) => {
          const next = p + dt * speed;
          if (next >= trace.totalItersEnd) {
            setPlaying(false);
            return trace.totalItersEnd;
          }
          return next;
        });
      }
      lastRef.current = t;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, speed, trace.totalItersEnd]);

  // current deficit = deficit of the last infusion before the playhead
  const currentDeficit = useMemo(() => {
    let d = TOY_CONSTANTS.MIN_BLOCKS_PER_CHALLENGE_BLOCK;
    for (const e of trace.events) {
      if (e.totalIters > playhead) break;
      if (e.kind === "infusion") d = e.deficit;
      if (e.kind === "end_of_sub_slot") d = e.deficitAtEnd;
    }
    return d;
  }, [trace, playhead]);

  const blocksSoFar = useMemo(
    () => trace.events.filter((e) => e.kind === "infusion" && e.totalIters <= playhead).length,
    [trace, playhead],
  );

  // Live "now" state at the playhead: the current sub-slot, the three chains'
  // current VDF outputs, the ICC status, and a preview of the next slot change.
  const now = useMemo(() => {
    const ssi = trace.subSlotIters;
    const slotIndex = Math.min(trace.slots.length - 1, Math.floor(playhead / ssi));
    const slot = trace.slots[slotIndex];
    let ccOut = "—";
    let rcOut = "—";
    let iccOut: string | null = null;
    let deficit = TOY_CONSTANTS.MIN_BLOCKS_PER_CHALLENGE_BLOCK;
    for (const e of trace.events) {
      if (e.totalIters > playhead) break;
      if (e.subSlot === slotIndex) {
        ccOut = e.cc.outputHex;
        rcOut = e.rc.outputHex;
        const ev = e as { icc?: { outputHex: string } };
        if (ev.icc) iccOut = ev.icc.outputHex;
      }
      if (e.kind === "infusion") deficit = e.deficit;
      if (e.kind === "end_of_sub_slot") deficit = e.deficitAtEnd;
    }
    const inSlotIter = playhead - slot.startIters;
    const iccRunning = slot.iccStartIterInSlot !== null && inSlotIter >= slot.iccStartIterInSlot;
    const eos = trace.events.find(
      (e) => e.kind === "end_of_sub_slot" && e.subSlot === slotIndex,
    ) as Extract<TimelordEvent, { kind: "end_of_sub_slot" }> | undefined;
    return { slotIndex, challengeHex: slot.ccChallengeHex, ccOut, rcOut, iccOut, iccRunning, deficit, eos };
  }, [trace, playhead]);

  return (
    <>
      <div className="topbar">
        <h1><span>chia-post</span> · Proof of Space <i style={{ color: "var(--muted)" }}>and</i> Time</h1>
        <div className="mode-switch">
          <button className={view === "mini" ? "active" : ""} onClick={() => setView("mini")}>Mini PoST</button>
          <button className={view === "lab" ? "active" : ""} onClick={() => setView("lab")}>PoST Lab</button>
        </div>
        {view === "mini" && <span className="chip">k = {TOY_CONSTANTS.K} · toy scale</span>}
        <span className="sub hide-narrow">
          {view === "mini"
            ? "real class-group VDFs · BLS-signed blocks · live timelord ↔ farmer loop"
            : "one signage point, step by step — VDF, the 7-table proof, required_iters, and BLS signing in full"}
        </span>
        <span style={{ flex: 1 }} />
        {view === "mini" && (
          <label className="seed">
            <span className="sub">seed</span>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 0)}
            />
          </label>
        )}
      </div>

      {view === "lab" && <LabView />}

      {view === "mini" && (
       <>
      <div className="main">
        <div className="canvas-host">
          <TimelineCanvas
            trace={trace}
            playheadIters={playhead}
            viewStart={viewStart}
            viewIters={viewIters}
            showDeps={showDeps}
            selectedEvent={selected}
            hoverEvent={hover}
            onScrubTo={setPlayhead}
            onHover={setHover}
            onSelect={toggleSelect}
          />
        </div>
        <div className="controls">
          <button className="primary" onClick={() => setPlaying((p) => !p)}>
            {playing ? "❚❚ pause" : "▶ play"}
          </button>
          <button onClick={() => { setPlayhead(0); setPlaying(false); }}>⏮ reset</button>
          <button onClick={() => setShowDeps((d) => !d)} style={showDeps ? { borderColor: "var(--cc)" } : undefined}>
            {showDeps ? "↳ deps on" : "↳ deps off"}
          </button>
          <input
            type="range"
            min={0}
            max={trace.totalItersEnd}
            value={playhead}
            onChange={(e) => setPlayhead(Number(e.target.value))}
          />
          <span className="readout">speed</span>
          <input type="range" style={{ flex: "0 0 90px" }} min={100} max={4000} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
          <span className="readout">zoom</span>
          <input
            type="range"
            style={{ flex: "0 0 90px" }}
            min={trace.subSlotIters / 4}
            max={trace.totalItersEnd}
            value={viewIters}
            onChange={(e) => setViewIters(Number(e.target.value))}
          />
          <span className="readout">
            deficit <b>{currentDeficit}</b> · blocks <b>{blocksSoFar}</b>
          </span>
        </div>
        <div className="toolbar">
          <button className="story" onClick={() => { setStoryIndex(0); setStoryPlaying(false); setShowStory(true); }}>🎬 story</button>
          <span className="divider" />
          <span className="group-label">time</span>
          <button onClick={() => setShowVdf(true)}>⏱ proof of time</button>
          <span className="divider" />
          <span className="group-label">space</span>
          <button onClick={() => setShowScan(true)}>🔍 plot scan</button>
          <button onClick={() => setShowPlot(true)}>🌳 plot</button>
          <button onClick={() => setShowProof(true)}>🧬 proof of space</button>
          <span className="divider" />
          <span className="group-label">block</span>
          <button onClick={() => setShowLock(true)}>🔒 puzzle</button>
          <button onClick={() => setShowTx(true)}>💸 tx blocks</button>
          <span className="spacer" />
          <button onClick={() => setShowBook(true)}>📖 textbook</button>
        </div>
      </div>
      <Inspector event={selected} now={now} />
      {showScan && scanData && (
        <PlotScanModal meta={scanData.meta} scans={scanData.scans} onClose={() => setShowScan(false)} />
      )}
      {showProof && proofData && (
        <ProofModal proof={proofData.proof} meta={proofData.meta} onClose={() => setShowProof(false)} />
      )}
      {showVdf && (
        <VdfModal challengeHex={trace.slots[now.slotIndex].ccChallengeFullHex} onClose={() => setShowVdf(false)} />
      )}
      {showPlot && plotData && (
        <PlotModal forest={plotData.forest} path={plotData.path} meta={plotData.meta} onClose={() => setShowPlot(false)} />
      )}
      {showLock && lockData && (
        <LockModal plot={lockData.plot} meta={lockData.meta} onClose={() => setShowLock(false)} />
      )}
      {showTx && txData && (
        <TxModal blocks={txData.blocks} focus={txData.focus} onClose={() => setShowTx(false)} />
      )}
      {showInfusion && infusionData && (
        <InfusionModal
          block={infusionData}
          intervalIters={trace.spIntervalIters}
          minBlocksPerChallenge={Number(TOY_CONSTANTS.MIN_BLOCKS_PER_CHALLENGE_BLOCK)}
          onClose={() => setShowInfusion(false)}
        />
      )}
      {showStory && (
        <StoryView
          steps={story}
          index={Math.min(storyIndex, story.length - 1)}
          setIndex={setStoryIndex}
          playing={storyPlaying}
          setPlaying={setStoryPlaying}
          onFocus={storyFocus}
          onInspect={storyInspect}
          onClose={() => { setStoryPlaying(false); setShowStory(false); }}
        />
      )}
      {showBook && <Textbook onClose={() => setShowBook(false)} />}
       </>
      )}
    </>
  );
}
