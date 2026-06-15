/**
 * The iteration math that decides WHEN a winning proof gets infused into the
 * chains. Faithful port of chia-blockchain/chia/consensus/pot_iterations.py.
 *
 * The whole game:
 *   - A sub-slot is SUB_SLOT_ITERS of VDF time, divided into NUM_SPS_SUB_SLOT
 *     equal "signage point" intervals.
 *   - At each signage point a farmer learns a challenge and computes a `quality`
 *     from their proof of space.
 *   - quality -> required_iters. A proof WINS its signage point only if
 *     required_iters < sp_interval_iters (it fits inside one interval).
 *   - The block is then infused at ip_iters = sp_iters + 3*interval + required_iters
 *     (mod sub_slot_iters). The "+3 intervals" is the overflow grace window.
 */
import type { ConsensusConstants } from "./constants.ts";
import { spIntervalIters } from "./constants.ts";

const TWO_POW_256 = 1n << 256n;

/** is_overflow_block: SPs in the last NUM_SP_INTERVALS_EXTRA of the slot infuse into the NEXT slot. */
export function isOverflowBlock(c: ConsensusConstants, signagePointIndex: number): boolean {
  if (signagePointIndex >= c.NUM_SPS_SUB_SLOT) throw new Error("SP index too high");
  return signagePointIndex >= c.NUM_SPS_SUB_SLOT - c.NUM_SP_INTERVALS_EXTRA;
}

/** sp_iters: the VDF iteration at which signage point `index` occurs. */
export function spIters(c: ConsensusConstants, signagePointIndex: number): bigint {
  if (signagePointIndex >= c.NUM_SPS_SUB_SLOT) throw new Error("SP index too high");
  return spIntervalIters(c) * BigInt(signagePointIndex);
}

/**
 * ip_iters: the VDF iteration (within the slot, mod SUB_SLOT_ITERS) at which a
 * winning block is infused.
 *
 *   ip_iters = (sp_iters + NUM_SP_INTERVALS_EXTRA * sp_interval_iters + required_iters) % sub_slot_iters
 */
export function ipIters(
  c: ConsensusConstants,
  signagePointIndex: number,
  requiredIters: bigint,
): bigint {
  const interval = spIntervalIters(c);
  const sp = spIters(c, signagePointIndex);
  if (sp % interval !== 0n || sp >= c.SUB_SLOT_ITERS) {
    throw new Error(`Invalid sp iters ${sp} for ssi ${c.SUB_SLOT_ITERS}`);
  }
  if (requiredIters >= interval || requiredIters === 0n) {
    throw new Error(`required_iters ${requiredIters} must be in [1, ${interval})`);
  }
  return (
    (sp + BigInt(c.NUM_SP_INTERVALS_EXTRA) * interval + requiredIters) % c.SUB_SLOT_ITERS
  );
}

/**
 * Expected plot size in bytes for a k-size plot (V1 formula from
 * chia/consensus/pos_quality.py): (2k + 1) * 2^(k-1).
 * For k=8 this is 17 * 128 = 2176 bytes -- small enough to draw.
 */
export function expectedPlotSize(k: number): bigint {
  return BigInt(2 * k + 1) * (1n << BigInt(k - 1));
}

/**
 * calculate_iterations_quality: turn a quality string into required_iters.
 *
 *   sp_quality = H(quality_string || cc_sp_output_hash)   // a 256-bit number
 *   u = sp_quality / 2^256                                 // uniform in [0,1)
 *   required_iters = max(1, difficulty * DCF * u / plot_size)
 *
 * `spQuality256` is that hash already reduced to a bigint in [0, 2^256).
 * Returning required_iters; the caller checks whether it is < sp_interval_iters
 * (a win) and where it lands.
 */
export function requiredItersFromQuality(
  c: ConsensusConstants,
  spQuality256: bigint,
  difficulty: bigint,
  k: number,
): bigint {
  const iters =
    (difficulty * c.DIFFICULTY_CONSTANT_FACTOR * spQuality256) /
    (TWO_POW_256 * expectedPlotSize(k));
  return iters > 1n ? iters : 1n;
}

/** Does this quality win its signage point (does it fit inside one SP interval)? */
export function isWinningRequiredIters(c: ConsensusConstants, requiredIters: bigint): boolean {
  return requiredIters >= 1n && requiredIters < spIntervalIters(c);
}
