/**
 * Proof of space — the chiapos 7-table construction, structurally faithful but
 * scaled to k=8 so the whole forest is drawable.
 *
 * Ported in SHAPE from chiapos (src/calculate_bucket.hpp, prover_disk.hpp,
 * verifier.hpp):
 *   - F1 turns each x into a (k + kExtraBits)-bit f-value.
 *   - Tables 2..7 are built by forward propagation: entries from adjacent
 *     buckets that satisfy the MATCHING CONDITION (the (2m+parity)^2 quadratic)
 *     combine, via Fx, into one entry of the next table — which stores back
 *     pointers to its two children.
 *   - A proof for a challenge is a table-7 entry whose top k bits match the
 *     challenge; following its back pointers down 6 levels yields 64 leaf
 *     x-values. Verification re-propagates them up and re-checks every match.
 *   - The quality is H(challenge ‖ two of the leaf x-values).
 *
 * Real chiapos uses ChaCha8 for F1 and BLAKE3 for Fx with elaborate metadata
 * collation; here F1/Fx are SHA-256 stand-ins and the constants are small. The
 * real constants (kBC=15113, kB=119, kC=127, kExtraBits=6) need k>=18, which is
 * exactly why chiapos can't plot k=8.
 */
import { stdHash, u32be, bytesToBigInt, toHex } from "../crypto/hash.ts";

// The f-value range is decoupled from 2^(k+extra) on purpose: with the dedup'd
// forest, a smaller range gives a STABLE fixed point (as a table fills up toward
// F_RANGE, new matches increasingly hash to already-seen values, so the table
// stops growing instead of collapsing). Tuned empirically for healthy k=8 tables.
export const POS = {
  K: 8,
  EXTRA_BITS: 4,
  EXTRA_POW: 16,
  B: 8,
  C: 5,
  BC: 40,
  F_BITS: 8,
  F_RANGE: 256,
  TABLES: 7,
};

/** F1: the first table. f1(x) = chacha-bits(x) ‖ (top EXTRA_BITS of x). */
export function f1(plotId: Uint8Array, x: number): number {
  const chachaRange = 1 << (POS.F_BITS - POS.EXTRA_BITS);
  const chachaBits = Number(bytesToBigInt(stdHash(plotId, u32be(x))) % BigInt(chachaRange));
  return (chachaBits << POS.EXTRA_BITS) | (x >> (POS.K - POS.EXTRA_BITS));
}

/** Fx: the next table's f-value from a matched pair. Top F_BITS of H(t ‖ yL ‖ yR). */
export function fx(table: number, yL: number, yR: number): number {
  const h = stdHash(u32be(table), u32be(yL), u32be(yR));
  const top = (h[0] << 8) | h[1]; // 16 bits
  return (top >> (16 - POS.F_BITS)) & (POS.F_RANGE - 1);
}

/**
 * The matching condition (chiapos calculate_bucket.hpp). yL and yR match iff yR
 * is in the next bucket and, for some m in [0, EXTRA_POW), the b- and c-offsets
 * hit the quadratic target ((2m + parity)^2). Returns true on the first match.
 */
export function matches(yL: number, yR: number): boolean {
  const bucketL = Math.floor(yL / POS.BC);
  const bucketR = Math.floor(yR / POS.BC);
  if (bucketR !== bucketL + 1) return false;
  const bcL = yL % POS.BC;
  const bcR = yR % POS.BC;
  const bL = Math.floor(bcL / POS.C);
  const cL = bcL % POS.C;
  const parity = bucketL % 2;
  for (let m = 0; m < POS.EXTRA_POW; m++) {
    const targetBc = (((bL + m) % POS.B) * POS.C) + (((2 * m + parity) ** 2 + cL) % POS.C);
    if (targetBc === bcR) return true;
  }
  return false;
}

export interface PosEntry {
  y: number;
  x?: number; // table 1 only
  left?: number; // index into the previous table
  right?: number;
}

export type PosForest = PosEntry[][]; // forest[t] = table t+1's entries (0-indexed tables)

/** Build the 7-table forest for a plot_id. forest[0] is T1 ... forest[6] is T7. */
export function buildForest(plotId: Uint8Array): PosForest {
  // Table 1 — one entry per distinct f-value (dedup keeps the forest well-formed
  // at small k; real chiapos keeps duplicates, but at k=8 they proliferate).
  const seen1 = new Set<number>();
  let prev: PosEntry[] = [];
  for (let x = 0; x < (1 << POS.K); x++) {
    const y = f1(plotId, x);
    if (seen1.has(y)) continue;
    seen1.add(y);
    prev.push({ y, x });
  }
  prev.sort((a, b) => a.y - b.y);
  const forest: PosForest = [prev];

  // Tables 2..7
  for (let t = 2; t <= POS.TABLES; t++) {
    const next: PosEntry[] = [];
    // group prev indices by bucket
    const byBucket = new Map<number, number[]>();
    prev.forEach((e, i) => {
      const b = Math.floor(e.y / POS.BC);
      const arr = byBucket.get(b);
      if (arr) arr.push(i);
      else byBucket.set(b, [i]);
    });
    for (const [bucket, leftIdx] of byBucket) {
      const rightIdx = byBucket.get(bucket + 1);
      if (!rightIdx) continue;
      // rmap: bcR -> right positions
      const rmap = new Map<number, number[]>();
      for (const ri of rightIdx) {
        const bcR = prev[ri].y % POS.BC;
        const arr = rmap.get(bcR);
        if (arr) arr.push(ri);
        else rmap.set(bcR, [ri]);
      }
      const parity = bucket % 2;
      for (const li of leftIdx) {
        const bcL = prev[li].y % POS.BC;
        const bL = Math.floor(bcL / POS.C);
        const cL = bcL % POS.C;
        for (let m = 0; m < POS.EXTRA_POW; m++) {
          const targetBc = (((bL + m) % POS.B) * POS.C) + (((2 * m + parity) ** 2 + cL) % POS.C);
          const rs = rmap.get(targetBc);
          if (!rs) continue;
          for (const ri of rs) {
            next.push({ y: fx(t, prev[li].y, prev[ri].y), left: li, right: ri });
          }
        }
      }
    }
    next.sort((a, b) => a.y - b.y);
    // dedup by y (keep the first), so distinct values keep propagating
    const deduped: PosEntry[] = [];
    let lastY = -1;
    for (const e of next) {
      if (e.y === lastY) continue;
      lastY = e.y;
      deduped.push(e);
    }
    forest.push(deduped);
    prev = deduped;
  }
  return forest;
}

