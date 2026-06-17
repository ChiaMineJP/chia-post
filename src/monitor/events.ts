/**
 * The Mainnet Monitor feed protocol.
 *
 * This is the *contract* between a feed source and the Monitor UI. Two sources
 * implement it:
 *   - SimFeed     — a self-contained, mainnet-scale simulated lottery (default;
 *                   works on GitHub Pages with no node).
 *   - WsFeed      — a WebSocket to the Python companion sidecar, which connects
 *                   to a real chia full node + farmer and re-emits these exact
 *                   events (sanitized, read-only).
 *
 * Keeping both behind one normalized schema means the UI never knows or cares
 * whether it is watching a simulation or real mainnet.
 */

export type MonitorEventType = "state" | "signage_point" | "farming_info" | "block";

/** A periodic snapshot of chain/farm state (peak, difficulty, netspace). */
export interface StateEvent {
  type: "state";
  height: number;
  difficulty: number;
  subSlotIters: number;
  /** estimated total netspace, in EiB. */
  netspaceEiB: number;
  synced: boolean;
  /** where this feed comes from — drives the SIM / LIVE badge. */
  source: "sim" | "live";
  ts: number;
}

/** A new signage point — the "lottery round starts" tick (64 per sub-slot). */
export interface SignagePointEvent {
  type: "signage_point";
  challenge: string; // short hex
  spIndex: number; // 0..63
  subSlotIters: number;
  difficulty: number;
  peakHeight: number;
  ts: number;
}

/**
 * One plot's attempt at a signage point — the per-plot near-miss detail.
 * Present in SIM mode (computed by the real k=8 engine) and, later, in LIVE mode
 * once the harvester patch (Tier B) exposes losing plots' required_iters.
 */
export interface PlotAttempt {
  plotIndex: number;
  /** cleared the plot filter (leading zero bits ≥ threshold)? */
  passed: boolean;
  filterBits: number;
  /** short hex of the plot-filter hash H(plot_id ‖ challenge ‖ sp). */
  filterHex?: string;
  /** passed the filter AND a matching table-7 entry exists (a proof was found).
   *  Many filter-passers have no T7 match → the lookup stops at the top table. */
  hasProof: boolean;
  qualityHex: string;
  /** null unless a proof was found. */
  requiredIters: number | null;
  /** requiredIters / sp_interval_iters — < 1 means it won the window. */
  windowFraction: number | null;
  win: boolean;
  /** real proof-of-space internals for the lookup card (sim only). */
  proof?: {
    /** how many table-7 entries matched the challenge. */
    t7Matches: number;
    /** the 64 leaf x-values. */
    xs: number[];
    /** the two leaves (xs[i], xs[i+1]) that form the quality. */
    qualityIndex: number;
    qualityStrHex: string;
    valid: boolean;
    /** one matched pair, with the (2m+parity)² quadratic re-derived. */
    sampleMatch?: { yL: number; yR: number; bucket: number; bL: number; cL: number; parity: number; m: number; sq: number; bcR: number };
  };
}

/**
 * Your farm's per-signage-point activity (from the node's FarmingInfo).
 * `passed` plots cleared the filter; of those, `proofs` found a winning quality.
 * The aggregate counts come from any node; `attempts` (the per-plot detail) is
 * present only when we have it (sim now, patched harvester later).
 */
export interface FarmingInfoEvent {
  type: "farming_info";
  challenge: string;
  spHash: string;
  passed: number;
  proofs: number;
  totalPlots: number;
  lookupMs: number;
  ts: number;
  // ── per-plot detail (optional) ──────────────────────────────────────
  challengeHex?: string;
  spIndex?: number;
  /** sp_interval_iters — the window a proof must fit inside to win. */
  interval?: number;
  filterThreshold?: number;
  attempts?: PlotAttempt[];
}

/** A block was won (network-wide). Enriched with the winning proof's depth. */
export interface BlockEvent {
  type: "block";
  height: number;
  headerHash: string; // short hex
  spIndex: number;
  isTransactionBlock: boolean;
  overflow: boolean;
  kSize?: number;
  /** requiredIters / spIntervalIters ∈ (0,1): how deep into the window it landed.
   *  small = won comfortably; near 1 = a nail-biter near-miss that just made it.
   *  Optional: a live node doesn't cheaply expose a block's required_iters. */
  windowFraction?: number;
  requiredIters?: number;
  spIntervalIters?: number;
  qualityHex?: string;
  ts: number;
}

export type MonitorEvent = StateEvent | SignagePointEvent | FarmingInfoEvent | BlockEvent;

export type FeedStatus = "connecting" | "live" | "closed" | "error";

export interface FeedHandlers {
  onEvent: (e: MonitorEvent) => void;
  onStatus: (s: FeedStatus, detail?: string) => void;
}

/** A source of monitor events. start() begins streaming; stop() tears down. */
export interface MonitorFeed {
  start(handlers: FeedHandlers): void;
  stop(): void;
}
