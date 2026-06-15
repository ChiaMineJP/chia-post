# chia-post

Interactive visualization of Chia's **Proof of Space and Time** (PoST), built to
be watched at toy scale (`k = 8`, tiny VDF iteration counts) so the entire
consensus dance — timelord, full node, farmer — can run live in the browser.

## Status

- **Milestone 1 ✅ — Timelord, the three VDF chains.** Challenge Chain (CC),
  Infused Challenge Chain (ICC), Reward Chain (RC) advancing on one VDF axis,
  with 64 signage points per sub-slot, real infusion points, the exact deficit
  rules, and ICC activation/closure. Scrubbable Canvas timeline.
- Milestone 2 — Farmer winning a block (plot filter → quality → required_iters → signing).
- Milestone 3 — `k=8` Hellman/"Beyond Hellman" plot tables + quality lookup.
- Milestone 4 — The puzzle/lock (nested PoS → plot signature → foliage signature).
- Milestone 5 — Transaction blocks and dual-rail chaining.

## Architecture

Deterministic, headless **simulation core** (pure TS, seeded) emits a typed
event stream that a **React + Canvas** renderer scrubs over. Cryptographic
**primitives sit behind interfaces** so faithful/Wasm implementations can drop in
without touching the sim or UI.

```
src/
  sim/        headless, deterministic, seeded — the brain
    constants.ts   toy k=8 consensus constants (mainnet values quoted)
    iterations.ts  required_iters / sp_iters / ip_iters — port of pot_iterations.py
    timelord.ts    3-chain state machine; calculateDeficit() ports deficit.py
    blockSource.ts seeded stand-in for the farmer/PoSpace layer (milestone 2 replaces)
    events.ts      typed event stream the UI consumes
  crypto/     real primitives behind interfaces
    classgroup.ts  binary quadratic form class group (ported from chiavdf)
    wesolowski.ts  single + n-wesolowski VDF proofs and verification
    vdf.ts         ClassGroupVdf wrapping the above behind the Vdf interface
    hash.ts        SHA-256 helpers (std_hash equivalent)
    rng.ts         splitmix64 seeded PRNG
  ui/         React + Canvas
    TimelineCanvas.tsx   the 3-chain spine
    Inspector.tsx        per-event detail panel
```

### The VDF — real class group + n-wesolowski

The "Time" in PoST is a VDF: `y = g^(2^T)` in a group of **unknown order**, which
forces `T` sequential squarings. This project runs the **actual** construction
Chia uses: repeated squaring of **binary quadratic forms in the class group of an
imaginary quadratic field**, with the discriminant derived from each chain's
challenge (`create_discriminant`) so there is **no trusted setup**. Correctness of
every sub-slot is certified with a real **n-wesolowski** proof (`π^l · g^r == y`).

- `crypto/classgroup.ts` — forms, reduction, NUDUPL (square), NUCOMP (multiply),
  `create_discriminant`/`HashPrime`, ported from `chiavdf` (`src/nucomp.h`,
  `src/vdf_new.h`, `src/create_discriminant.h`). The classical "fast path" only —
  the `xgcd_partial` slow path is a large-integer optimization that yields
  identical results, so it is omitted.
- `crypto/wesolowski.ts` — single + segmented ("n-wesolowski") prove/verify.
- Tests assert the group axioms (identity, inverse, associativity, commutativity,
  discriminant invariance) and that proofs verify while tampering is rejected.

Toy scaling: a 64-bit discriminant and `SUB_SLOT_ITERS = 4096` keep it
responsive; mainnet uses a 1024-bit discriminant and 2²⁷ iters. The `Vdf`
interface is the seam — `chiavdf` compiled to Wasm could drop in for byte-level
serialization fidelity.

### Why TypeScript, not Rust/Wasm

At `k=8` with scaled-down iteration counts the computation is light enough that
the real class-group VDF runs fine on the main thread, so Wasm buys little for
performance. It is worth reaching for later only for *fidelity* (real
`chiapos`/`chiavdf`/BLS byte formats) — and `chiapos` can't even do `k=8`, so the
plot tables must be a faithful toy reimplementation regardless.

## Grounding

Mechanics are ported from `chia-blockchain`:
`chia/consensus/pot_iterations.py`, `deficit.py`, `default_constants.py`,
`block_creation.py`, and `chia/timelord/`.

## Run

```bash
npm install          # if Socket CLI blocks esbuild's CVE: prefix SOCKET_CLI_ACCEPT_RISKS=1
npm run dev          # dev server
npm test             # sim-core tests (iteration math, deficit, timelord trace)
npm run build        # typecheck + production build
```
