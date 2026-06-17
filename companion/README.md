# chia-post companion

A small sidecar that runs next to a real Chia node and feeds the web app's
**Mainnet Monitor** with live data. It connects inward over the node's
cert-authenticated interfaces and re-emits a **sanitized, read-only** event
stream over a plain CORS WebSocket the browser can read.

```
 chia full node + farmer ──(mutual-TLS)──> companion ──(ws://…/feed, CORS)──> Mainnet Monitor
   daemon WS  (55400): signage points, farming info
   full node RPC (8555): blockchain state, new blocks
```

The events it emits match the app's `MonitorEvent` schema
(`src/monitor/events.ts`), so the UI is identical to the built-in simulator —
only real.

## What it provides (v1, unmodified node)

- **signage points** — the lottery clock, low-latency from the daemon.
- **your farm's activity** — per-signage-point `passed` (plots clearing the
  filter) and `proofs` (winners), from the farmer's `FarmingInfo`. This is the
  aggregate near-miss texture available without modifying the node.
- **blocks** — height, signage-point index, k-size, tx/overflow, from the RPC.
- **chain state** — height, difficulty, sub-slot iters, netspace, synced.

Not yet included (needs a harvester patch — "Tier B"): the *per-plot*
`required_iters` for losing plots, which would light up the pipeline's
window-line in live mode exactly as the simulator does.

## Run it

On the node host, **inside the chia virtualenv** (so `import chia` works):

```bash
# auto-detects ~/.chia/mainnet (or $CHIA_ROOT)
python chia_post_companion.py

# expose to your LAN instead of localhost
python chia_post_companion.py --host 0.0.0.0 --port 8788
```

Then in the web app: **Mainnet Monitor → "connect node…"** and enter
`ws://<host>:8788/feed`.

### Test without a node

```bash
pip install aiohttp
python chia_post_companion.py --mock
```

`--mock` emits synthetic events so you can verify the WebSocket/CORS plumbing and
the UI connection end-to-end. Check it's up with `curl http://localhost:8788/health`.

## Notes

- The feed contains **no** private keys, plot file paths, or wallet addresses —
  only the public lottery/telemetry above. Even so, bind to `127.0.0.1` or a
  trusted LAN; don't expose it to the internet.
- It registers with the daemon as the `metrics` service to receive the full
  node's broadcast events; it coexists with `chia-exporter` if you run one.
- Targets recent chia-blockchain. If a field name differs on your version, the
  parsers degrade gracefully (missing values are simply omitted); run with `-v`
  to see what's arriving.
