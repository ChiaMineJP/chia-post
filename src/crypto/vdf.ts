/**
 * Verifiable Delay Function — the "Time" in Proof of Space and *Time*.
 *
 * A VDF takes a prescribed number of *sequential* steps to evaluate (it cannot
 * be parallelized) but is cheap to verify. The timelord proves real wall-clock
 * time elapsed by being unable to shortcut the computation.
 *
 * This is the real construction Chia uses: repeated squaring in the class group
 * of an imaginary quadratic field (see crypto/classgroup.ts), with the discriminant
 * derived from the chain's challenge so there is no trusted setup. Correctness of a
 * run is certified by an n-wesolowski proof (crypto/wesolowski.ts).
 *
 * Maps to chia's VDFInfo: { challenge -> discriminant, number_of_iterations, output form }.
 */
import {
  type Form,
  createDiscriminant,
  generator,
  square,
  serializeForm,
} from "./classgroup.ts";
import { type NWesolowskiProof, proveN } from "./wesolowski.ts";
import { stdHash, toHex } from "./hash.ts";

/** A point on a VDF chain: the current form, plus the discriminant context it lives in. */
export interface VdfElement {
  form: Form;
  D: bigint;
  bits: number;
}

export interface Vdf {
  readonly kind: string;
  readonly discriminantBits: number;
  /** Initial element: discriminant from challenge, starting at the generator form. */
  start(challenge: Uint8Array): VdfElement;
  /** One sequential squaring in the class group. */
  step(e: VdfElement): VdfElement;
  /** Canonical bytes of an element, for folding into the next challenge. */
  toBytes(e: VdfElement): Uint8Array;
  /** Short display hash of an element. */
  short(e: VdfElement): string;
  /** Produce + self-verify an n-wesolowski proof that `iterations` steps from `challenge`. */
  prove(challenge: Uint8Array, iterations: number, segments: number): NWesolowskiProof;
}

export class ClassGroupVdf implements Vdf {
  readonly kind = "class group (binary quadratic forms) · n-wesolowski";
  readonly discriminantBits: number;
  /** bit length of the Fiat-Shamir prime l. Real chia: 264. Toy default smaller. */
  readonly bBits: number;

  constructor(discriminantBits = 64, bBits = 64) {
    this.discriminantBits = discriminantBits;
    this.bBits = bBits;
  }

  start(challenge: Uint8Array): VdfElement {
    const D = createDiscriminant(challenge, this.discriminantBits);
    return { form: generator(D), D, bits: this.discriminantBits };
  }

  step(e: VdfElement): VdfElement {
    return { form: square(e.form), D: e.D, bits: e.bits };
  }

  toBytes(e: VdfElement): Uint8Array {
    return serializeForm(e.form, e.bits);
  }

  short(e: VdfElement): string {
    return toHex(stdHash(serializeForm(e.form, e.bits)), 6);
  }

  prove(challenge: Uint8Array, iterations: number, segments: number): NWesolowskiProof {
    const D = createDiscriminant(challenge, this.discriminantBits);
    const g = generator(D);
    return proveN(g, iterations, D, this.discriminantBits, this.bBits, segments);
  }
}

/** Default VDF used by the simulation. */
export const defaultVdf: Vdf = new ClassGroupVdf();
