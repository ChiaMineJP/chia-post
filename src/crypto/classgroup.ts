/**
 * Binary quadratic form class group — the group Chia's VDF runs in.
 *
 * A form is a triple (a, b, c) with a fixed discriminant D = b^2 - 4ac < 0.
 * Forms of discriminant D, up to reduction, form a finite abelian group (the
 * class group of the imaginary quadratic field Q(sqrt(D))). Its order is hard to
 * compute from D alone, which is exactly why repeated squaring in it is a VDF
 * with NO trusted setup.
 *
 * Ported from the Chia reference implementation (chiavdf):
 *   - reduction / normalization:        src/vdf_new.h
 *   - NUDUPL (square) / NUCOMP (mul):    src/nucomp.h   (the classical "fast
 *     path"; the xgcd_partial "slow path" is only a large-integer optimization
 *     and produces identical results, so we omit it)
 *   - create_discriminant / HashPrime:  src/create_discriminant.h, proof_common.h
 *   - generator form (2, 1, (1-D)/8):   src/vdf_new.h
 *
 * Everything is exact BigInt arithmetic.
 */
import { sha256 } from "@noble/hashes/sha256";

export interface Form {
  a: bigint;
  b: bigint;
  c: bigint;
}

// --- small integer helpers -------------------------------------------------

/** Floor division for BigInt (rounds toward -infinity), d != 0. */
export function fdiv(n: bigint, d: bigint): bigint {
  let q = n / d;
  const r = n % d;
  if (r !== 0n && (r < 0n) !== (d < 0n)) q -= 1n;
  return q;
}

/** Non-negative modulo for positive modulus m. */
export function mod(x: bigint, m: bigint): bigint {
  const r = x % m;
  return r < 0n ? r + m : r;
}

export function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

/** Extended GCD: returns [g, s, t] with s*x + t*y = g and g >= 0. */
export function xgcd(x: bigint, y: bigint): [bigint, bigint, bigint] {
  let oldR = x, r = y;
  let oldS = 1n, s = 0n;
  let oldT = 0n, t = 1n;
  while (r !== 0n) {
    const q = oldR / r; // truncating division is fine for extended Euclid
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  if (oldR < 0n) return [-oldR, -oldS, -oldT];
  return [oldR, oldS, oldT];
}

// --- reduction (chiavdf src/vdf_new.h) -------------------------------------

function normalize(f: Form): Form {
  const { a, b, c } = f;
  const r = fdiv(a - b, 2n * a);
  return { a, b: b + 2n * a * r, c: a * r * r + b * r + c };
}

/** Reduce a form to its canonical representative: |b| <= a <= c, b>=0 if a==c. */
export function reduce(f: Form): Form {
  let { a, b, c } = normalize(f);
  while (a > c || (a === c && b < 0n)) {
    const s = fdiv(c + b, 2n * c);
    const na = c;
    const nb = 2n * s * c - b;
    const nc = c * s * s - b * s + a;
    a = na;
    b = nb;
    c = nc;
  }
  return normalize({ a, b, c });
}

// --- group operations (chiavdf src/nucomp.h, classical fast path) ----------

/** NUDUPL: square a form. */
export function square(f: Form): Form {
  // gcdext(b, a) -> coefficient of b is `mu`. Handle b's sign explicitly.
  let gcd: bigint, mu: bigint;
  if (f.b < 0n) {
    const [g, sb] = xgcd(-f.b, f.a);
    gcd = g;
    mu = -sb;
  } else {
    const [g, sb] = xgcd(f.b, f.a);
    gcd = g;
    mu = sb;
  }
  let a1 = f.a;
  let c1 = f.c;
  let k = mod(-(mu * c1), a1);
  if (gcd !== 1n) {
    a1 = a1 / gcd;
    c1 = c1 * gcd;
    k = mod(k, a1);
  }
  const t = a1 * k;
  const ra = a1 * a1;
  const rb = 2n * t + f.b;
  const rc = (f.b + t) * k + c1;
  return reduce({ a: ra, b: rb, c: rc / a1 });
}

/** NUCOMP: multiply (compose) two forms of the same discriminant. */
export function multiply(f1: Form, f2: Form): Form {
  if (f1.a > f2.a) [f1, f2] = [f2, f1];
  let a1 = f1.a;
  let a2 = f2.a;
  let c2 = f2.c;
  const ss = (f1.b + f2.b) / 2n; // same parity, exact
  const m = (f1.b - f2.b) / 2n;

  const t0 = mod(a2, a1);
  let sp: bigint, v1: bigint;
  if (t0 === 0n) {
    sp = a1;
    v1 = 0n;
  } else {
    const [g, s] = xgcd(t0, a1);
    sp = g;
    v1 = s;
  }
  let k = mod(m * v1, a1);

  if (sp !== 1n) {
    const [s, v2, u2] = xgcd(ss, sp);
    k = mod(k * u2 - v2 * c2, a1);
    if (s !== 1n) {
      a1 = a1 / s;
      a2 = a2 / s;
      c2 = c2 * s;
      k = mod(k, a1);
    }
  }

  const t = a2 * k;
  const ra = a2 * a1;
  const rb = 2n * t + f2.b;
  const rc = (f2.b + t) * k + c2;
  return reduce({ a: ra, b: rb, c: rc / a1 });
}

/** Group identity (principal form) for discriminant D. */
export function identity(D: bigint): Form {
  return reduce({ a: 1n, b: 1n, c: (1n - D) / 4n });
}

/** Generator form (2, 1, (1-D)/8). Requires D ≡ 1 (mod 8). */
export function generator(D: bigint): Form {
  return reduce({ a: 2n, b: 1n, c: (1n - D) / 8n });
}

export function inverse(f: Form): Form {
  return reduce({ a: f.a, b: -f.b, c: f.c });
}

/** form^e by square-and-multiply (e >= 0). */
export function pow(base: Form, e: bigint, D: bigint): Form {
  let result = identity(D);
  let b = base;
  let n = e;
  while (n > 0n) {
    if (n & 1n) result = multiply(result, b);
    b = square(b);
    n >>= 1n;
  }
  return result;
}

export function discriminantOf(f: Form): bigint {
  return f.b * f.b - 4n * f.a * f.c;
}

// --- discriminant creation (chiavdf create_discriminant.h / proof_common.h) -

function bytesToBig(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const byte of bytes) n = (n << 8n) | BigInt(byte);
  return n;
}

