import { describe, expect, it } from "vitest";
import { TOY_CONSTANTS, spIntervalIters } from "./constants.ts";
import { generatePlots, leadingZeroBits, passesPlotFilter } from "./plot.ts";
import { Farmer } from "./farmer.ts";
import { runTimelord } from "./timelord.ts";
import { keygen, sign, verify, aggregatePks, aggregateSigs } from "../crypto/bls.ts";
import { utf8 } from "../crypto/hash.ts";

const C = TOY_CONSTANTS;

describe("BLS (real BLS12-381)", () => {
  it("keygen is deterministic and signatures verify", () => {
    const a = keygen(utf8("seed-a"));
    const b = keygen(utf8("seed-a"));
    expect(a.pk).toEqual(b.pk);
    const msg = utf8("hello");
    expect(verify(a.pk, msg, sign(a.sk, msg))).toBe(true);
  });

  it("same-message aggregate (plot signature) verifies against aggregate pk", () => {
    const local = keygen(utf8("local"));
    const farmer = keygen(utf8("farmer"));
    const msg = utf8("signage point");
    const plotPk = aggregatePks([local.pk, farmer.pk]);
    const plotSig = aggregateSigs([sign(local.sk, msg), sign(farmer.sk, msg)]);
    expect(verify(plotPk, msg, plotSig)).toBe(true);
    expect(verify(plotPk, utf8("other"), plotSig)).toBe(false);
  });
});

describe("plots & filter", () => {
  it("leadingZeroBits counts correctly", () => {
    expect(leadingZeroBits(new Uint8Array([0xff]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x00, 0xff]))).toBe(8);
    expect(leadingZeroBits(new Uint8Array([0x0f]))).toBe(4);
    expect(leadingZeroBits(new Uint8Array([0x01]))).toBe(7);
  });

  it("generatePlots is deterministic, plot_pk aggregates local+farmer", () => {
    const p1 = generatePlots(1234, 8, 4);
    const p2 = generatePlots(1234, 8, 4);
    expect(p1[0].plotId).toEqual(p2[0].plotId);
    expect(p1[0].plotPk).toEqual(aggregatePks([p1[0].local.pk, p1[0].farmer.pk]));
    expect(p1.length).toBe(8);
  });

  it("plot filter passes deterministically for a given challenge/sp", () => {
    const plots = generatePlots(1234, 8, 4);
    const challenge = utf8("c");
    const sp = utf8("sp-output");
    const r1 = plots.map((p) => passesPlotFilter(p, challenge, sp, 0));
    expect(r1.every((x) => x === true)).toBe(true); // 0 bits => everyone passes
  });
});

describe("Farmer produces earned blocks", () => {
  const farmer = new Farmer(C, generatePlots(1234, 16, 4));
  const trace = runTimelord(C, farmer, { numSubSlots: 4 });
  const infusions = trace.events.filter((e) => e.kind === "infusion") as Array<{
    pos?: { signatureValid: boolean };
    requiredIters: number;
    deficit: number;
  }>;

  it("produces a handful of blocks", () => {
    expect(infusions.length).toBeGreaterThan(2);
  });

  it("every block carries a VALID BLS plot signature", () => {
    for (const b of infusions) {
      expect(b.pos).toBeDefined();
      expect(b.pos!.signatureValid).toBe(true);
    }
  });

  it("every winner has required_iters inside the signage-point window", () => {
    const interval = Number(spIntervalIters(C));
    for (const b of infusions) {
      expect(b.requiredIters).toBeGreaterThanOrEqual(1);
      expect(b.requiredIters).toBeLessThan(interval);
    }
  });

  it("drives the deficit to 0 (ICC closes)", () => {
    expect(Math.min(...infusions.map((b) => b.deficit))).toBe(0);
    expect(trace.slots.some((s) => s.hasIcc)).toBe(true);
  });
});
