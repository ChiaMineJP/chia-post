import { describe, expect, it } from "vitest";
import {
  createDiscriminant,
  discriminantOf,
  generator,
  identity,
  inverse,
  isProbablePrime,
  multiply,
  pow,
  reduce,
  square,
  type Form,
} from "./classgroup.ts";
import { ClassGroupVdf } from "./vdf.ts";
import { proveN, verifyN } from "./wesolowski.ts";

const BITS = 64;

function eq(x: Form, y: Form): boolean {
  const a = reduce(x);
  const b = reduce(y);
  return a.a === b.a && a.b === b.b && a.c === b.c;
}

// A few discriminants from different seeds.
const Ds = [0, 1, 7, 42].map((n) => createDiscriminant(new Uint8Array([n, n + 1, n + 2]), BITS));

describe("class group: discriminant", () => {
  it("creates negative primes D ≡ 1 (mod 8) of the requested size", () => {
    for (const D of Ds) {
      expect(D).toBeLessThan(0n);
      expect(isProbablePrime(-D)).toBe(true);
      expect(((D % 8n) + 8n) % 8n).toBe(1n);
      expect((-D).toString(2).length).toBe(BITS);
    }
  });
});

describe("class group: form operations preserve the group structure", () => {
  it("generator and identity have the right discriminant", () => {
    for (const D of Ds) {
      expect(discriminantOf(generator(D))).toBe(D);
      expect(discriminantOf(identity(D))).toBe(D);
    }
  });

  it("squaring and multiplication preserve the discriminant", () => {
    for (const D of Ds) {
      let f = generator(D);
      for (let i = 0; i < 50; i++) {
        f = square(f);
        expect(discriminantOf(f)).toBe(D);
      }
    }
  });

  it("identity is neutral", () => {
    for (const D of Ds) {
      const g = generator(D);
      expect(eq(multiply(g, identity(D)), g)).toBe(true);
    }
  });

  it("inverse composes to identity", () => {
    for (const D of Ds) {
      const g = pow(generator(D), 12345n, D);
      expect(eq(multiply(g, inverse(g)), identity(D))).toBe(true);
    }
  });

  it("composition is commutative and associative", () => {
    const D = Ds[2];
    const g = generator(D);
    const x = pow(g, 7n, D);
    const y = pow(g, 19n, D);
    const z = pow(g, 53n, D);
    expect(eq(multiply(x, y), multiply(y, x))).toBe(true);
    expect(eq(multiply(multiply(x, y), z), multiply(x, multiply(y, z)))).toBe(true);
  });

  it("repeated squaring equals exponentiation by a power of two", () => {
    const D = Ds[1];
    const g = generator(D);
    let f = g;
    for (let i = 0; i < 10; i++) f = square(f); // g^(2^10)
    expect(eq(f, pow(g, 1n << 10n, D))).toBe(true);
  });
});

describe("n-wesolowski proofs", () => {
  it("a valid proof verifies", () => {
    const D = Ds[0];
    const g = generator(D);
    const proof = proveN(g, 500, D, BITS, BITS, 3);
    expect(proof.verified).toBe(true);
    expect(verifyN(proof, D)).toBe(true);
    expect(proof.segments.length).toBe(3);
  });

  it("a tampered output fails verification", () => {
    const D = Ds[3];
    const g = generator(D);
    const proof = proveN(g, 400, D, BITS, BITS, 2);
    // tamper with the final output form
    proof.segments[proof.segments.length - 1].y = square(proof.segments[proof.segments.length - 1].y);
    expect(verifyN(proof, D)).toBe(false);
  });

  it("the VDF exposes a self-verifying proof from a challenge", () => {
    const vdf = new ClassGroupVdf(BITS, BITS);
    const proof = vdf.prove(new Uint8Array([9, 9, 9]), 256, 3);
    expect(proof.verified).toBe(true);
  });
});
