/**
 * Wesolowski VDF proofs over the class group, including the "n-wesolowski"
 * segmented form Chia uses.
 *
 * A VDF computes y = g^(2^T) by T sequential squarings. Wesolowski lets the
 * prover convince a verifier of that in O(1) group ops instead of re-running T:
 *
 *   prover:   l  = HashPrime(serialize(g) || serialize(y))     (Fiat-Shamir)
 *             pi = g^( floor(2^T / l) )
 *   verifier: r  = 2^T mod l
 *             accept iff  pi^l * g^r == y
 *
 * "n-wesolowski" simply chains n such proofs over consecutive segments of the
 * computation (so a long VDF is certified by several short proofs, each over the
 * previous segment's output). Ported from chiavdf src/verifier.h + proof_common.h.
 */
import {
  type Form,
  multiply,
  pow,
  reduce,
  square,
  hashPrime,
  modpow,
  serializeForm,
} from "./classgroup.ts";

function formsEqual(x: Form, y: Form): boolean {
  const a = reduce(x);
  const b = reduce(y);
  return a.a === b.a && a.b === b.b && a.c === b.c;
}

/** GetB: the Fiat-Shamir prime l derived from (x, y). chiavdf proof_common.h. */
export function getB(x: Form, y: Form, bits: number, bBits: number): bigint {
  const sx = serializeForm(x, bits);
  const sy = serializeForm(y, bits);
  const seed = new Uint8Array(sx.length + sy.length);
  seed.set(sx, 0);
  seed.set(sy, sx.length);
  return hashPrime(seed, bBits, [bBits - 1]);
}

export interface WesoSegment {
  x: Form;
  y: Form;
  pi: Form;
  l: bigint;
  iters: number;
}

/** Single Wesolowski proof that y = x^(2^iters). */
export function proveSingle(
  x: Form,
  iters: number,
  D: bigint,
  bits: number,
  bBits: number,
): WesoSegment {
  let y = x;
  for (let i = 0; i < iters; i++) y = square(y);
  const l = getB(x, y, bits, bBits);
  const twoT = 1n << BigInt(iters);
  const q = twoT / l; // floor(2^T / l)
  const pi = pow(x, q, D);
  return { x, y, pi, l, iters };
}

/** Verify a single Wesolowski segment: pi^l * x^r == y, r = 2^iters mod l. */
export function verifySingle(seg: WesoSegment, D: bigint, bits: number, bBits: number): boolean {
  const l = getB(seg.x, seg.y, bits, bBits);
  if (l !== seg.l) return false;
  const r = modpow(2n, BigInt(seg.iters), l);
  const lhs = multiply(pow(seg.pi, l, D), pow(seg.x, r, D));
  return formsEqual(lhs, seg.y);
}

export interface NWesolowskiProof {
  segments: WesoSegment[];
  iterations: number;
  /** every segment verified at construction time. */
  verified: boolean;
  bits: number;
  bBits: number;
}

/** Produce an n-segment ("n-wesolowski") proof that y = g^(2^iterations). */
export function proveN(
  g: Form,
  iterations: number,
  D: bigint,
  bits: number,
  bBits: number,
  segments: number,
): NWesolowskiProof {
  const chunk = Math.floor(iterations / segments);
  const segs: WesoSegment[] = [];
  let x = g;
  let used = 0;
  for (let s = 0; s < segments; s++) {
    const it = s === segments - 1 ? iterations - used : chunk;
    const seg = proveSingle(x, it, D, bits, bBits);
    segs.push(seg);
    x = seg.y;
    used += it;
  }
  const proof: NWesolowskiProof = { segments: segs, iterations, verified: false, bits, bBits };
  proof.verified = verifyN(proof, D);
  return proof;
}

/** Verify an n-wesolowski proof end to end (each segment chains to the next). */
export function verifyN(proof: NWesolowskiProof, D: bigint): boolean {
  for (let i = 0; i < proof.segments.length; i++) {
    const seg = proof.segments[i];
    if (i > 0 && !formsEqual(seg.x, proof.segments[i - 1].y)) return false;
    if (!verifySingle(seg, D, proof.bits, proof.bBits)) return false;
  }
  return true;
}
