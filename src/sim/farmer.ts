/**
 * The farmer/harvester: for each signage point, scan the plots, keep the ones
 * that pass the filter, turn their quality into required_iters, and -- for the
 * winners -- produce a real BLS plot signature over the signage point.
 *
 * This replaces the seeded random source with actual proof-of-space, so blocks
 * are *earned*: a block exists only because some plot passed the filter and its
 * quality landed inside the signage-point window.
 */
import type { BlockProducer, PosInfo, SlotContext, WinningBlock } from "./blockSource.ts";
import type { ConsensusConstants } from "./constants.ts";
import { spIntervalIters } from "./constants.ts";
import { requiredItersFromQuality } from "./iterations.ts";
import {
  type Plot,
  leadingZeroBits,
  plotFilterValue,
  plotIdHex,
} from "./plot.ts";
import { buildForest, findProofs, leafXs, verifyProof, POS, type PosForest } from "./proofofspace.ts";
import { aggregateSigs, sign, verify } from "../crypto/bls.ts";
import { bytesToBigInt, stdHash, toHex } from "../crypto/hash.ts";

/** Per-plot result of scanning one signage point — for the plot-scan visualization. */
export interface PlotScan {
  plotIndex: number;
  farmerId: number;
  /** first 16 bits of the plot-filter hash, for rendering the bit strip. */
  filter16: number;
  filterLeadingZeros: number;
  filterThreshold: number;
  passes: boolean;
  /** first 16 bits of sp_quality (only if it passed the filter). */
  quality16: number | null;
  qualityLeadingZeros: number | null;
  requiredIters: number | null;
  wins: boolean;
}

export class Farmer implements BlockProducer {
  /** one chiapos forest per plot (built once). */
  private readonly forests: PosForest[];

  constructor(
    private readonly c: ConsensusConstants,
    private readonly plots: Plot[],
  ) {
    this.forests = plots.map((p) => buildForest(p.plotId));
  }

  get plotList(): readonly Plot[] {
    return this.plots;
  }

  /** Entry count of each of the 7 tables for a plot — "what the plot stores". */
  forestSizes(plotIndex: number): number[] {
    return this.forests[plotIndex].map((t) => t.length);
  }

  /** The full 7-table forest for a plot (for the plot visualization). */
  forest(plotIndex: number): PosForest {
    return this.forests[plotIndex];
  }

  /**
   * Scan every plot against one signage point for the visualization: who passes
   * the filter (leading zero bits), and of those, whose real proof-of-space
   * quality is small enough (also leading zeros!) that required_iters wins.
   */
  scan(challenge: Uint8Array, spOutput: Uint8Array, difficulty: bigint): PlotScan[] {
    const interval = spIntervalIters(this.c);
    const threshold = this.c.NUMBER_ZERO_BITS_PLOT_FILTER;
    return this.plots.map((plot, pi) => {
      const filterVal = plotFilterValue(plot, challenge, spOutput);
      const filterLeadingZeros = leadingZeroBits(filterVal);
      const passes = filterLeadingZeros >= threshold;
      let requiredIters: number | null = null;
      let quality16: number | null = null;
      let qualityLeadingZeros: number | null = null;
      let wins = false;
      if (passes) {
        const t7 = findProofs(this.forests[pi], spOutput);
        if (t7.length > 0) {
          const xs = leafXs(this.forests[pi], POS.TABLES, t7[0]);
          const proof = verifyProof(plot.plotId, xs, spOutput);
          const spQuality = stdHash(proof.quality, spOutput);
          quality16 = (spQuality[0] << 8) | spQuality[1];
          qualityLeadingZeros = leadingZeroBits(spQuality);
          const required = requiredItersFromQuality(this.c, bytesToBigInt(spQuality), difficulty, plot.k);
          requiredIters = Number(required);
          wins = required >= 1n && required < interval;
        }
      }
      return {
        plotIndex: plot.index,
        farmerId: plot.farmerId,
        filter16: (filterVal[0] << 8) | filterVal[1],
        filterLeadingZeros,
        filterThreshold: threshold,
        passes,
        quality16,
        qualityLeadingZeros,
        requiredIters,
        wins,
      };
    });
  }

  produceForSlot(ctx: SlotContext): WinningBlock[] {
    const interval = spIntervalIters(this.c);
    const threshold = this.c.NUMBER_ZERO_BITS_PLOT_FILTER;
    const winners: WinningBlock[] = [];

    for (let sp = 0; sp < this.c.NUM_SPS_SUB_SLOT; sp++) {
      const spOut = ctx.ccSpOutputs.get(sp);
      if (!spOut) continue;

      for (let pi = 0; pi < this.plots.length; pi++) {
        const plot = this.plots[pi];
        // 1. plot filter
        const filterVal = plotFilterValue(plot, ctx.ccChallenge, spOut);
        const filterBits = leadingZeroBits(filterVal);
        if (filterBits < threshold) continue;

        // 2. real proof of space: find a table-7 entry matching the challenge,
        //    recover its 64 leaf x-values, and derive the quality from them.
        const t7 = findProofs(this.forests[pi], spOut);
        if (t7.length === 0) continue; // no proof for this challenge
        const xs = leafXs(this.forests[pi], POS.TABLES, t7[0]);
        const proof = verifyProof(plot.plotId, xs, spOut);
        if (!proof.valid) continue;

        // 3. quality -> required_iters
        const spQuality = stdHash(proof.quality, spOut);
        const required = requiredItersFromQuality(this.c, bytesToBigInt(spQuality), ctx.difficulty, plot.k);
        if (required < 1n || required >= interval) continue; // must fall in the window

        // 4. real BLS plot signature over the signage point (harvester + farmer halves)
        const msg = spOut;
        const sig = aggregateSigs([sign(plot.local.sk, msg), sign(plot.farmer.sk, msg)]);
        const signatureValid = verify(plot.plotPk, msg, sig);

        const pos: PosInfo = {
          plotIndex: plot.index,
          plotIdHex: plotIdHex(plot),
          qualityHex: proof.qualityHex.slice(0, 12),
          proofXs: xs,
          plotPkHex: toHex(plot.plotPk, 6),
          filterBits,
          filterThreshold: threshold,
          signatureHex: toHex(sig, 6),
          signatureValid,
        };
        winners.push({ spIndex: sp, requiredIters: Number(required), farmerId: plot.farmerId, pos });
      }
    }
    return winners;
  }
}
