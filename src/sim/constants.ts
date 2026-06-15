/**
 * Toy consensus constants for the k=8 visualization.
 *
 * These mirror the real constants in
 *   chia-blockchain/chia/consensus/default_constants.py
 * but are scaled WAY down so a full sub-slot is a few thousand VDF squarings
 * instead of ~134 million, and so a plot is 7 tables of ~256 entries instead of
 * petabytes. The *structure* and the *formulas* are identical to mainnet; only
 * the magnitudes change.
 *
 * Real mainnet values are quoted in comments for reference.
 */
export interface ConsensusConstants {
  /** Signage points per sub-slot. Real: 64. Must be a power of two. */
  NUM_SPS_SUB_SLOT: number;
  /** Extra SP intervals added before infusion (overflow grace). Real: 3. */
  NUM_SP_INTERVALS_EXTRA: number;
  /** VDF iterations per sub-slot. Real: 2**27 (~134M). Must be divisible by NUM_SPS_SUB_SLOT. */
  SUB_SLOT_ITERS: bigint;
  /** Deficit threshold; ICC runs only while deficit < this. Real: 16. */
  MIN_BLOCKS_PER_CHALLENGE_BLOCK: number;
  /** Target blocks per sub-slot. Real: 32. */
  SLOT_BLOCKS_TARGET: number;
  /** Max blocks per sub-slot. Real: 128. */
  MAX_SUB_SLOT_BLOCKS: number;
  /** Scaling factor in the quality->iters formula. Real: 2**67. */
  DIFFICULTY_CONSTANT_FACTOR: bigint;
  /** Starting difficulty (toy). */
  DIFFICULTY_STARTING: bigint;
  /** Plot k-size used everywhere in the visualization. Real min mainnet: 32. */
  K: number;
  /** Leading zero bits required by the plot filter. Real V1: 9. */
  NUMBER_ZERO_BITS_PLOT_FILTER: number;
}

export const TOY_CONSTANTS: ConsensusConstants = {
  // Mini PoST: 8 signage points per sub-slot instead of 64, so the whole picture
  // fits on screen. Still a power of two, still > NUM_SP_INTERVALS_EXTRA.
  NUM_SPS_SUB_SLOT: 8,
  NUM_SP_INTERVALS_EXTRA: 3,
  // 8 * 64 = 512 class-group squarings per sub-slot. sp_interval_iters = 64, so
  // required_iters (which must be < sp_interval_iters) has 64 levels of
  // resolution within a signage-point window.
  SUB_SLOT_ITERS: 512n,
  // Mini deficit: the ICC closes after just 4 blocks (real: 16), so a full
  // open -> infuse -> close -> fold cycle is visible within a few sub-slots.
  MIN_BLOCKS_PER_CHALLENGE_BLOCK: 4,
  SLOT_BLOCKS_TARGET: 8,
  MAX_SUB_SLOT_BLOCKS: 32,
  // Tuned together with DIFFICULTY_STARTING, the k=8 plot size, the plot count
  // and the filter so a real farmer wins ~2 blocks per sub-slot.
  // required_iters = difficulty * DCF * u / (2^256 * plot_size), u in [0,1).
  // With DCF=2^20, plot_size(k=8)=2176, win window = interval/((DCF)/plot_size).
  DIFFICULTY_CONSTANT_FACTOR: 1n << 20n,
  DIFFICULTY_STARTING: 1n,
  K: 8,
  NUMBER_ZERO_BITS_PLOT_FILTER: 3,
};

/** sp_interval_iters = SUB_SLOT_ITERS / NUM_SPS_SUB_SLOT. Real helper lives in pot_iterations.py. */
export function spIntervalIters(c: ConsensusConstants): bigint {
  if (c.SUB_SLOT_ITERS % BigInt(c.NUM_SPS_SUB_SLOT) !== 0n) {
    throw new Error("SUB_SLOT_ITERS must be divisible by NUM_SPS_SUB_SLOT");
  }
  return c.SUB_SLOT_ITERS / BigInt(c.NUM_SPS_SUB_SLOT);
}
