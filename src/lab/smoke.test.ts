import { describe, expect, it } from "vitest";
import { LabFarm } from "./runPipeline.ts";
import { buildBlsTrace } from "./blsTrace.ts";

describe("PoST Lab pipeline", () => {
  it("finds a proof-bearing run and signs it, verifiably", () => {
    const farm = new LabFarm();
    let seed = 1;
    for (let n = 0; n < 6; n++) {
      const run = farm.runSignagePoint(seed);
      expect(run).not.toBeNull();
      if (!run) return;
      // proof of space is real and valid
      expect(run.lookup.xs.length).toBe(64);
      expect(run.lookup.proof.valid).toBe(true);
      expect(run.lookup.rootTopK).toBe(run.lookup.challengeTopK);
      // required_iters computed
      expect(run.req.requiredIters).toBeGreaterThan(0n);
      // a winning run must expose its infusion point
      if (run.req.win) expect(run.req.ipIters).not.toBeNull();
      // BLS signing trace verifies via the pairing
      const bls = buildBlsTrace(run.plot.local.sk, run.plot.farmer.sk, run.sp.spOutput, run.sp.spOutputHex);
      expect(bls.localMul.matchesNative).toBe(true);
      expect(bls.verified).toBe(true);
      expect(bls.localMul.steps.length).toBeGreaterThan(10);
      seed = run.sp.seed + 1;
    }
  });
});
