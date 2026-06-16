/**
 * The guided story: a curated, ordered walkthrough of the PoST flow, narrated
 * per actor (timelord / farmer / full node), derived deterministically from the
 * existing TimelordTrace. Each step is a snapshot — it points at a moment
 * (playheadIter) and an entity (blockHeight) the UI can focus and inspect with
 * the existing detail modals. No state is copied; the trace is immutable.
 */
import type { ConsensusConstants } from "./constants.ts";
import type { EndOfSubSlotEvent, InfusionEvent, TimelordTrace } from "./events.ts";

export type Actor = "system" | "timelord" | "farmer" | "fullnode";
export type InspectKind = "scan" | "proof" | "lock" | "tx" | "vdf" | "plot" | "infusion" | null;

export interface StoryFact {
  k: string;
  v: string;
}

export interface StoryStep {
  actor: Actor;
  /** if set, draw a message arrow from `actor` to `to`. */
  to?: Actor;
  title: string;
  narrative: string;
  playheadIter: number;
  /** the block this step concerns (so the UI can pin it as the selected event). */
  blockHeight: number | null;
  subSlot: number;
  facts: StoryFact[];
  inspect: InspectKind;
}

export function buildStory(trace: TimelordTrace, c: ConsensusConstants): StoryStep[] {
  const ssi = trace.subSlotIters;
  const interval = trace.spIntervalIters;
  const steps: StoryStep[] = [];
  const infusions = trace.events.filter((e) => e.kind === "infusion") as InfusionEvent[];
  const eosByIndex = new Map<number, EndOfSubSlotEvent>();
  for (const e of trace.events) if (e.kind === "end_of_sub_slot") eosByIndex.set(e.subSlot, e as EndOfSubSlotEvent);

  steps.push({
    actor: "system",
    title: "Genesis",
    narrative:
      "The network's first challenge c0 is fixed, and farmers have planted plots — each a 7-table forest seeded by its plot_id = H(pool_pk ‖ plot_pk). Nothing has been infused yet; the timelord is about to start.",
    playheadIter: 0,
    blockHeight: null,
    subSlot: 0,
    facts: [{ k: "challenge", v: `c0 = ${trace.slots[0].ccChallengeHex}` }],
    inspect: "plot",
  });

  for (let s = 0; s < trace.slots.length; s++) {
    const slot = trace.slots[s];
    steps.push({
      actor: "timelord",
      title: `Sub-slot ${s} begins`,
      narrative:
        `The timelord starts three VDF chains from challenge c${s}: the Challenge Chain (cc) and Reward Chain (rc) always run; the Infused Challenge Chain (ic) runs only while the deficit allows. It will publish ${c.NUM_SPS_SUB_SLOT} signage points, one every ${interval} iters — each a challenge farmers race against.`,
      playheadIter: slot.startIters,
      blockHeight: null,
      subSlot: s,
      facts: [
        { k: "challenge", v: `c${s} = ${slot.ccChallengeHex}` },
        { k: "sub_slot_iters", v: String(ssi) },
      ],
      inspect: "vdf",
    });

    const slotBlocks = infusions.filter((b) => b.subSlot === s).sort((a, b) => a.iterInSlot - b.iterInSlot);
    for (const b of slotBlocks) {
      const n = b.blockHeight + 1;
      const launchSlot = b.overflow ? s - 1 : s;
      const spIter = launchSlot * ssi + b.spIndex * interval;

      steps.push({
        actor: "farmer",
        title: `Farmer wins signage point ${b.spIndex}`,
        narrative:
          `At cc signage point ${b.spIndex}${b.overflow ? ` (in sub-slot ${launchSlot} — an overflow block)` : ""}, the harvester scans the plots.` +
          (b.pos
            ? ` Plot #${b.pos.plotIndex} clears the filter (${b.pos.filterBits} ≥ ${b.pos.filterThreshold} leading zero bits), and its proof of space yields a quality small enough that required_iters = ${b.requiredIters} < ${interval} — it WINS.`
            : ` A proof wins with required_iters = ${b.requiredIters}.`),
        playheadIter: spIter,
        blockHeight: b.blockHeight,
        subSlot: s,
        facts: [
          { k: "signage point", v: String(b.spIndex) },
          ...(b.pos ? [{ k: "plot", v: `#${b.pos.plotIndex}` }] : []),
          { k: "required_iters", v: `${b.requiredIters} < ${interval}` },
        ],
        inspect: "scan",
      });

      steps.push({
        actor: "farmer",
        to: "timelord",
        title: `Farmer signs and submits B${n}`,
        narrative:
          `The plot key (harvester ⊕ farmer) signs twice — the signage point (stage ①, claims the win) and the foliage data (stage ②, commits pool_target + farmer_reward_puzzle_hash). The pool key signs the pool target. The unfinished block is sent to the timelord.`,
        playheadIter: spIter,
        blockHeight: b.blockHeight,
        subSlot: s,
        facts: [{ k: "is challenge block", v: b.isChallengeBlock ? "yes" : "no" }],
        inspect: "lock",
      });

      steps.push({
        actor: "timelord",
        title: `Timelord infuses B${n}`,
        narrative:
          `After 3 more signage-point intervals of VDF (the overflow grace), the timelord reaches B${n}'s infusion point and folds it into the chains. Deficit → ${b.deficit}.` +
          (b.isChallengeBlock
            ? ` This is the challenge block, so it anchors the ICC (cc B${n}).`
            : b.iccActive
              ? ` It infuses into the running ICC.`
              : ``),
        playheadIter: b.totalIters,
        blockHeight: b.blockHeight,
        subSlot: s,
        facts: [
          { k: "ip_iters (in slot)", v: String(b.iterInSlot) },
          { k: "deficit after", v: String(b.deficit) },
        ],
        inspect: "infusion",
      });

      const txNote = b.isTransactionBlock
        ? ` B${n} is a TRANSACTION block (its signage point passed the previous tx block's infusion): it also chains via prev_transaction_block_hash${
            b.prevTxBlockHeight !== null ? ` → B${b.prevTxBlockHeight + 1}` : " (genesis)"
          }, and settles rewards for ${b.rewardClaims.length ? b.rewardClaims.map((h) => `B${h + 1}`).join(", ") : "no earlier blocks"}.`
        : ` B${n} is a non-transaction block — no transactions; its reward is settled by the next tx block.`;
      steps.push({
        actor: "fullnode",
        title: `Full node validates & chains B${n}`,
        narrative:
          `The full node re-checks the proof of space cheaply (re-walk the 64 leaves, ~127 hashes — no plot needed) and the plot/pool signatures, then chains B${n} via prev_block_hash.${txNote}`,
        playheadIter: b.totalIters,
        blockHeight: b.blockHeight,
        subSlot: s,
        facts: [{ k: "transaction block", v: b.isTransactionBlock ? "yes" : "no" }],
        inspect: b.isTransactionBlock ? "tx" : "lock",
      });
    }

    const eos = eosByIndex.get(s);
    if (eos) {
      steps.push({
        actor: "timelord",
        title: `End of sub-slot ${s}`,
        narrative:
          `The cc VDF closes the sub-slot. ${
            eos.hasIcc
              ? `The deficit reached 0, so the ICC folds in: c${s + 1} = H(cc_end ⊕ icc_end).`
              : `The ICC is still open, so c${s + 1} = H(cc_end).`
          } An n-wesolowski proof certifies the whole sub-slot's VDF in O(1).`,
        playheadIter: eos.totalIters,
        blockHeight: null,
        subSlot: s,
        facts: [
          { k: "deficit at end", v: String(eos.deficitAtEnd) },
          { k: "ICC folds in?", v: eos.hasIcc ? "yes" : "no" },
          { k: `→ c${s + 1}`, v: eos.nextCcChallengeHex },
        ],
        inspect: "vdf",
      });
    }
  }

  return steps;
}
