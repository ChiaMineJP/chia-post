/**
 * Real BLS12-381 elliptic-curve arithmetic, exposed step by step for teaching.
 *
 * The farmer's plot key is *split*: plot_sk = local_sk (harvester) + farmer_sk.
 * Signing a signage point is therefore done as two partial signatures that are
 * aggregated. Every operation here is the genuine group law on BLS12-381:
 *
 *   - public keys live on G1  (affine x,y are plain field elements F_p)
 *   - the hashed message and signatures live on G2 (affine x,y are F_p2 = c0+c1·u)
 *   - signing is a scalar multiplication  sig = sk · H(m)  on G2
 *   - aggregation is point addition        sig = sig_local + sig_farmer
 *   - verification is the pairing identity  e(plot_pk, H(m)) = e(g1, sig)
 *
 * We re-derive the scalar multiplication with the textbook left-to-right
 * double-and-add ladder so the per-bit point doublings and additions are visible,
 * and check that the ladder result matches noble's optimized `.multiply()`.
 */
import { bls12_381 as bls } from "@noble/curves/bls12-381";
import { bytesToBigInt } from "../crypto/hash.ts";

const G1 = bls.G1.ProjectivePoint;
const G2 = bls.G2.ProjectivePoint;
const Fp12 = bls.fields.Fp12;

type G1Pt = InstanceType<typeof G1>;
type G2Pt = InstanceType<typeof G2>;

/** Affine G1 point — coordinates in F_p. */
export interface G1Affine {
  x: bigint;
  y: bigint;
}
/** Affine G2 point — coordinates in F_p2, written c0 + c1·u. */
export interface G2Affine {
  x: { c0: bigint; c1: bigint };
  y: { c0: bigint; c1: bigint };
}

function g1Affine(p: G1Pt): G1Affine {
  const a = p.toAffine();
  return { x: a.x, y: a.y };
}
function g2Affine(p: G2Pt): G2Affine {
  const a = p.toAffine();
  return { x: { c0: a.x.c0, c1: a.x.c1 }, y: { c0: a.y.c0, c1: a.y.c1 } };
}

/** One rung of the double-and-add ladder for sk · P on G2. */
export interface LadderStep {
  /** bit position, MSB-first (high bit = first processed). */
  bitIndex: number;
  bit: 0 | 1;
  /** "init" (seed at first set bit), "double", or "double+add". */
  op: "init" | "double" | "double+add";
  /** accumulator after this step. */
  acc: G2Affine;
}

export interface ScalarMulTrace {
  scalar: bigint;
  /** binary of the scalar, MSB-first, no leading zeros. */
  bits: string;
  steps: LadderStep[];
  result: G2Affine;
  /** ladder result equals noble's native multiply()? (a sanity self-check) */
  matchesNative: boolean;
}

/** Left-to-right double-and-add: makes every doubling and addition explicit. */
function scalarMulTrace(scalar: bigint, base: G2Pt): ScalarMulTrace {
  const bits = scalar.toString(2);
  const steps: LadderStep[] = [];
  let acc: G2Pt = base; // seed at the leading 1 bit
  steps.push({ bitIndex: 0, bit: 1, op: "init", acc: g2Affine(acc) });
  for (let i = 1; i < bits.length; i++) {
    acc = acc.double();
    const bit = bits[i] === "1" ? 1 : 0;
    if (bit) acc = acc.add(base);
    steps.push({ bitIndex: i, bit, op: bit ? "double+add" : "double", acc: g2Affine(acc) });
  }
  const native = base.multiply(scalar);
  return { scalar, bits, steps, result: g2Affine(acc), matchesNative: acc.equals(native) };
}

export interface BlsTrace {
  msgHex: string;
  /** the split-key public keys on G1. */
  localPk: G1Affine;
  farmerPk: G1Affine;
  /** plot_pk = local_pk + farmer_pk  (G1 point addition). */
  plotPk: G1Affine;
  /** the generator of G1 (g1). */
  g1: G1Affine;
  /** message hashed onto G2. */
  hMsg: G2Affine;
  /** sig_local = local_sk · H(m), with the full double-and-add ladder. */
  localMul: ScalarMulTrace;
  farmerSig: G2Affine;
  /** sig = sig_local + sig_farmer  (G2 point addition). */
  sigAgg: G2Affine;
  /** the pairing identity e(plot_pk, H) ?= e(g1, sig). */
  verified: boolean;
  /** short hex fingerprints of the two pairing targets in G_T (F_p12). */
  lhsFp12Hex: string;
  rhsFp12Hex: string;
}

/** Fingerprint an F_p12 element (12 F_p coeffs) to a short hex string. */
function fp12Hex(e: ReturnType<typeof bls.pairing>): string {
  // Flatten the tower c0..c1 (Fp6) → c0..c2 (Fp2) → c0,c1 (Fp), xor-fold to 8 bytes.
  const acc = new Uint8Array(8);
  const push = (n: bigint) => {
    let v = n < 0n ? -n : n;
    for (let i = 7; i >= 0; i--) {
      acc[i] ^= Number(v & 0xffn);
      v >>= 8n;
    }
  };
  const walk = (o: unknown) => {
    if (typeof o === "bigint") push(o);
    else if (o && typeof o === "object") for (const v of Object.values(o)) walk(v);
  };
  walk(e);
  return Array.from(acc, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Build the full signing trace for one signage-point message and a plot's split
 * key. Public keys are re-derived from the secret scalars so the points shown are
 * the genuine g1·sk, and the pairing check confirms the aggregate is a valid
 * signature under the aggregated plot key.
 */
export function buildBlsTrace(localSk: Uint8Array, farmerSk: Uint8Array, msg: Uint8Array, msgHex: string): BlsTrace {
  const localScalar = bytesToBigInt(localSk);
  const farmerScalar = bytesToBigInt(farmerSk);

  const localPkPt = G1.BASE.multiply(localScalar);
  const farmerPkPt = G1.BASE.multiply(farmerScalar);
  const plotPkPt = localPkPt.add(farmerPkPt);

  const hMsgPt = bls.G2.hashToCurve(msg) as unknown as G2Pt;

  const localMul = scalarMulTrace(localScalar, hMsgPt);
  const farmerSigPt = hMsgPt.multiply(farmerScalar);
  const sigAggPt = hMsgPt.multiply(localScalar).add(farmerSigPt);

  const lhs = bls.pairing(plotPkPt, hMsgPt);
  const rhs = bls.pairing(G1.BASE, sigAggPt);
  const verified = Fp12.eql(lhs, rhs);

  return {
    msgHex,
    localPk: g1Affine(localPkPt),
    farmerPk: g1Affine(farmerPkPt),
    plotPk: g1Affine(plotPkPt),
    g1: g1Affine(G1.BASE),
    hMsg: g2Affine(hMsgPt),
    localMul,
    farmerSig: g2Affine(farmerSigPt),
    sigAgg: g2Affine(sigAggPt),
    verified,
    lhsFp12Hex: fp12Hex(lhs),
    rhsFp12Hex: fp12Hex(rhs),
  };
}
