import { sha256 } from "@noble/hashes/sha256";

/** std_hash equivalent: SHA-256 of the concatenation of byte inputs. */
export function stdHash(...parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return sha256(parts[0]);
  let total = 0;
  for (const p of parts) total += p.length;
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return sha256(buf);
}

/** Interpret bytes as a big-endian unsigned bigint (matches int.from_bytes(..., "big")). */
export function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

/** A 256-bit number derived from inputs, as used for quality/iteration math. */
export function hashToUint256(...parts: Uint8Array[]): bigint {
  return bytesToBigInt(stdHash(...parts));
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}

export function toHex(bytes: Uint8Array, maxBytes = bytes.length): string {
  let s = "";
  const n = Math.min(maxBytes, bytes.length);
  for (let i = 0; i < n; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  const n = hex.length >> 1;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bigToHex(n: bigint, bytes = 8): string {
  const hex = n.toString(16);
  const want = bytes * 2;
  return hex.length >= want ? hex.slice(0, want) : hex.padStart(want, "0");
}
