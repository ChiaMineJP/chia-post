# Tier B — per-plot near-misses (optional harvester patch)

The companion's v1 feed gives you the *aggregate* `passed` / `proofs` counts per
signage point. Tier B adds the **per-plot** `required_iters` — including the
plots that found a proof but **lost** the window, and the ones that passed the
filter but had **no proof at all** — so the Monitor's window-line lights up with
your farm's real near-misses (the gold "WIN ZONE", the markers landing *just*
outside it, and the red ✗ early-stops).

Per the project decision, **nothing here is required and nothing ships patched**.
The companion already *accepts* this data; you choose if/when to produce it. The
node-touching part is yours to apply to a fork you maintain.

## The contract

The companion consumes one **near-miss record** per signage point, as a JSON
object. It turns each into a `farming_info` event carrying per-plot `attempts`
(the same shape the built-in simulator emits), and that supersedes the aggregate
event for that signage point.

```jsonc
{
  "challenge_hash": "0x…",
  "sp_hash": "0x…",
  "signage_point_index": 7,
  "sub_slot_iters": 578813952,   // OR provide "sp_interval_iters" directly
  "total_plots": 1200,           // full farm size (filter cells = all plots)
  "filter_threshold": 9,         // NUMBER_ZERO_BITS_PLOT_FILTER (optional)
  "lookup_ms": 84.2,             // optional
  "plots": [                     // one entry per plot that PASSED the filter
    { "plot_index": 314, "passed": true, "has_proof": true,  "required_iters": 1850123 },
    { "plot_index": 902, "passed": true, "has_proof": true,  "required_iters": 9500000 },
    { "plot_index": 511, "passed": true, "has_proof": false, "required_iters": null }
  ]
}
```

- `required_iters` is the **smallest** required_iters among that plot's qualities
  (its best shot). `null` when `has_proof` is false.
- A plot **wins** iff `required_iters < sp_interval_iters`; the companion computes
  that and `windowFraction = required_iters / sp_interval_iters`.
- `plot_index` is a stable index in `[0, total_plots)` used only for placement; if
  you can't supply one cheaply, omit it and the array index is used.

## Two ways to deliver it

### A. Tail a JSONL file (recommended — least invasive)

The patch appends one record per line to a file; run the companion with:

```bash
python chia_post_companion.py --nearmiss-file ~/.chia/mainnet/near_miss.jsonl
```

Works with remote harvesters too (point both at a shared path), and never
touches the consensus/protocol path. This is the path the companion is built
around.

### B. Daemon event

If your patch instead emits `state_changed("near_miss_info", <record>)` from a
daemon-connected service, the companion already handles a `near_miss_info`
command on its daemon subscription — no extra flags.

## Where to hook (illustrative)

In `chia/harvester/harvester_api.py`, `new_signage_point_harvester` looks up each
filter-passing plot in a thread pool. Both `blocking_lookup_v2_partial_proofs`
(V2 plots) and `blocking_lookup` (V1) already compute `required_iters` per
quality — and then **discard the losers**:

```python
# chia/harvester/harvester_api.py  (V2 path, ~line 190)
for quality in qualities:
    required_iters = calculate_iterations_quality(
        self.harvester.constants, quality.get_string(),
        plot_info.prover.get_param(), difficulty, new_challenge.sp_hash,
    )
    if required_iters >= sp_interval_iters:
        continue          # ← the loser is dropped here; Tier B keeps it
    ...
```

The minimal change is to record, per plot, the **best** `required_iters` (and
`has_proof = len(qualities) > 0`) *before* that `continue`, accumulate across the
per-plot lookups, and flush one record once the signage point's lookups finish.

```python
# sketch — guard behind an opt-in flag so it's zero-cost when off
import os, json, threading
NEARMISS = os.environ.get("CHIA_POST_NEARMISS")          # e.g. a file path
_nm_lock = threading.Lock()

# inside blocking_lookup / blocking_lookup_v2_partial_proofs, per plot:
if NEARMISS:
    best = None
    for quality in qualities:
        ri = int(calculate_iterations_quality(... , quality.get_string(), ...))
        best = ri if best is None else min(best, ri)
    rec_plot = {
        "plot_index": getattr(plot_info, "plot_index", None),
        "passed": True,
        "has_proof": len(qualities) > 0,
        "required_iters": best,
    }
    with _nm_lock:
        _nm_accum.setdefault(new_challenge.sp_hash, []).append(rec_plot)

# after the awaited gather of all plot lookups for this signage point:
if NEARMISS:
    with _nm_lock:
        plots = _nm_accum.pop(new_challenge.sp_hash, [])
    record = {
        "challenge_hash": "0x" + new_challenge.challenge_hash.hex(),
        "sp_hash": "0x" + new_challenge.sp_hash.hex(),
        "signage_point_index": int(new_challenge.signage_point_index),
        "sub_slot_iters": int(new_challenge.sub_slot_iters),
        "total_plots": self.harvester.plot_manager.plot_count(),
        "plots": plots,
    }
    with open(NEARMISS, "a") as f:
        f.write(json.dumps(record) + "\n")
```

(For "passed the filter but no proof", note `has_proof=False`: those plots have
`qualities == []`, where the V2 path currently early-returns `None` — record them
before returning.)

## Caveats

- **Version-specific.** Function names and `calculate_iterations_quality`'s
  signature differ across chia releases; match your installed source. Run the
  companion with `-v` to see what's arriving.
- **Opt-in / zero-cost when off.** Gate everything on the flag so an unpatched-
  intent run does no extra work.
- **Sampling.** On a big farm you may want to cap `plots` to a sample to bound
  the file size; the Monitor only needs a representative spread.
