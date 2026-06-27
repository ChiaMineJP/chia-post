/**
 * The full Proof-of-Space-and-Time pipeline for ONE signage point and ONE focal
 * plot, computed entirely with the project's real primitives. Nothing here is a
 * stand-in: the signage-point challenge is produced by the genuine class-group
 * VDF (Proof of Time), the plot filter and the 7-table chiapos lookup are real,
 * and required_iters comes from the faithful pot_iterations math.
 *
 * `LabFarm` builds the plots + forests once; `runSignagePoint(seed)` searches
 * forward from `seed` for a (sub-slot, signage-point, plot) where the focal plot
 * actually has a proof, so the whole walkthrough — including the BLS signing and
 * the infusion point — is reachable. A winning proof (required_iters inside the
 * window) is preferred so the win path shows; otherwise an honest near-miss.
 */
import { generatePlots, leadingZeroBits, plotFilterValue, type Plot } from "../sim/plot.ts";
import { TOY_CONSTANTS, spIntervalIters } from "../sim/constants.ts";
import { requiredItersFromQuality, expectedPlotSize, spIters as spItersFn, ipIters } from "../sim/iterations.ts";
import {
  POS, buildForest, findProofs, leafXs, verifyProof, proofPathIndices,
  type PosForest, type Proof,
} from "../sim/proofofspace.ts";
import { defaultVdf } from "../crypto/vdf.ts";
import { serializeForm, type Form } from "../crypto/classgroup.ts";
import { bytesToBigInt, stdHash, toHex, u32be } from "../crypto/hash.ts";

const C = TOY_CONSTANTS;
const INTERVAL = Number(spIntervalIters(C));
const SUB_SLOT_ITERS = Number(C.SUB_SLOT_ITERS);
const THRESHOLD = C.NUMBER_ZERO_BITS_PLOT_FILTER;
const TWO_POW_256 = 1n << 256n;

/** A challenge byte string derived deterministically from a seed counter. */
function challengeForSeed(seed: number): Uint8Array {
  return stdHash(u32be(seed >>> 0)).slice(0, 8);
}

