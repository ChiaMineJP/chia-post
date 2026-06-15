import { describe, expect, it } from "vitest";
import { TOY_CONSTANTS, spIntervalIters } from "./constants.ts";
import { ipIters, isOverflowBlock, requiredItersFromQuality, spIters } from "./iterations.ts";
import { SeededBlockSource } from "./blockSource.ts";
import { calculateDeficit, runTimelord } from "./timelord.ts";

const C = TOY_CONSTANTS;

describe("iteration math (port of pot_iterations.py)", () => {
  it("sp_interval_iters divides the sub-slot into NUM_SPS equal parts", () => {
    expect(Number(spIntervalIters(C))).toBe(Number(C.SUB_SLOT_ITERS) / C.NUM_SPS_SUB_SLOT);
  });

  it("sp_iters is index * interval", () => {
    const interval = spIntervalIters(C);
    expect(spIters(C, 0)).toBe(0n);
    expect(spIters(C, 5)).toBe(interval * 5n);
  });

  it("overflow blocks are the last NUM_SP_INTERVALS_EXTRA signage points", () => {
    const firstOverflow = C.NUM_SPS_SUB_SLOT - C.NUM_SP_INTERVALS_EXTRA;
    expect(isOverflowBlock(C, firstOverflow - 1)).toBe(false);
    expect(isOverflowBlock(C, firstOverflow)).toBe(true);
    expect(isOverflowBlock(C, C.NUM_SPS_SUB_SLOT - 1)).toBe(true);
  });

  it("ip_iters wraps overflow blocks into the next slot", () => {
    const interval = spIntervalIters(C);
    // A non-overflow block lands within the same slot.
    const ipMid = ipIters(C, 1, 5n);
    expect(ipMid).toBeLessThan(C.SUB_SLOT_ITERS);
    expect(ipMid).toBe(spIters(C, 1) + BigInt(C.NUM_SP_INTERVALS_EXTRA) * interval + 5n);
    // The last (overflow) signage point wraps: result is small (next slot).
    const ipOver = ipIters(C, C.NUM_SPS_SUB_SLOT - 1, 5n);
    expect(ipOver).toBeLessThan(interval * BigInt(C.NUM_SP_INTERVALS_EXTRA + 1));
  });

  it("rejects required_iters outside [1, sp_interval_iters)", () => {
    expect(() => ipIters(C, 10, 0n)).toThrow();
    expect(() => ipIters(C, 10, spIntervalIters(C))).toThrow();
  });

  it("required_iters from quality is monotonic in quality and >= 1", () => {
    const low = requiredItersFromQuality(C, 1n, C.DIFFICULTY_STARTING, C.K);
    const high = requiredItersFromQuality(C, 1n << 255n, C.DIFFICULTY_STARTING, C.K);
    expect(low).toBeGreaterThanOrEqual(1n);
    expect(high).toBeGreaterThan(low);
  });
});

describe("deficit transitions (port of deficit.py)", () => {
  it("genesis deficit is MIN-1", () => {
    expect(calculateDeficit(C, 0, null, false, 0)).toBe(C.MIN_BLOCKS_PER_CHALLENGE_BLOCK - 1);
  });

  it("a normal block decrements the deficit", () => {
    expect(calculateDeficit(C, 1, 14, false, 0)).toBe(13);
  });

  it("deficit 0 with one finished sub-slot (non-overflow) resets to MIN-1", () => {
    expect(calculateDeficit(C, 5, 0, false, 1)).toBe(C.MIN_BLOCKS_PER_CHALLENGE_BLOCK - 1);
  });

  it("deficit 0 with no finished sub-slot stays 0", () => {
    expect(calculateDeficit(C, 5, 0, false, 0)).toBe(0);
  });
});

describe("timelord trace", () => {
  const source = new SeededBlockSource(C, 1234, { winProbability: 0.25 });
  const trace = runTimelord(C, source, { numSubSlots: 6 });

  it("emits events in strictly non-decreasing totalIters order", () => {
    for (let i = 1; i < trace.events.length; i++) {
      expect(trace.events[i].totalIters).toBeGreaterThanOrEqual(trace.events[i - 1].totalIters);
    }
  });

  it("emits 64 signage points per sub-slot", () => {
    const sps = trace.events.filter((e) => e.kind === "signage_point");
    expect(sps.length).toBe(6 * C.NUM_SPS_SUB_SLOT);
  });

  it("ends every sub-slot with an end_of_sub_slot event", () => {
    const eos = trace.events.filter((e) => e.kind === "end_of_sub_slot");
    expect(eos.length).toBe(6);
  });

  it("eventually drives the deficit to 0 and activates the ICC", () => {
    const infusions = trace.events.filter((e) => e.kind === "infusion");
    expect(infusions.length).toBeGreaterThan(0);
    const minDeficit = Math.min(...infusions.map((e) => (e as { deficit: number }).deficit));
    expect(minDeficit).toBe(0);
    const iccActiveCount = infusions.filter((e) => (e as { iccActive: boolean }).iccActive).length;
    expect(iccActiveCount).toBeGreaterThan(0);
    // At least one sub-slot closes with an ICC sub-slot.
    expect(trace.slots.some((s) => s.hasIcc)).toBe(true);
  });

  it("folds a real VDF output into each next CC challenge (challenges change)", () => {
    const challenges = trace.slots.map((s) => s.ccChallengeHex);
    expect(new Set(challenges).size).toBe(challenges.length);
  });
});
