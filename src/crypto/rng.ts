/**
 * Deterministic, seeded PRNG so the entire simulation is reproducible: the same
 * seed always produces the same blocks, the same winners, the same timeline.
 * (Real consensus is driven by VDF outputs + plot lookups; here we use this to
 * stand in for "which of my plots passed the filter and what quality did it get"
 * until the real proof-of-space milestone replaces it.)
 *
 * Uses splitmix64 -> xoshiro-ish; good enough for visualization determinism.
 */
export class Rng {
  private s: bigint;
  private static MASK = (1n << 64n) - 1n;

  constructor(seed: number | bigint) {
    this.s = BigInt(seed) & Rng.MASK;
    if (this.s === 0n) this.s = 0x9e3779b97f4a7c15n;
  }

  /** Next 64-bit unsigned value (splitmix64). */
  nextU64(): bigint {
    this.s = (this.s + 0x9e3779b97f4a7c15n) & Rng.MASK;
    let z = this.s;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & Rng.MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & Rng.MASK;
    return (z ^ (z >> 31n)) & Rng.MASK;
  }

  /** Float in [0, 1). */
  nextFloat(): number {
    // top 53 bits -> double
    return Number(this.nextU64() >> 11n) / 2 ** 53;
  }

  /** A 256-bit unsigned bigint (used as a stand-in quality value). */
  next256(): bigint {
    let n = 0n;
    for (let i = 0; i < 4; i++) n = (n << 64n) | this.nextU64();
    return n;
  }

  /** Integer in [0, n). */
  nextInt(n: number): number {
    return Math.floor(this.nextFloat() * n);
  }
}
