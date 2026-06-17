/**
 * A small REAL k=8 farm, scanned by the monitor's live signage points.
 *
 * For each signage-point challenge we run the genuine proof-of-space front end:
 * the plot filter (real leading-zero-bit gate) and, for the plots that pass, the
 * real chiapos-structure lookup — build forest once, find a table-7 match for the
 * challenge (or not: the early-out), walk the back-pointers to the 64 leaf
 * x-values, and turn the quality into required_iters. A plot wins iff its
 * required_iters lands inside the signage-point window.
 *
 * Everything the Monitor shows — filter bits, the T7 match, the 64 x-values, the
 * matching quadratic, the quality, required_iters — is computed here, for real.
 */
import { generatePlots, leadingZeroBits, plotFilterValue, type Plot } from "../sim/plot.ts";
import { TOY_CONSTANTS, spIntervalIters } from "../sim/constants.ts";
import { requiredItersFromQuality } from "../sim/iterations.ts";
import { POS, buildForest, findProofs, leafXs, verifyProof, type PosForest } from "../sim/proofofspace.ts";
import { bytesToBigInt, hexToBytes, stdHash, toHex, u32be } from "../crypto/hash.ts";
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

/** Re-derive the matching quadratic for one matched pair (for display). */
function deriveMatch(yL: number, yR: number) {
  const bucket = Math.floor(yL / POS.BC);
  const parity = bucket % 2;
  const bcL = yL % POS.BC;
  const bL = Math.floor(bcL / POS.C);
  const cL = bcL % POS.C;
  const bcR = yR % POS.BC;
  for (let m = 0; m < POS.EXTRA_POW; m++) {
    const sq = (2 * m + parity) ** 2;
    const targetBc = ((bL + m) % POS.B) * POS.C + ((sq + cL) % POS.C);
    if (targetBc === bcR) return { yL, yR, bucket, bL, cL, parity, m, sq, bcR };
  }
  return { yL, yR, bucket, bL, cL, parity, m: -1, sq: -1, bcR };
}

export class LiveFarm {
  readonly plots: Plot[];
  private forests: PosForest[];
  private difficulty: bigint;

  constructor(numPlots = 16, seed = 0xc1a, difficulty: bigint = C.DIFFICULTY_STARTING) {
    this.plots = generatePlots(seed, numPlots, Math.max(1, Math.floor(numPlots / 6)));
    this.forests = this.plots.map((p) => buildForest(p.plotId)); // ~once, on construction
    this.difficulty = difficulty;
  }

  get total(): number {
    return this.plots.length;
  }

  scan(challengeHex: string, spIndex: number): FarmScanResult {
    const challenge = hexToBytes(challengeHex);
    const spOutput = stdHash(challenge, u32be(spIndex));
    const attempts: PlotAttempt[] = [];
    let passed = 0;
    let proofs = 0;

    this.plots.forEach((plot, i) => {
      const fv = plotFilterValue(plot, challenge, spOutput);
      const bits = leadingZeroBits(fv);
      const filterHex = toHex(fv, 4);
      const pass = bits >= THRESHOLD;
      let hasProof = false;
      let requiredIters: number | null = null;
      let windowFraction: number | null = null;
      let win = false;
      let qualityHex = "";
      let proof: PlotAttempt["proof"];

      if (pass) {
        passed++;
        const t7 = findProofs(this.forests[i], spOutput); // table-7 matches for this challenge
        if (t7.length > 0) {
          hasProof = true;
          const xs = leafXs(this.forests[i], POS.TABLES, t7[0]);
          const pf = verifyProof(plot.plotId, xs, spOutput);
          const spQuality = stdHash(pf.quality, spOutput);
          qualityHex = toHex(spQuality, 4);
          const req = requiredItersFromQuality(C, bytesToBigInt(spQuality), this.difficulty, plot.k);
          requiredIters = Number(req);
          windowFraction = requiredIters / INTERVAL;
          win = req >= 1n && req < BigInt(INTERVAL);
          if (win) proofs++;

          // a sample matched pair from level 1 (the leaves' f1 outputs)
          let sampleMatch;
          const okPair = pf.matchOk[0]?.findIndex((ok) => ok) ?? -1;
          if (okPair >= 0) sampleMatch = deriveMatch(pf.levels[0][okPair * 2], pf.levels[0][okPair * 2 + 1]);

          proof = {
            t7Matches: t7.length,
            xs,
            qualityIndex: pf.qualityIndex,
            qualityStrHex: pf.qualityHex.slice(0, 16),
            valid: pf.valid,
            sampleMatch,
          };
        }
      }

      attempts.push({ plotIndex: plot.index, passed: pass, filterBits: bits, filterHex, hasProof, qualityHex, requiredIters, windowFraction, win, proof });
    });

    return { attempts, passed, proofs, interval: INTERVAL, threshold: THRESHOLD };
  }
}
