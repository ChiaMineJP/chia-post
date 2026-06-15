/**
 * Real BLS signatures (BLS12-381) via @noble/curves — the same curve Chia uses
 * for plot, farmer, and pool keys. Used to sign signage points and to aggregate
 * the harvester + farmer partial signatures into one plot signature.
 *
 * Aggregation here is same-message aggregation: the harvester and farmer both
 * sign the *same* signage-point message with their halves of the plot key, and
 * the aggregate verifies against the aggregated plot public key. That mirrors
 * Chia's get_plot_signature flow at a teaching level.
 */
import { bls12_381 as bls } from "@noble/curves/bls12-381";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToBigInt } from "./hash.ts";

// BLS12-381 subgroup (scalar field) order.
const R = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

/** Deterministic 32-byte private key (scalar in [1, R)) from a seed. */
function skFromSeed(seed: Uint8Array): Uint8Array {
  let n = (bytesToBigInt(sha256(seed)) % (R - 1n)) + 1n;
  const b = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    b[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return b;
}

export interface KeyPair {
  sk: Uint8Array;
  pk: Uint8Array; // G1, 48 bytes compressed
}

export function keygen(seed: Uint8Array): KeyPair {
  const sk = skFromSeed(seed);
  return { sk, pk: bls.getPublicKey(sk) };
}

export function sign(sk: Uint8Array, msg: Uint8Array): Uint8Array {
  return bls.sign(msg, sk);
}

export function verify(pk: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean {
  return bls.verify(sig, msg, pk);
}

export function aggregatePks(pks: Uint8Array[]): Uint8Array {
  return bls.aggregatePublicKeys(pks);
}

export function aggregateSigs(sigs: Uint8Array[]): Uint8Array {
  return bls.aggregateSignatures(sigs);
}
