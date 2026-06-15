/**
 * Plots and the proof-of-space front end (the plot filter + quality).
 *
 * A farmer owns plots. For each signage point a plot may pass the *plot filter*
 * (a cheap hash gate, ~1/2^bits of plots pass), and if it does it yields a
 * *quality*. The quality becomes required_iters; if that lands inside the signage
 * point window the plot wins and a block is made.
 *
 * The actual proof of space (the chiapos 7-table lookup that produces the quality)
 * is the next milestone; here the quality is a hash stand-in. Everything around
 * it -- plot_id derivation, the filter, BLS plot keys, the signing -- is real.
 */
import { keygen, aggregatePks, type KeyPair } from "../crypto/bls.ts";
import { stdHash, utf8, u32be, toHex } from "../crypto/hash.ts";

export interface Plot {
  index: number;
  farmerId: number;
  k: number;
  /** harvester's half of the plot key. */
  local: KeyPair;
  /** farmer's key (shared by all of a farmer's plots). */
  farmer: KeyPair;
  /** pool key (shared per farmer). */
  pool: KeyPair;
  /** plot public key = aggregate(local_pk, farmer_pk). */
  plotPk: Uint8Array;
  /** plot_id = H(pool_pk || plot_pk). */
  plotId: Uint8Array;
}

export function generatePlots(seed: number | bigint, numPlots: number, numFarmers: number): Plot[] {
  const seedBytes = u32be(Number(BigInt(seed) & 0xffffffffn));
  const farmers: KeyPair[] = [];
  const pools: KeyPair[] = [];
  for (let f = 0; f < numFarmers; f++) {
    farmers.push(keygen(stdHash(seedBytes, utf8("farmer"), u32be(f))));
    pools.push(keygen(stdHash(seedBytes, utf8("pool"), u32be(f))));
  }
  const plots: Plot[] = [];
  for (let i = 0; i < numPlots; i++) {
    const farmerId = i % numFarmers;
    const local = keygen(stdHash(seedBytes, utf8("plot"), u32be(i)));
    const farmer = farmers[farmerId];
    const pool = pools[farmerId];
    const plotPk = aggregatePks([local.pk, farmer.pk]);
    const plotId = stdHash(pool.pk, plotPk);
    plots.push({ index: i, farmerId, k: 8, local, farmer, pool, plotPk, plotId });
  }
  return plots;
}

/** Number of leading zero BITS in a byte string. */
export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const b of bytes) {
    if (b === 0) {
      bits += 8;
      continue;
    }
    let v = b;
    while ((v & 0x80) === 0) {
      bits += 1;
      v <<= 1;
    }
    break;
  }
  return bits;
}

/**
 * Plot filter: plot_filter = H(plot_id || challenge || sp_output). The plot is
 * eligible only if it has >= `zeroBits` leading zero bits -- so ~1/2^zeroBits of
 * plots pass per signage point. Mirrors proof_of_space.py:passes_plot_filter.
 */
export function plotFilterValue(plot: Plot, challenge: Uint8Array, spOutput: Uint8Array): Uint8Array {
  return stdHash(plot.plotId, challenge, spOutput);
}

export function passesPlotFilter(
  plot: Plot,
  challenge: Uint8Array,
  spOutput: Uint8Array,
  zeroBits: number,
): boolean {
  return leadingZeroBits(plotFilterValue(plot, challenge, spOutput)) >= zeroBits;
}

/**
 * Quality string for an eligible plot. STAND-IN for the real chiapos table
 * lookup (next milestone): a deterministic hash of (plot_id, challenge, sp).
 * 32 bytes, like the real quality_string.
 */
export function qualityString(plot: Plot, challenge: Uint8Array, spOutput: Uint8Array): Uint8Array {
  return stdHash(plot.plotId, utf8("quality"), challenge, spOutput);
}

export function plotIdHex(plot: Plot): string {
  return toHex(plot.plotId, 6);
}
