/**
 * The timelord: the engine that drives the three VDF chains.
 *
 * Now interleaved with the block producer (a real farmer), like real consensus:
 * the timelord computes a sub-slot's cc signage-point VDF outputs, hands them to
 * the producer, and the producer returns the blocks those signage points won.
 * Late signage points overflow into the next sub-slot.
 *
 * Responsibilities (mirrors chia/timelord/timelord.py at a teaching level):
 *   - Run the Challenge Chain (CC) and Reward Chain (RC) continuously.
 *   - Run the Infused Challenge Chain (ICC) only while deficit < MIN-1.
 *   - Infuse each winning block at its ip_iters; track the deficit via deficit.py.
 *   - Close each sub-slot, folding the ICC output into the next CC challenge when
 *     deficit reached 0, and certify the CC VDF with an n-wesolowski proof.
 */
import type { ConsensusConstants } from "./constants.ts";
import { spIntervalIters } from "./constants.ts";
import { ipIters, isOverflowBlock, spIters } from "./iterations.ts";
import type { BlockProducer, PosInfo } from "./blockSource.ts";
import type { Vdf, VdfElement } from "../crypto/vdf.ts";
import { defaultVdf } from "../crypto/vdf.ts";
import { stdHash, utf8, toHex } from "../crypto/hash.ts";
import { serializeForm } from "../crypto/classgroup.ts";
import type {
  ChainSample,
  EndOfSubSlotEvent,
  InfusionEvent,
  SignagePointEvent,
  SlotSummary,
  TimelordEvent,
  TimelordTrace,
  VdfProofSummary,
} from "./events.ts";

const PROOF_SEGMENTS = 3;

/** Exact port of chia/consensus/deficit.py:calculate_deficit. */
export function calculateDeficit(
  c: ConsensusConstants,
  height: number,
  prevDeficit: number | null,
  overflow: boolean,
  numFinishedSubSlots: number,
): number {
  const MIN = c.MIN_BLOCKS_PER_CHALLENGE_BLOCK;
  if (height === 0) return MIN - 1;
  if (prevDeficit === null) throw new Error("prevDeficit required for height>0");
  if (prevDeficit === MIN) {
    if (overflow) {
      if (numFinishedSubSlots > 0) return prevDeficit - 1;
      return prevDeficit;
    }
    return prevDeficit - 1;
  } else if (prevDeficit === 0) {
    if (numFinishedSubSlots === 0) return 0;
    if (numFinishedSubSlots === 1) return overflow ? MIN : MIN - 1;
    return MIN - 1;
  }
  return prevDeficit - 1;
}

interface Block {
  spIndex: number;
  requiredIters: number;
  farmerId: number;
  pos?: PosInfo;
  overflow: boolean;
  ipIterInSlot: number;
  height: number;
  deficit: number;
  isTx: boolean;
  inIc: boolean;
  isChallengeBlock: boolean;
  prevTxBlockHeight: number | null;
  rewardClaims: number[];
}

/** Walk a chain from `challenge`, recording short outputs at each target iter. */
function sampleChain(
  vdf: Vdf,
  challenge: Uint8Array,
  targetIters: number[],
): { shorts: Map<number, string>; end: VdfElement } {
  const sorted = [...new Set(targetIters)].sort((a, b) => a - b);
  const shorts = new Map<number, string>();
  let e = vdf.start(challenge);
  let cur = 0;
  for (const t of sorted) {
    while (cur < t) {
      e = vdf.step(e);
      cur++;
    }
    shorts.set(t, vdf.short(e));
  }
  return { shorts, end: e };
}

/** Walk the cc chain and capture the VDF output BYTES at each signage point. */
function sampleCcSpOutputs(vdf: Vdf, challenge: Uint8Array, c: ConsensusConstants): Map<number, Uint8Array> {
  const targets: { sp: number; iter: number }[] = [];
  for (let sp = 0; sp < c.NUM_SPS_SUB_SLOT; sp++) targets.push({ sp, iter: Number(spIters(c, sp)) });
  targets.sort((a, b) => a.iter - b.iter);
  const out = new Map<number, Uint8Array>();
  let e = vdf.start(challenge);
  let cur = 0;
  for (const { sp, iter } of targets) {
    while (cur < iter) {
      e = vdf.step(e);
      cur++;
    }
    out.set(sp, vdf.toBytes(e));
  }
  return out;
}

/** ICC sampling: the ICC's iteration 0 is the activation point within the slot. */
function sampleIcc(
  vdf: Vdf,
  challenge: Uint8Array,
  activation: number,
  targetItersAbs: number[],
): { shorts: Map<number, string>; end: VdfElement } {
  const sorted = [...new Set(targetItersAbs)].filter((t) => t >= activation).sort((a, b) => a - b);
  const shorts = new Map<number, string>();
  let e = vdf.start(challenge);
  let cur = activation;
  for (const t of sorted) {
    while (cur < t) {
      e = vdf.step(e);
      cur++;
    }
    shorts.set(t, vdf.short(e));
  }
  return { shorts, end: e };
}

