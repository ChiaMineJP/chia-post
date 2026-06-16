/**
 * A self-contained, mainnet-scale simulated lottery feed.
 *
 * Real cadence (scaled by `speed`): 64 signage points per 600 s sub-slot → one
 * SP every ~9.375 s; ~32 blocks per sub-slot → ~0.5 blocks per SP. Everything is
 * driven off the single SP tick so the rhythm feels like the chain: a steady
 * pulse of signage points, an occasional block somewhere on the network, and —
 * for *your* farm — the rare thrill of plots clearing the filter and, rarer
 * still, a winning proof.
 */
import type { FeedHandlers, MonitorFeed } from "./events.ts";
import { LiveFarm } from "./liveFarm.ts";

export interface SimOptions {
  /** wall-clock speed multiplier (1 = real mainnet cadence). */
  speed: number;
  /** size of the (real k=8) local farm scanned each signage point. */
  farmPlots: number;
  netspaceEiB: number;
  difficulty: number;
  subSlotIters: number;
  startHeight: number;
}

const SP_PER_SUB_SLOT = 64;
const BLOCKS_PER_SUB_SLOT = 32; // SLOT_BLOCKS_TARGET on mainnet
const SUB_SLOT_SECONDS = 600;

export const DEFAULT_SIM: SimOptions = {
  speed: 2,
  farmPlots: 16,
  netspaceEiB: 31,
  difficulty: 14_000_000_000,
  subSlotIters: 578_813_952,
  startHeight: 6_800_000,
};

function randHex(nBytes: number): string {
  let s = "";
  for (let i = 0; i < nBytes; i++) s += Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
  return s;
}

/** Poisson sample (Knuth) — fine for the small means used here. */
function poisson(mean: number): number {
  const L = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

export class SimFeed implements MonitorFeed {
  /** live-editable so the UI speed control takes effect on the next tick. */
  speed: number;
  private opts: SimOptions;
  private h?: FeedHandlers;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private spIndex = 0;
  private height: number;
  private peakHeight: number;
  private farm: LiveFarm;

  constructor(opts: Partial<SimOptions> = {}) {
    this.opts = { ...DEFAULT_SIM, ...opts };
    this.speed = this.opts.speed;
    this.height = this.opts.startHeight;
    this.peakHeight = this.opts.startHeight;
    this.farm = new LiveFarm(this.opts.farmPlots);
  }

  start(handlers: FeedHandlers): void {
    this.h = handlers;
    this.stopped = false;
    handlers.onStatus("live");
    this.emitState();
    this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private emitState(): void {
    this.h?.onEvent({
      type: "state",
      height: this.peakHeight,
      difficulty: this.opts.difficulty,
      subSlotIters: this.opts.subSlotIters,
      netspaceEiB: this.opts.netspaceEiB,
      synced: true,
      source: "sim",
      ts: Date.now(),
    });
  }

  private tick = (): void => {
    if (this.stopped || !this.h) return;
    const now = Date.now();
    const challenge = randHex(8);
    const ssi = this.opts.subSlotIters;
    const spIntervalIters = Math.floor(ssi / SP_PER_SUB_SLOT);

    // 1) the signage point itself
    this.h.onEvent({
      type: "signage_point",
      challenge,
      spIndex: this.spIndex,
      subSlotIters: ssi,
      difficulty: this.opts.difficulty,
      peakHeight: this.peakHeight,
      ts: now,
    });

    // 2) your farm's response: REAL k=8 proof-of-space scan of this challenge
    const fs = this.farm.scan(challenge, this.spIndex);
    this.h.onEvent({
      type: "farming_info",
      challenge,
      spHash: randHex(8),
      passed: fs.passed,
      proofs: fs.proofs,
      totalPlots: this.farm.total,
      lookupMs: 40 + Math.random() * 400,
      challengeHex: challenge,
      spIndex: this.spIndex,
      interval: fs.interval,
      filterThreshold: fs.threshold,
      attempts: fs.attempts,
      ts: now,
    });

    // 3) network-wide blocks won this round (~0.5 per SP)
    const blocks = poisson(BLOCKS_PER_SUB_SLOT / SP_PER_SUB_SLOT);
    for (let i = 0; i < blocks; i++) {
      this.height++;
      this.peakHeight = this.height;
      // winner depth: min of two uniforms skews small (usually a comfortable win,
      // sometimes a nail-biter near 1.0).
      const windowFraction = Math.min(Math.random(), Math.random());
      this.h.onEvent({
        type: "block",
        height: this.height,
        headerHash: randHex(8),
        spIndex: this.spIndex,
        isTransactionBlock: Math.random() < 0.5,
        overflow: this.spIndex >= SP_PER_SUB_SLOT - 3,
        kSize: Math.random() < 0.85 ? 32 : Math.random() < 0.5 ? 33 : 34,
        requiredIters: Math.floor(windowFraction * spIntervalIters),
        spIntervalIters,
        windowFraction,
        qualityHex: randHex(8),
        ts: Date.now(),
      });
    }

    this.spIndex = (this.spIndex + 1) % SP_PER_SUB_SLOT;

    const spMs = (SUB_SLOT_SECONDS * 1000) / SP_PER_SUB_SLOT / Math.max(0.1, this.speed);
    this.timer = setTimeout(this.tick, spMs);
  };
}
