/**
 * A small REAL k=8 farm, scanned by the monitor's live signage points.
 *
 * For each signage-point challenge we run the genuine proof-of-space front end:
 * the plot filter (real leading-zero-bit gate) and, for plots that pass, a
 * quality → required_iters via the real consensus formula. A plot wins iff its
 * required_iters lands inside the signage-point window (required_iters < interval).
 *
 * So the numbers in the Monitor — filter bits, quality, required_iters, the win
 * threshold — are not faked; they are computed from the challenge exactly as the
 * Mini PoST sim does (minus the full 7-table forest, which the 🧬 modal shows).
 */
import { generatePlots, leadingZeroBits, plotFilterValue, qualityString, type Plot } from "../sim/plot.ts";
import { TOY_CONSTANTS, spIntervalIters } from "../sim/constants.ts";
import { requiredItersFromQuality } from "../sim/iterations.ts";
import { bytesToBigInt, hexToBytes, stdHash, toHex, u32be, utf8 } from "../crypto/hash.ts";
import type { PlotAttempt } from "./events.ts";

const C = TOY_CONSTANTS;
const INTERVAL = Number(spIntervalIters(C));
const THRESHOLD = C.NUMBER_ZERO_BITS_PLOT_FILTER;

export interface FarmScanResult {
  attempts: PlotAttempt[];
  passed: number;
  proofs: number;
  interval: number;
  threshold: number;
}

export class LiveFarm {
  readonly plots: Plot[];
  private difficulty: bigint;

  constructor(numPlots = 16, seed = 0xc1a, difficulty: bigint = C.DIFFICULTY_STARTING) {
    this.plots = generatePlots(seed, numPlots, Math.max(1, Math.floor(numPlots / 6)));
    this.difficulty = difficulty;
  }

  get total(): number {
    return this.plots.length;
  }

  /** Scan every plot against one signage-point challenge. */
  scan(challengeHex: string, spIndex: number): FarmScanResult {
    const challenge = hexToBytes(challengeHex);
    const spOutput = stdHash(challenge, u32be(spIndex));
    const attempts: PlotAttempt[] = [];
    let passed = 0;
    let proofs = 0;

    for (const plot of this.plots) {
      const fv = plotFilterValue(plot, challenge, spOutput);
      const bits = leadingZeroBits(fv);
      const pass = bits >= THRESHOLD;
      let hasProof = false;
      let requiredIters: number | null = null;
      let windowFraction: number | null = null;
      let win = false;
      let qualityHex = "";
      if (pass) {
        passed++;
        // does a table-7 entry match this challenge? (≈63% — Poisson(1) tail).
        // If not, the lookup stops at the top table: no proof, no quality.
        hasProof = stdHash(plot.plotId, challenge, spOutput, utf8("t7"))[0] < 161;
        if (hasProof) {
          const spQuality = stdHash(qualityString(plot, challenge, spOutput), spOutput);
          qualityHex = toHex(spQuality, 4);
          const req = requiredItersFromQuality(C, bytesToBigInt(spQuality), this.difficulty, plot.k);
          requiredIters = Number(req);
          windowFraction = requiredIters / INTERVAL;
          win = req >= 1n && req < BigInt(INTERVAL);
          if (win) proofs++;
        }
      }
      attempts.push({ plotIndex: plot.index, passed: pass, filterBits: bits, hasProof, qualityHex, requiredIters, windowFraction, win });
    }

    return { attempts, passed, proofs, interval: INTERVAL, threshold: THRESHOLD };
  }
}
