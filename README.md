# chia-post

[![Live demo](https://img.shields.io/badge/▶%20live%20demo-chiaminejp.github.io%2Fchia--post-3fb950)](https://chiaminejp.github.io/chia-post/)
[![Built with](https://img.shields.io/badge/React%20·%20TypeScript%20·%20Vite%20·%20Canvas%20·%20KaTeX-16271f)](#)

An interactive, **structure-faithful** visualization of Chia's **Proof of Space and Time** (PoST) — the
timelord's three VDF chains, the farmer's proof of space, the block "lock", and transaction blocks — run at a
tiny **k = 8** toy scale so the *entire* consensus dance fits on screen and runs live in the browser.

**▶ [Open the live demo](https://chiaminejp.github.io/chia-post/)**

The trick is the scale: at k=8 a plot is 7 tables of ~256 entries (drawable), a sub-slot is a few hundred VDF
squarings (steppable), and a proof is 64 leaves you can walk one match at a time. The *structure and formulas*
are the real Chia ones; only the magnitudes are shrunk.

## What you can explore

It's all driven by one scrubbable timeline, with deep-dive modals reachable from the controls:

- **Timeline** — the three chains (Challenge / Infused Challenge / Reward) advancing as binary-quadratic-form
  VDFs, with signage points, infusion points, the deficit/ICC lifecycle, challenge folding, transaction-block
  rails, and a live "Now / Next slot change" readout.
- **⏱ Proof of Time** — step the sequential class-group squarings `g → g² → … → g^(2^T)`, watch the form
  `(a,b,c)` change while `b² − 4ac = Δ` stays invariant, and see the O(1) n-wesolowski check.
- **🔍 Plot scan** — every plot at a signage point: the plot-filter leading-zero bits vs the threshold, and the
  `required_iters` meter showing which quality is small enough to win.
- **🌳 Plot** — the whole 7-table forest the proof lives in, in bucketed strips; hover a bucket to see its
  matches; the winning proof path is lit up. Keys → `plot_id` → F1 seeds it all.
- **🧬 Proof of space** — the 64-leaf proof tree, steppable table-by-table, match-by-match, and down to the
  inner m-search of a single match; plus the cheap verification recipe and the memory⇄time tradeoff.
- **🔒 Puzzle** — how a block is locked by nested plot-key / pool-key signatures, with a **tamper** toggle that
  breaks the foliage signature when you rewrite the reward address.
- **💸 Transaction blocks** — the two rails (`prev_block_hash` for every block, `prev_transaction_block_hash`
  for the sparse tx chain), the `is_transaction_block` rule, and reward settlement.
- **📖 Textbook** — the concepts and a "Key formulas" reference, all typeset with KaTeX.

## How faithful is it?

Faithful in **structure and formulas**, scaled in **magnitude**, ported from the real Chia sources:

- **VDF (Time)** — a real **class-group VDF**: repeated squaring of binary quadratic forms with a discriminant
  derived from the challenge (no trusted setup), certified by an **n-wesolowski** proof. Ported from
  [`chiavdf`](https://github.com/Chia-Network/chiavdf) (`nucomp.h`, `vdf_new.h`, `create_discriminant.h`).
- **Proof of space** — the real **chiapos 7-table forward propagation**: F1, the adjacent-bucket matching with
  the `(2m+parity)²` quadratic, Fx, the 64-leaf proof and quality. Ported in shape from
  [`chiapos`](https://github.com/Chia-Network/chiapos). Constants are decoupled/shrunk so the forest is healthy
  at k=8 (the real `kBC=15113`, `kExtraBits=6` need k≥18 — which is exactly why chiapos can't plot k=8).
- **Signatures** — real **BLS12-381** (`@noble/curves`) for plot, farmer, and pool keys.
- **Consensus rules** — iteration math, the deficit/ICC rules, and `is_transaction_block` are ported from
  [`chia-blockchain`](https://github.com/Chia-Network/chia-blockchain) (`pot_iterations.py`, `deficit.py`,
  `prev_transaction_block.py`, `block_creation.py`).

Stand-ins, clearly labeled in the UI: ChaCha8/BLAKE3 → SHA-256 for F1/Fx, and the plotting "phases"
(sort/compress) are not modeled — it's the forward-propagation forest, not a real plot file.

## Architecture

A deterministic, **seeded, headless simulation core** emits a typed event stream that a React + Canvas UI
scrubs over. Cryptographic primitives sit behind interfaces.

```
src/
  sim/          headless, deterministic, seeded — the brain
    constants.ts     toy k=8 consensus constants (mainnet values quoted)
    iterations.ts    required_iters / sp_iters / ip_iters  (pot_iterations.py)
    timelord.ts      forward pass: 3 chains, deficit/ICC, tx rule  (timelord.py + deficit.py)
    plot.ts          BLS plot keys, plot_id, the plot filter
    proofofspace.ts  the chiapos-style 7-table forest, proof + quality
    farmer.ts        real proof-of-space block production
    events.ts        the typed event stream the UI consumes
  crypto/       real primitives behind interfaces
    classgroup.ts    binary quadratic form class group (chiavdf)
    wesolowski.ts    single + n-wesolowski VDF proofs
    vdf.ts / bls.ts / hash.ts / rng.ts
  ui/           React + Canvas + KaTeX
    TimelineCanvas, Inspector, and the modals above, Math (KaTeX), Textbook
```

The core is covered by **40 tests** (group axioms, proof round-trips, deficit transitions, the farmer pipeline).

## Run locally

```bash
npm install
npm run dev      # dev server
npm test         # sim-core tests (vitest)
npm run build    # typecheck + production build
```

Deployed to GitHub Pages from `main` via `.github/workflows/deploy.yml`.

---

Built as a learning tool; not affiliated with the Chia Network. Mechanics cross-checked against the upstream
`chia-blockchain`, `chiavdf`, and `chiapos` repositories.
