/**
 * Live feed from a PUBLIC Chia full-node RPC (coinset.org) — no server, no keys,
 * no companion. The browser polls the public RPC directly (it is CORS-enabled),
 * so this works straight from the hosted site.
 *
 * What's real here: chain state (height, difficulty, netspace, synced) and every
 * new block — including its true required_iters, so the block's window-depth bar
 * is real. What a public node CANNOT expose: live signage points (node-internal)
 * and your farm's activity (you have no farm there). So the signage-point clock
 * and the "Your farm" function machine are the local k=8 simulation (real math,
 * simulated plots), driven here just like the built-in simulator.
 */
import type { FeedHandlers, MonitorFeed } from "./events.ts";
import { LiveFarm } from "./liveFarm.ts";

const COINSET = "https://api.coinset.org";
const POLL_MS = 6000;
const SP_PER_SUB_SLOT = 64;
const SUB_SLOT_SECONDS = 600;

function randHex(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
  return s;
}
function short(v: unknown, n = 16): string {
  if (v == null) return "";
  let s = String(v);
  if (s.startsWith("0x")) s = s.slice(2);
  return s.slice(0, n);
}

async function rpc(path: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${COINSET}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export class CoinsetFeed implements MonitorFeed {
  /** farm-sim cadence multiplier (the network side is real-time regardless). */
  speed = 2;
  private farm: LiveFarm;
  private h?: FeedHandlers;
  private stopped = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private spTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHeight: number | null = null;
  private subSlotIters = 578_813_952;
  private spIndex = 0;
  private peakHeight = 0;

  constructor(farmPlots = 16) {
    this.farm = new LiveFarm(farmPlots);
  }

  start(handlers: FeedHandlers): void {
    this.h = handlers;
    this.stopped = false;
    handlers.onStatus("connecting");
    this.poll();
    this.tickFarm();
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.spTimer) clearTimeout(this.spTimer);
    this.pollTimer = this.spTimer = null;
  }

  private poll = async (): Promise<void> => {
    if (this.stopped || !this.h) return;
    try {
      const data = await rpc("get_blockchain_state", {});
      const bs = data.blockchain_state;
      const peak = bs?.peak;
      if (peak) {
        this.subSlotIters = Number(peak.sub_slot_iters) || this.subSlotIters;
        this.peakHeight = Number(peak.height);
        const interval = Math.floor(this.subSlotIters / SP_PER_SUB_SLOT);
        // re-sync the local signage-point clock to the real peak
        this.spIndex = Math.floor((Number(peak.total_iters) % this.subSlotIters) / interval) % SP_PER_SUB_SLOT;

        this.h.onStatus("live");
        this.h.onEvent({
          type: "state",
          height: this.peakHeight,
          difficulty: Number(bs.difficulty) || 0,
          subSlotIters: this.subSlotIters,
          netspaceEiB: Math.round((Number(bs.space) || 0) / 2 ** 60 * 100) / 100,
          synced: !!bs.sync?.synced,
          source: "live",
          ts: Date.now(),
        });

        if (this.lastHeight === null) this.lastHeight = this.peakHeight;
        else if (this.peakHeight > this.lastHeight) {
          await this.emitBlock(peak, interval);
          this.lastHeight = this.peakHeight;
        }
      }
    } catch (e) {
      this.h.onStatus("error", `coinset: ${e instanceof Error ? e.message : e}`);
    }
    if (!this.stopped) this.pollTimer = setTimeout(this.poll, POLL_MS);
  };

  private async emitBlock(peak: any, interval: number): Promise<void> {
    if (!this.h) return;
    const req = Number(peak.required_iters);
    let kSize: number | undefined;
    try {
      const fb = await rpc("get_block", { header_hash: peak.header_hash });
      kSize = Number(fb?.block?.reward_chain_block?.proof_of_space?.size) || undefined;
    } catch {
      /* k-size is optional */
    }
    this.h.onEvent({
      type: "block",
      height: Number(peak.height),
      headerHash: short(peak.header_hash),
      spIndex: Number(peak.signage_point_index) || 0,
      isTransactionBlock: peak.timestamp != null, // only tx blocks carry a timestamp
      overflow: !!peak.overflow,
      kSize,
      requiredIters: req,
      spIntervalIters: interval,
      windowFraction: interval ? req / interval : undefined,
      qualityHex: short(peak.reward_infusion_new_challenge, 8),
      ts: Date.now(),
    });
  }

  // simulated signage points + farm (a public node exposes neither)
  private tickFarm = (): void => {
    if (this.stopped || !this.h) return;
    const challenge = randHex(8);
    this.h.onEvent({
      type: "signage_point",
      challenge,
      spIndex: this.spIndex,
      subSlotIters: this.subSlotIters,
      difficulty: 0,
      peakHeight: this.peakHeight,
      ts: Date.now(),
    });
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
      ts: Date.now(),
    });
    this.spIndex = (this.spIndex + 1) % SP_PER_SUB_SLOT;
    const spMs = (SUB_SLOT_SECONDS * 1000) / SP_PER_SUB_SLOT / Math.max(0.1, this.speed);
    this.spTimer = setTimeout(this.tickFarm, spMs);
  };
}