/** One matched pair re-derived through the (2m+parity)² quadratic, for display. */
export interface SampleMatch {
  yL: number; yR: number; bucket: number; bL: number; cL: number; parity: number; m: number; sq: number; bcR: number;
}
function deriveMatch(yL: number, yR: number): SampleMatch {
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

export interface VdfTrace {
  challengeHex: string;
  D: bigint;
  bits: number;
  forms: Form[];                 // index = iteration, 0..SUB_SLOT_ITERS
  subSlotIters: number;
  interval: number;
  spIterations: number[];        // the iteration of each of the NUM_SPS_SUB_SLOT signage points
  proofVerified: boolean;
  lPrimeHex: string;
}

export interface FilterRow {
  plotIndex: number;
  farmerId: number;
  bits: number;
  filterHex: string;
  passed: boolean;
}

export interface LookupTrace {
  t7Matches: number;
  challengeTopK: number;
  rootTopK: number;
  xs: number[];                  // 64 leaf x-values
  proof: Proof;                  // re-propagated, verified
  pathByLevel: number[][];       // proofPathIndices: indices walked at each table level
  tableSizes: number[];          // forest[t].length, T1..T7
  sampleMatch?: SampleMatch;
}

export interface RequiredItersTrace {
  qualityHex: string;            // the proof's quality string (32B) hex
  qualityIndex: number;
  spQualityHex: string;          // H(quality ‖ sp_output) hex (32B)
  spQuality256: bigint;
  u: number;                     // spQuality256 / 2^256 ∈ [0,1)
  difficulty: bigint;
  dcf: bigint;
  plotSize: bigint;
  requiredIters: bigint;
  interval: bigint;
  win: boolean;
  windowFraction: number;
  ipIters: bigint | null;        // infusion point (only when win)
}

export interface SignagePoint {
  seed: number;
  challengeHex: string;          // sub-slot cc challenge
  spIndex: number;
  spIters: bigint;
  spOutputHex: string;           // cc_sp_output, hashed from the VDF form at sp_iters
  spOutput: Uint8Array;
  difficulty: bigint;
  numSps: number;
}

export interface PipelineRun {
  sp: SignagePoint;
  vdf: VdfTrace;
  plot: Plot;
  filter: {
    focal: FilterRow;
    rows: FilterRow[];
    passed: number;
    total: number;
    threshold: number;
  };
  lookup: LookupTrace;
  req: RequiredItersTrace;
}

interface Candidate {
  seed: number;
  spIndex: number;
  spOutput: Uint8Array;
  plotIdx: number;
  win: boolean;
}

export class LabFarm {
  readonly plots: Plot[];
  private forests: PosForest[];
  readonly difficulty: bigint;

  constructor(numPlots = 12, seed = 0x1ab, difficulty: bigint = C.DIFFICULTY_STARTING) {
    this.plots = generatePlots(seed, numPlots, Math.max(1, Math.floor(numPlots / 4)));
    this.forests = this.plots.map((p) => buildForest(p.plotId));
    this.difficulty = difficulty;
  }

  get total(): number {
    return this.plots.length;
  }

  /** Run the VDF for a seed's challenge and return every form + the sp outputs. */
  private vdf(seed: number): { challenge: Uint8Array; forms: Form[]; D: bigint; bits: number; spOutputs: Uint8Array[] } {
    const challenge = challengeForSeed(seed);
    let el = defaultVdf.start(challenge);
    const forms: Form[] = [el.form];
    for (let i = 1; i <= SUB_SLOT_ITERS; i++) {
      el = defaultVdf.step(el);
      forms.push(el.form);
    }
    const numSps = C.NUM_SPS_SUB_SLOT;
    const spOutputs: Uint8Array[] = [];
    for (let k = 0; k < numSps; k++) {
      const iter = k * INTERVAL;
      spOutputs.push(stdHash(serializeForm(forms[iter], el.bits)));
    }
    return { challenge, forms, D: el.D, bits: el.bits, spOutputs };
  }

  /** Search forward from `startSeed` for a focal plot that has a proof (win preferred). */
  private findCandidate(startSeed: number, maxTries = 48): Candidate | null {
    let firstProof: Candidate | null = null;
    for (let s = startSeed; s < startSeed + maxTries; s++) {
      const { forms, bits } = this.vdf(s);
      for (let k = 0; k < C.NUM_SPS_SUB_SLOT; k++) {
        const spOutput = stdHash(serializeForm(forms[k * INTERVAL], bits));
        for (let pi = 0; pi < this.plots.length; pi++) {
          const plot = this.plots[pi];
          const fv = plotFilterValue(plot, challengeForSeed(s), spOutput);
          if (leadingZeroBits(fv) < THRESHOLD) continue;
          const t7 = findProofs(this.forests[pi], spOutput);
          if (t7.length === 0) continue;
          const xs = leafXs(this.forests[pi], POS.TABLES, t7[0]);
          const pf = verifyProof(plot.plotId, xs, spOutput);
          const spQuality = bytesToBigInt(stdHash(pf.quality, spOutput));
          const req = requiredItersFromQuality(C, spQuality, this.difficulty, plot.k);
          const win = req >= 1n && req < BigInt(INTERVAL);
          const cand: Candidate = { seed: s, spIndex: k, spOutput, plotIdx: pi, win };
          if (win) return cand;
          if (!firstProof) firstProof = cand;
        }
      }
    }
    return firstProof;
  }

  /** Build the complete pipeline run for a signage point at/after `startSeed`. */
  runSignagePoint(startSeed: number): PipelineRun | null {
    const cand = this.findCandidate(startSeed);
    if (!cand) return null;

    const v = this.vdf(cand.seed);
    const challenge = v.challenge;
    const spOutput = cand.spOutput;
    const spOutputHex = toHex(spOutput, 32);
    const plot = this.plots[cand.plotIdx];
    const forest = this.forests[cand.plotIdx];

    // ── n-wesolowski proof for the VDF (cheap-verify side) ──
    const wproof = defaultVdf.prove(challenge, SUB_SLOT_ITERS, 3);
    const lastSeg = wproof.segments[wproof.segments.length - 1];
    const vdf: VdfTrace = {
      challengeHex: toHex(challenge, 8),
      D: v.D,
      bits: v.bits,
      forms: v.forms,
      subSlotIters: SUB_SLOT_ITERS,
      interval: INTERVAL,
      spIterations: Array.from({ length: C.NUM_SPS_SUB_SLOT }, (_, k) => k * INTERVAL),
      proofVerified: wproof.verified,
      lPrimeHex: lastSeg.l.toString(16).slice(0, 12),
    };

    // ── plot filter over the whole farm at this signage point ──
    const rows: FilterRow[] = this.plots.map((p, i) => {
      const fv = plotFilterValue(p, challenge, spOutput);
      return {
        plotIndex: p.index,
        farmerId: p.farmerId,
        bits: leadingZeroBits(fv),
        filterHex: toHex(fv, 4),
        passed: i === cand.plotIdx ? true : leadingZeroBits(fv) >= THRESHOLD,
      };
    });
    const passed = rows.filter((r) => r.passed).length;

    // ── the focal plot's proof of space ──
    const t7 = findProofs(forest, spOutput);
    const xs = leafXs(forest, POS.TABLES, t7[0]);
    const proof = verifyProof(plot.plotId, xs, spOutput);
    const pathByLevel = proofPathIndices(forest, t7[0]);
    const tableSizes = forest.map((t) => t.length);
    let sampleMatch: SampleMatch | undefined;
    const okPair = proof.matchOk[0]?.findIndex((ok) => ok) ?? -1;
    if (okPair >= 0) sampleMatch = deriveMatch(proof.levels[0][okPair * 2], proof.levels[0][okPair * 2 + 1]);

    const lookup: LookupTrace = {
      t7Matches: t7.length,
      challengeTopK: proof.challengeTopK,
      rootTopK: proof.rootTopK,
      xs,
      proof,
      pathByLevel,
      tableSizes,
      sampleMatch,
    };

    // ── quality → required_iters → window ──
    const spQualityBytes = stdHash(proof.quality, spOutput);
    const spQuality256 = bytesToBigInt(spQualityBytes);
    const requiredIters = requiredItersFromQuality(C, spQuality256, this.difficulty, plot.k);
    const win = requiredIters >= 1n && requiredIters < BigInt(INTERVAL);
    const req: RequiredItersTrace = {
      qualityHex: proof.qualityHex,
      qualityIndex: proof.qualityIndex,
      spQualityHex: toHex(spQualityBytes, 32),
      spQuality256,
      u: Number(spQuality256) / Number(TWO_POW_256),
      difficulty: this.difficulty,
      dcf: C.DIFFICULTY_CONSTANT_FACTOR,
      plotSize: expectedPlotSize(plot.k),
      requiredIters,
      interval: BigInt(INTERVAL),
      win,
      windowFraction: Number(requiredIters) / INTERVAL,
      ipIters: win ? ipIters(C, cand.spIndex, requiredIters) : null,
    };

    const sp: SignagePoint = {
      seed: cand.seed,
      challengeHex: toHex(challenge, 8),
      spIndex: cand.spIndex,
      spIters: spItersFn(C, cand.spIndex),
      spOutputHex,
      spOutput,
      difficulty: this.difficulty,
      numSps: C.NUM_SPS_SUB_SLOT,
    };

    return {
      sp,
      vdf,
      plot,
      filter: { focal: rows[cand.plotIdx], rows, passed, total: this.plots.length, threshold: THRESHOLD },
      lookup,
      req,
    };
  }
}