export interface TimelordConfig {
  numSubSlots: number;
  vdf?: Vdf;
  genesisChallenge?: string;
}

export function runTimelord(
  c: ConsensusConstants,
  producer: BlockProducer,
  config: TimelordConfig,
): TimelordTrace {
  const vdf = config.vdf ?? defaultVdf;
  const ssi = Number(c.SUB_SLOT_ITERS);
  const interval = Number(spIntervalIters(c));
  const MIN = c.MIN_BLOCKS_PER_CHALLENGE_BLOCK;
  const difficulty = c.DIFFICULTY_STARTING;

  const events: TimelordEvent[] = [];
  const slots: SlotSummary[] = [];

  let ccChallenge = utf8(config.genesisChallenge ?? "chia-post-genesis-cc");
  let rcChallenge = utf8("chia-post-genesis-rc");
  let iccPrev: VdfElement | null = null;

  // Blocks launched late in a sub-slot infuse into the NEXT one (overflow).
  let pendingOverflow: Block[] = [];
  let prevDeficit: number | null = null;
  let prevInfusionSlot = -1;
  let height = 0;
  let icRunning = false;
  // transaction-block tracking (chia/consensus/prev_transaction_block.py): a block
  // is a tx block iff its signage-point total_iters exceeds the previous tx block's
  // total_iters. Rewards are settled in the next tx block.
  let lastTxTotal = -1;
  let lastTxHeight = -1;
  let pendingRewards: number[] = [];

  for (let s = 0; s < config.numSubSlots; s++) {
    const base = s * ssi;

    // 1. Compute this slot's cc signage-point outputs and let the farmer win blocks.
    const ccSpOutputs = sampleCcSpOutputs(vdf, ccChallenge, c);
    const winners = producer.produceForSlot({ subSlot: s, ccChallenge, difficulty, ccSpOutputs });
    const launches: Block[] = winners.map((wb) => ({
      ...wb,
      overflow: isOverflowBlock(c, wb.spIndex),
      ipIterInSlot: Number(ipIters(c, wb.spIndex, BigInt(wb.requiredIters))),
      height: 0,
      deficit: MIN,
      isTx: false,
      inIc: false,
      isChallengeBlock: false,
      prevTxBlockHeight: null,
      rewardClaims: [],
    }));

    // 2. This slot's infusions = overflow carried from last slot + this slot's non-overflow.
    const slotBlocks = [...pendingOverflow, ...launches.filter((l) => !l.overflow)].sort(
      (a, b) => a.ipIterInSlot - b.ipIterInSlot,
    );
    pendingOverflow = launches.filter((l) => l.overflow);

    // 3. Assign deficit / ICC membership / tx flag in infusion order.
    for (const b of slotBlocks) {
      const numFinished = prevInfusionSlot < 0 ? 0 : s - prevInfusionSlot;
      b.height = height++;
      b.deficit = calculateDeficit(c, b.height, prevDeficit, b.overflow, numFinished);
      b.isChallengeBlock = b.deficit === MIN - 1;
      if (b.isChallengeBlock) icRunning = true;
      b.inIc = icRunning;
      if (b.deficit === 0) icRunning = false;
      // transaction block? compare this block's signage-point total_iters to the
      // previous tx block's total_iters. Genesis is always a tx block.
      const launchSlot = b.overflow ? s - 1 : s;
      const spTotal = launchSlot * ssi + b.spIndex * interval;
      const infusionTotal = base + b.ipIterInSlot;
      b.isTx = b.height === 0 || spTotal > lastTxTotal;
      if (b.isTx) {
        b.prevTxBlockHeight = lastTxHeight >= 0 ? lastTxHeight : null;
        b.rewardClaims = pendingRewards; // settles everything pending since the last tx block
        pendingRewards = [b.height];
        lastTxTotal = infusionTotal;
        lastTxHeight = b.height;
      } else {
        b.prevTxBlockHeight = null;
        b.rewardClaims = [];
        pendingRewards.push(b.height);
      }
      prevDeficit = b.deficit;
      prevInfusionSlot = s;
    }

    // 4. Sample the three chains at signage points + infusion points + slot end.
    const infusionIters = slotBlocks.map((b) => b.ipIterInSlot);
    const spTargets: number[] = [];
    for (let sp = 0; sp < c.NUM_SPS_SUB_SLOT; sp++) spTargets.push(Number(spIters(c, sp)));
    const ccRcTargets = [...spTargets, ...infusionIters, ssi];
    const ccSamples = sampleChain(vdf, ccChallenge, ccRcTargets);
    const rcSamples = sampleChain(vdf, rcChallenge, ccRcTargets);

    const iccChallenge: Uint8Array =
      iccPrev === null
        ? stdHash(utf8("icc-seed"), utf8(String(s)))
        : stdHash(utf8("icc"), vdf.toBytes(iccPrev));
    const icBlocks = slotBlocks.filter((b) => b.inIc);
    const iccStart: number | null =
      icBlocks.length === 0 ? null : icBlocks[0].isChallengeBlock ? icBlocks[0].ipIterInSlot : 0;
    const iccTargets = iccStart === null ? [] : [...infusionIters.filter((i) => i >= iccStart), ssi];
    const iccSampled: { shorts: Map<number, string>; end: VdfElement } | null =
      iccStart === null ? null : sampleIcc(vdf, iccChallenge, iccStart, iccTargets);

    const mkSample = (shorts: Map<number, string>, challengeBytes: Uint8Array, it: number): ChainSample => ({
      challengeHex: toHex(challengeBytes, 4),
      iterInSlot: it,
      totalIters: base + it,
      outputHex: shorts.get(it) ?? "?",
    });

    // 5. Emit events.
    for (let sp = 0; sp < c.NUM_SPS_SUB_SLOT; sp++) {
      const it = Number(spIters(c, sp));
      events.push({
        kind: "signage_point",
        subSlot: s,
        spIndex: sp,
        totalIters: base + it,
        iterInSlot: it,
        ccSpOutputFullHex: toHex(ccSpOutputs.get(sp) ?? new Uint8Array()),
        cc: mkSample(ccSamples.shorts, ccChallenge, it),
        rc: mkSample(rcSamples.shorts, rcChallenge, it),
      } satisfies SignagePointEvent);
    }

    for (const b of slotBlocks) {
      const it = b.ipIterInSlot;
      events.push({
        kind: "infusion",
        subSlot: s,
        spIndex: b.spIndex,
        blockHeight: b.height,
        farmerId: b.farmerId,
        requiredIters: b.requiredIters,
        iterInSlot: it,
        totalIters: base + it,
        overflow: b.overflow,
        deficit: b.deficit,
        iccActive: b.inIc,
        isChallengeBlock: b.isChallengeBlock,
        isTransactionBlock: b.isTx,
        prevTxBlockHeight: b.prevTxBlockHeight,
        rewardClaims: b.rewardClaims,
        ...(b.pos ? { pos: b.pos } : {}),
        cc: mkSample(ccSamples.shorts, ccChallenge, it),
        rc: mkSample(rcSamples.shorts, rcChallenge, it),
        ...(b.inIc && iccSampled ? { icc: mkSample(iccSampled.shorts, iccChallenge, it) } : {}),
      } satisfies InfusionEvent);
    }

    // 6. Close the sub-slot.
    const deficitAtEnd = prevDeficit === null ? MIN : prevDeficit;
    const hasIcc: boolean = deficitAtEnd === 0 && iccSampled !== null;

    const nextCc =
      hasIcc && iccSampled
        ? stdHash(utf8("cc"), vdf.toBytes(ccSamples.end), vdf.toBytes(iccSampled.end))
        : stdHash(utf8("cc"), vdf.toBytes(ccSamples.end));
    const nextRc = stdHash(utf8("rc"), vdf.toBytes(rcSamples.end), nextCc);

    const proof = vdf.prove(ccChallenge, ssi, PROOF_SEGMENTS);
    const lastSeg = proof.segments[proof.segments.length - 1];
    const ccProof: VdfProofSummary = {
      segments: proof.segments.length,
      iterations: proof.iterations,
      verified: proof.verified,
      lHex: lastSeg.l.toString(16),
      piHex: toHex(stdHash(serializeForm(lastSeg.pi, vdf.discriminantBits)), 6),
      discriminantBits: vdf.discriminantBits,
    };

    events.push({
      kind: "end_of_sub_slot",
      subSlot: s,
      totalIters: base + ssi,
      deficitAtEnd,
      hasIcc,
      cc: { challengeHex: toHex(ccChallenge, 4), iterInSlot: ssi, totalIters: base + ssi, outputHex: ccSamples.shorts.get(ssi) ?? "?" },
      rc: { challengeHex: toHex(rcChallenge, 4), iterInSlot: ssi, totalIters: base + ssi, outputHex: rcSamples.shorts.get(ssi) ?? "?" },
      ...(hasIcc && iccSampled
        ? { icc: { challengeHex: toHex(iccChallenge, 4), iterInSlot: ssi, totalIters: base + ssi, outputHex: iccSampled.shorts.get(ssi) ?? "?" } }
        : {}),
      nextCcChallengeHex: toHex(nextCc, 4),
      ccProof,
    } satisfies EndOfSubSlotEvent);

    slots.push({
      index: s,
      startIters: base,
      endIters: base + ssi,
      ccChallengeHex: toHex(ccChallenge, 4),
      ccChallengeFullHex: toHex(ccChallenge),
      rcChallengeHex: toHex(rcChallenge, 4),
      numBlocks: slotBlocks.length,
      iccStartIterInSlot: iccStart,
      deficitAtEnd,
      hasIcc,
    });

    ccChallenge = nextCc;
    rcChallenge = nextRc;
    iccPrev = hasIcc && iccSampled ? iccSampled.end : null;
  }

  events.sort((a, b) => a.totalIters - b.totalIters);

  return {
    subSlotIters: ssi,
    spIntervalIters: interval,
    numSpsSubSlot: c.NUM_SPS_SUB_SLOT,
    events,
    slots,
    totalItersEnd: config.numSubSlots * ssi,
  };
}