/** Top k bits of an F_BITS-bit f-value. */
function topK(y: number): number {
  return y >> (POS.F_BITS - POS.K);
}

/** Indices of table-7 entries whose top k bits equal the challenge's top k bits. */
export function findProofs(forest: PosForest, challenge: Uint8Array): number[] {
  const challengeTopK = ((challenge[0] << 8) | challenge[1]) >> (16 - POS.K);
  const t7 = forest[POS.TABLES - 1];
  const out: number[] = [];
  for (let i = 0; i < t7.length; i++) if (topK(t7[i].y) === challengeTopK) out.push(i);
  return out;
}

/** Follow back pointers from a table-`t` (1-indexed) entry down to leaf x-values. */
export function leafXs(forest: PosForest, t: number, pos: number): number[] {
  if (t === 1) return [forest[0][pos].x!];
  const e = forest[t - 1][pos];
  return [...leafXs(forest, t - 1, e.left!), ...leafXs(forest, t - 1, e.right!)];
}

/** The forest node indices touched by the proof, per table (out[L] = indices into forest[L]). */
export function proofPathIndices(forest: PosForest, t7pos: number): number[][] {
  const out: number[][] = Array.from({ length: POS.TABLES }, () => []);
  const rec = (table: number, pos: number) => {
    out[table - 1].push(pos);
    if (table === 1) return;
    const e = forest[table - 1][pos];
    rec(table - 1, e.left!);
    rec(table - 1, e.right!);
  };
  rec(POS.TABLES, t7pos);
  return out;
}

export interface ProofTreeNode {
  y: number;
  /** children indices in the level below (for drawing). */
  childL?: number;
  childR?: number;
}

/** The full proof: the 64 leaf x-values, and every level's y-values (for drawing). */
export interface Proof {
  xs: number[]; // 64 leaf x-values (in-order)
  levels: number[][]; // levels[0] = the 64 f1 outputs ... levels[6] = [root y]
  matchOk: boolean[][]; // matchOk[level][pairIndex]
  challengeTopK: number;
  rootTopK: number;
  valid: boolean;
  qualityIndex: number;
  /** the 32-byte quality string = H(challenge ‖ two leaf x-values). */
  quality: Uint8Array;
  qualityHex: string;
}

/** Verify a list of leaf x-values against a challenge, re-propagating up the tree. */
export function verifyProof(plotId: Uint8Array, xs: number[], challenge: Uint8Array): Proof {
  const levels: number[][] = [];
  const matchOk: boolean[][] = [];
  let ys = xs.map((x) => f1(plotId, x));
  levels.push(ys);
  let valid = true;
  for (let t = 2; t <= POS.TABLES; t++) {
    const next: number[] = [];
    const oks: boolean[] = [];
    for (let i = 0; i < ys.length; i += 2) {
      const ok = matches(ys[i], ys[i + 1]);
      oks.push(ok);
      if (!ok) valid = false;
      next.push(fx(t, ys[i], ys[i + 1]));
    }
    matchOk.push(oks);
    levels.push(next);
    ys = next;
  }
  const challengeTopK = ((challenge[0] << 8) | challenge[1]) >> (16 - POS.K);
  const rootTopK = topK(ys[0]);
  if (rootTopK !== challengeTopK) valid = false;

  // quality: pick two consecutive leaves chosen by the challenge, hash with it
  const qualityIndex = (((challenge[1] & 0x1f) << 1) % (xs.length - 1)) & ~1;
  const quality = stdHash(challenge, u32be(xs[qualityIndex]), u32be(xs[qualityIndex + 1]));

  return {
    xs,
    levels,
    matchOk,
    challengeTopK,
    rootTopK,
    valid,
    qualityIndex,
    quality,
    qualityHex: toHex(quality, 32),
  };
}

/** Build forest, find a proof for the challenge, return it verified (or null). */
export function proveAndVerify(plotId: Uint8Array, challenge: Uint8Array, forest?: PosForest): Proof | null {
  const f = forest ?? buildForest(plotId);
  const t7 = findProofs(f, challenge);
  if (t7.length === 0) return null;
  const xs = leafXs(f, POS.TABLES, t7[0]);
  return verifyProof(plotId, xs, challenge);
}