/** Miller-Rabin, deterministic for < 2^64 with these bases; probabilistic above. */
export function isProbablePrime(n: bigint): boolean {
  if (n < 2n) return false;
  for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let r = 0n;
  while (d % 2n === 0n) {
    d /= 2n;
    r += 1n;
  }
  const witnesses = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (const a of witnesses) {
    if (a >= n) continue;
    let x = modpow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let i = 0n; i < r - 1n; i++) {
      x = (x * x) % n;
      if (x === n - 1n) {
        composite = false;
        break;
      }
    }
    if (composite) return false;
  }
  return true;
}

export function modpow(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n;
  let b = base % m;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

/**
 * HashPrime: deterministically derive a prime of exactly `bits` bits from a seed
 * by hashing a counter, forcing the given bit positions to 1, and rejection-
 * sampling until prime. Port of chiavdf proof_common.h:HashPrime.
 */
export function hashPrime(seed: Uint8Array, bits: number, bitmask: number[]): bigint {
  const nbytes = Math.ceil(bits / 8);
  const sprout = new Uint8Array(seed);
  for (let guard = 0; guard < 1_000_000; guard++) {
    // expand via sha256 of an incrementing counter appended to the seed
    const blob = new Uint8Array(nbytes);
    let filled = 0;
    while (filled < nbytes) {
      // increment sprout (big-endian counter over its bytes)
      for (let i = sprout.length - 1; i >= 0; i--) {
        sprout[i] = (sprout[i] + 1) & 0xff;
        if (sprout[i] !== 0) break;
      }
      const h = sha256(sprout);
      const take = Math.min(h.length, nbytes - filled);
      blob.set(h.subarray(0, take), filled);
      filled += take;
    }
    let p = bytesToBig(blob) & ((1n << BigInt(bits)) - 1n);
    for (const bit of bitmask) p |= 1n << BigInt(bit);
    p |= 1n; // odd
    if (isProbablePrime(p)) return p;
  }
  throw new Error("hashPrime: exceeded iteration guard");
}

/**
 * create_discriminant: D = -p where p is a prime of `bits` bits with bits
 * {0,1,2,top} forced -> p ≡ 7 (mod 8) -> D ≡ 1 (mod 8), as required by the
 * generator form (2, 1, (1-D)/8). Port of chiavdf create_discriminant.h.
 */
export function createDiscriminant(seed: Uint8Array, bits: number): bigint {
  const p = hashPrime(seed, bits, [0, 1, 2, bits - 1]);
  return -p;
}

/** Deterministic fixed-width serialization of a form (sign byte + |a|,|b|). */
export function serializeForm(f: Form, bits: number): Uint8Array {
  const width = Math.ceil(bits / 8) + 2;
  const out = new Uint8Array(2 + 2 * width);
  out[0] = f.a < 0n ? 1 : 0;
  out[1] = f.b < 0n ? 1 : 0;
  writeBig(out, 2, abs(f.a), width);
  writeBig(out, 2 + width, abs(f.b), width);
  return out;
}

function writeBig(out: Uint8Array, off: number, n: bigint, width: number): void {
  let v = n;
  for (let i = width - 1; i >= 0; i--) {
    out[off + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}
