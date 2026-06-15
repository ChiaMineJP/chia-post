/**
 * The typed event stream the timelord emits and the UI consumes.
 *
 * Everything is positioned on a single absolute VDF axis (`totalIters`), so the
 * timeline UI is just "draw these events along x = totalIters". Each event also
 * carries the concrete VDF outputs at that point, so the UI can show the actual
 * group elements advancing on each of the three chains.
 */

import type { PosInfo } from "./blockSource.ts";

export type ChainId = "cc" | "icc" | "rc";

/** A sampled point of one VDF chain: where it is and what it currently outputs. */
export interface ChainSample {
  challengeHex: string;
  /** iteration within the current sub-slot (0..SUB_SLOT_ITERS). */
  iterInSlot: number;
  /** absolute iteration on the global axis. */
  totalIters: number;
  /** short hash of the VDF output at this point. */
  outputHex: string;
}

/** A signage point: 64 per sub-slot, where farmers get a challenge and try to win. */
export interface SignagePointEvent {
  kind: "signage_point";
  subSlot: number;
  spIndex: number; // 0..63
  totalIters: number;
  iterInSlot: number;
  /** full cc signage-point VDF output bytes (hex) — lets the UI recompute the plot scan. */
  ccSpOutputFullHex: string;
  cc: ChainSample;
  rc: ChainSample;
}

/** An infusion point: a winning block is folded into the chains here. */
export interface InfusionEvent {
  kind: "infusion";
  subSlot: number;
  /** the signage point this block was launched from. */
  spIndex: number;
  blockHeight: number;
  farmerId: number;
  requiredIters: number;
  /** iteration within the slot where infusion lands (ip_iters). */
  iterInSlot: number;
  totalIters: number;
  overflow: boolean;
  /** deficit AFTER infusing this block (0..MIN_BLOCKS_PER_CHALLENGE_BLOCK). */
  deficit: number;
  /** whether this block participates in the running infused-challenge-chain. */
  iccActive: boolean;
  /** the challenge block (deficit == MIN-1): it anchors the ICC as a `cc Bn` box. */
  isChallengeBlock: boolean;
  isTransactionBlock: boolean;
  /** for a tx block: the previous tx block it chains to (prev_transaction_block_hash). */
  prevTxBlockHeight: number | null;
  /** for a tx block: heights of the blocks whose rewards it settles. */
  rewardClaims: number[];
  /** proof-of-space + signature details, when produced by a real farmer. */
  pos?: PosInfo;
  cc: ChainSample;
  rc: ChainSample;
  icc?: ChainSample;
}

/** A compact, UI-facing summary of an n-wesolowski VDF proof. */
export interface VdfProofSummary {
  segments: number;
  iterations: number;
  verified: boolean;
  /** Fiat-Shamir prime l of the final segment (hex). */
  lHex: string;
  /** proof element pi of the final segment (short hash). */
  piHex: string;
  discriminantBits: number;
}

/** End of a sub-slot: the three chains close out and re-seed the next slot. */
export interface EndOfSubSlotEvent {
  kind: "end_of_sub_slot";
  subSlot: number;
  totalIters: number;
  deficitAtEnd: number;
  /** an ICC sub-slot is emitted (and folded into the next CC challenge) iff deficit==0. */
  hasIcc: boolean;
  cc: ChainSample;
  rc: ChainSample;
  icc?: ChainSample;
  /** challenge that seeds the CC chain for the next sub-slot. */
  nextCcChallengeHex: string;
  /** n-wesolowski proof that the CC VDF really ran the whole sub-slot. */
  ccProof: VdfProofSummary;
}

export type TimelordEvent = SignagePointEvent | InfusionEvent | EndOfSubSlotEvent;

/** Per-sub-slot summary, useful for the UI to draw slot lanes/boundaries. */
export interface SlotSummary {
  index: number;
  startIters: number;
  endIters: number;
  ccChallengeHex: string;
  /** full cc challenge bytes (hex) — the plot-filter challenge for this sub-slot. */
  ccChallengeFullHex: string;
  rcChallengeHex: string;
  numBlocks: number;
  /** iterInSlot where ICC became active (deficit dropped below MIN-1), if any. */
  iccStartIterInSlot: number | null;
  deficitAtEnd: number;
  hasIcc: boolean;
}

export interface TimelordTrace {
  subSlotIters: number;
  spIntervalIters: number;
  numSpsSubSlot: number;
  events: TimelordEvent[];
  slots: SlotSummary[];
  totalItersEnd: number;
}
