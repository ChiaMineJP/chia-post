/**
 * Where winning blocks come from.
 *
 * The timelord drives a BlockProducer once per sub-slot, handing it the slot's
 * challenge and the real cc signage-point VDF outputs. The producer returns the
 * winning blocks launched from those signage points. Two implementations:
 *   - SeededBlockSource: a deterministic random stand-in (used by tests).
 *   - Farmer (sim/farmer.ts): real plots + plot filter + quality + BLS signing.
 */
import { Rng } from "../crypto/rng.ts";
import type { ConsensusConstants } from "./constants.ts";
import { spIntervalIters } from "./constants.ts";

/** Proof-of-space metadata attached to a winning block (when produced by a real farmer). */
export interface PosInfo {
  plotIndex: number;
  plotIdHex: string;
  qualityHex: string;
  /** the proof's 64 leaf x-values (for the proof-tree visualization). */
  proofXs?: number[];
  plotPkHex: string;
  /** leading zero bits the plot filter actually produced (>= required threshold). */
  filterBits: number;
  filterThreshold: number;
  /** BLS plot signature over the signage point, and whether it verifies. */
  signatureHex: string;
  signatureValid: boolean;
}

export interface WinningBlock {
  spIndex: number;
  requiredIters: number;
  farmerId: number;
  pos?: PosInfo;
}

/** What the timelord knows about a sub-slot when it asks the producer for blocks. */
export interface SlotContext {
  subSlot: number;
  ccChallenge: Uint8Array;
  difficulty: bigint;
  /** cc signage-point VDF output bytes, per signage-point index. */
  ccSpOutputs: Map<number, Uint8Array>;
}

export interface BlockProducer {
  produceForSlot(ctx: SlotContext): WinningBlock[];
}

export interface SeededBlockSourceOpts {
  winProbability?: number;
  numFarmers?: number;
}

/** Deterministic random stand-in (ignores the real signage-point outputs). */
export class SeededBlockSource implements BlockProducer {
  private readonly c: ConsensusConstants;
  private readonly seed: bigint;
  private readonly p: number;
  private readonly numFarmers: number;

  constructor(c: ConsensusConstants, seed: number | bigint, opts: SeededBlockSourceOpts = {}) {
    this.c = c;
    this.seed = BigInt(seed);
    this.p = opts.winProbability ?? 0.18;
    this.numFarmers = opts.numFarmers ?? 5;
  }

  produceForSlot(ctx: SlotContext): WinningBlock[] {
    const rng = new Rng(this.seed ^ (BigInt(ctx.subSlot + 1) * 0x9e3779b97f4a7c15n));
    const interval = Number(spIntervalIters(this.c));
    const out: WinningBlock[] = [];
    for (let sp = 0; sp < this.c.NUM_SPS_SUB_SLOT; sp++) {
      if (rng.nextFloat() < this.p) {
        const requiredIters = 1 + rng.nextInt(interval - 1);
        const farmerId = rng.nextInt(this.numFarmers);
        out.push({ spIndex: sp, requiredIters, farmerId });
      }
    }
    return out;
  }
}
