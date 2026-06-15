import { describe, expect, it } from "vitest";
import {
  POS,
  buildForest,
  f1,
  fx,
  matches,
  findProofs,
  leafXs,
  verifyProof,
  proveAndVerify,
} from "./proofofspace.ts";
import { generatePlots } from "./plot.ts";
import { stdHash, u32be } from "../crypto/hash.ts";

const plotId = generatePlots(1234, 4, 2)[0].plotId;

describe("proof of space primitives", () => {
  it("f1 and fx are deterministic and in range", () => {
    expect(f1(plotId, 7)).toBe(f1(plotId, 7));
    expect(f1(plotId, 7)).toBeLessThan(POS.F_RANGE);
    expect(fx(2, 10, 20)).toBe(fx(2, 10, 20));
    expect(fx(2, 10, 20)).toBeLessThan(POS.F_RANGE);
  });

  it("matching requires adjacent buckets", () => {
    // same bucket can't match
    expect(matches(0, 1)).toBe(false);
    // exhaustive: every true match is in the next bucket
    for (let a = 0; a < POS.F_RANGE; a += 7) {
      for (let b = 0; b < POS.F_RANGE; b += 11) {
        if (matches(a, b)) {
          expect(Math.floor(b / POS.BC)).toBe(Math.floor(a / POS.BC) + 1);
        }
      }
    }
  });
});

describe("forest", () => {
  const forest = buildForest(plotId);

  it("has 7 tables that stay healthy (no collapse)", () => {
    expect(forest.length).toBe(POS.TABLES);
    for (const table of forest) expect(table.length).toBeGreaterThan(100);
  });

  it("every challenge yields a valid 64-leaf proof", () => {
    let withProof = 0;
    let verified = 0;
    for (let c = 0; c < 64; c++) {
      const challenge = stdHash(u32be(c));
      const t7 = findProofs(forest, challenge);
      if (t7.length === 0) continue;
      withProof++;
      const xs = leafXs(forest, POS.TABLES, t7[0]);
      expect(xs.length).toBe(64);
      if (verifyProof(plotId, xs, challenge).valid) verified++;
    }
    expect(withProof).toBeGreaterThan(40);
    expect(verified).toBe(withProof);
  });

  it("tampering with a leaf breaks verification", () => {
    const challenge = stdHash(u32be(3));
    const proof = proveAndVerify(plotId, challenge, forest)!;
    expect(proof.valid).toBe(true);
    const tampered = [...proof.xs];
    tampered[0] = (tampered[0] + 1) % (1 << POS.K);
    expect(verifyProof(plotId, tampered, challenge).valid).toBe(false);
  });

  it("the quality is H(challenge ‖ two leaf x-values) and is stable", () => {
    const challenge = stdHash(u32be(5));
    const p1 = proveAndVerify(plotId, challenge, forest)!;
    const expected = stdHash(challenge, u32be(p1.xs[p1.qualityIndex]), u32be(p1.xs[p1.qualityIndex + 1]));
    expect(p1.quality).toEqual(expected);
  });
});
