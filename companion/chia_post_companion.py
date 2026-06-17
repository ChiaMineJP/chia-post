#!/usr/bin/env python3
"""
chia-post companion — bridges a local Chia node to the Mainnet Monitor.

It runs on the same host as a running chia full node + farmer, talks inward
over the node's cert-authenticated interfaces, and re-emits a *sanitized,
read-only* event stream over a plain CORS WebSocket that the web UI can consume:

  • daemon WebSocket (port 55400, mutual-TLS): low-latency `signage_point`
    and `new_farming_info` (your farm's per-signage-point filter passes / proofs).
  • full node RPC (port 8555, mutual-TLS): polled blockchain state (height,
    difficulty, sub-slot iters, netspace, synced) and new blocks.

Emitted events match the web app's MonitorEvent schema (src/monitor/events.ts),
so the UI is identical to the built-in simulator — just real.

Usage (inside the chia venv, on the node host):
    python chia_post_companion.py                 # auto-detects ~/.chia/mainnet
    python chia_post_companion.py --mock           # no node; emits fake events
    python chia_post_companion.py --host 0.0.0.0 --port 8788

Then in the web app: Mainnet Monitor → "connect node…" → ws://<host>:8788/feed

Security: the feed carries no keys, plot paths, or addresses. Still, bind it to
localhost or a trusted LAN only.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import secrets
import time
from typing import Any, Optional

from aiohttp import ClientSession, WSMsgType, web

log = logging.getLogger("chia-post-companion")


def now_ms() -> int:
    return int(time.time() * 1000)


def short(value: Any, n: int = 16) -> str:
    """Trim a hash-ish value to a short hex string for display."""
    if value is None:
        return ""
    s = str(value)
    if s.startswith("0x"):
        s = s[2:]
    return s[:n]


# ── browser-facing hub ──────────────────────────────────────────────────────
class Hub:
    def __init__(self) -> None:
        self.clients: set[web.WebSocketResponse] = set()
        self.last_state: Optional[dict] = None

    async def add(self, ws: web.WebSocketResponse) -> None:
        self.clients.add(ws)
        if self.last_state is not None:
            try:
                await ws.send_str(json.dumps(self.last_state))
            except Exception:
                pass

    def remove(self, ws: web.WebSocketResponse) -> None:
        self.clients.discard(ws)

    async def broadcast(self, event: dict) -> None:
        if event.get("type") == "state":
            self.last_state = event
        payload = json.dumps(event)
        dead = []
        for ws in self.clients:
            try:
                await ws.send_str(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


def make_app(hub: Hub) -> web.Application:
    @web.middleware
    async def cors(request: web.Request, handler):
        if request.method == "OPTIONS":
            resp: web.StreamResponse = web.Response()
        else:
            resp = await handler(request)
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Headers"] = "*"
        return resp

    async def feed(request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)
        await hub.add(ws)
        log.info("browser connected (%d total)", len(hub.clients))
        try:
            async for msg in ws:  # inbound is unused; just keep the socket open
                if msg.type in (WSMsgType.ERROR, WSMsgType.CLOSE):
                    break
        finally:
            hub.remove(ws)
            log.info("browser disconnected (%d total)", len(hub.clients))
        return ws

    async def health(request: web.Request) -> web.Response:
        return web.json_response({"ok": True, "clients": len(hub.clients)})

    app = web.Application(middlewares=[cors])
    app.router.add_get("/feed", feed)
    app.router.add_get("/health", health)
    return app


# ── chia integration ────────────────────────────────────────────────────────
def load_chia():
    from chia.util.config import load_config
    from chia.util.default_root import DEFAULT_ROOT_PATH

    config = load_config(DEFAULT_ROOT_PATH, "config.yaml")
    return DEFAULT_ROOT_PATH, config


def _uint16(v: int):
    try:
        from chia.util.ints import uint16  # type: ignore
    except Exception:  # newer chia moves sized ints to chia_rs
        from chia_rs.sized_ints import uint16  # type: ignore
    return uint16(v)


async def daemon_ws_task(hub: Hub, root, config, stop: asyncio.Event) -> None:
    """Subscribe to the daemon and forward signage points + farming info."""
    from chia.server.server import ssl_context_for_client

    host = config.get("self_hostname", "localhost")
    port = config.get("daemon_port", 55400)
    ca_crt = root / config["private_ssl_ca"]["crt"]
    ca_key = root / config["private_ssl_ca"]["key"]
    crt = root / config["daemon_ssl"]["private_crt"]
    key = root / config["daemon_ssl"]["private_key"]
    ssl_ctx = ssl_context_for_client(ca_crt, ca_key, crt, key)
    url = f"wss://{host}:{port}"

    while not stop.is_set():
        try:
            async with ClientSession() as session:
                async with session.ws_connect(url, ssl=ssl_ctx, max_msg_size=100 * 1024 * 1024, heartbeat=60) as ws:
                    await ws.send_json({
                        "command": "register_service",
                        "ack": False,
                        "data": {"service": "metrics"},
                        "request_id": secrets.token_hex(16),
                        "destination": "daemon",
                        "origin": "metrics",
                    })
                    log.info("daemon connected: %s", url)
                    async for msg in ws:
                        if msg.type != WSMsgType.TEXT:
                            continue
                        try:
                            payload = json.loads(msg.data)
                        except Exception:
                            continue
                        await handle_daemon_message(hub, payload)
        except Exception as e:
            log.warning("daemon ws error: %s (retry in 5s)", e)
        await asyncio.sleep(5)


async def handle_daemon_message(hub: Hub, payload: dict) -> None:
    cmd = payload.get("command")
    data = payload.get("data", {}) or {}
    if cmd == "signage_point":
        sp = data.get("broadcast_farmer", data) or {}
        await hub.broadcast({
            "type": "signage_point",
            "challenge": short(sp.get("challenge_chain_sp") or sp.get("challenge_hash")),
            "spIndex": int(sp.get("signage_point_index", 0)),
            "subSlotIters": int(sp.get("sub_slot_iters", 0)),
            "difficulty": int(sp.get("difficulty", 0)),
            "peakHeight": int(sp.get("peak_height", 0)),
            "ts": now_ms(),
        })
    elif cmd == "new_farming_info":
        fi = data.get("farming_info", data) or {}
        lookup = float(fi.get("lookup_time", 0) or 0)
        await hub.broadcast({
            "type": "farming_info",
            "challenge": short(fi.get("challenge_hash")),
            "spHash": short(fi.get("signage_point") or fi.get("sp_hash")),
            "passed": int(fi.get("passed_filter", fi.get("passed", 0)) or 0),
            "proofs": int(fi.get("proofs", 0) or 0),
            "totalPlots": int(fi.get("total_plots", 0) or 0),
            "lookupMs": round(lookup / 1000.0, 1),  # FarmingInfo.lookup_time is microseconds
            "ts": now_ms(),
        })


async def rpc_poll_task(hub: Hub, root, config, stop: asyncio.Event) -> None:
    """Poll blockchain state and emit state + new-block events."""
    from chia.full_node.full_node_rpc_client import FullNodeRpcClient

    host = config.get("self_hostname", "localhost")
    rpc_port = config["full_node"]["rpc_port"]
    client = await FullNodeRpcClient.create(host, _uint16(rpc_port), root, config)
    last_height: Optional[int] = None
    try:
        while not stop.is_set():
            try:
                state = await client.get_blockchain_state()
                peak = state.get("peak")
                height = int(peak.height) if peak is not None else 0
                await hub.broadcast({
                    "type": "state",
                    "height": height,
                    "difficulty": int(state.get("difficulty", 0)),
                    "subSlotIters": int(state.get("sub_slot_iters", 0)),
                    "netspaceEiB": round(int(state.get("space", 0)) / (2 ** 60), 2),
                    "synced": bool(state.get("sync", {}).get("synced", False)),
                    "source": "live",
                    "ts": now_ms(),
                })
                if peak is not None:
                    if last_height is None:
                        last_height = height
                    elif height > last_height:
                        start = max(last_height + 1, height - 8)  # cap bursts on resync
                        for h in range(start, height + 1):
                            await emit_block(hub, client, h)
                        last_height = height
            except Exception as e:
                log.warning("rpc poll error: %s", e)
            await asyncio.sleep(3)
    finally:
        client.close()
        await client.await_closed()


async def emit_block(hub: Hub, client, height: int) -> None:
    try:
        rec = await client.get_block_record_by_height(height)
        if rec is None:
            return
        block = await client.get_block(rec.header_hash)
        rcb = block.reward_chain_block
        await hub.broadcast({
            "type": "block",
            "height": height,
            "headerHash": short(rec.header_hash.hex()),
            "spIndex": int(rcb.signage_point_index),
            "isTransactionBlock": bool(rcb.is_transaction_block),
            "overflow": bool(getattr(rec, "overflow", False)),
            "kSize": int(rcb.proof_of_space.size),
            "ts": now_ms(),
            # windowFraction / requiredIters are intentionally omitted: a block's
            # required_iters is not cheaply recoverable from the public RPC. The
            # UI degrades gracefully (no depth bar) when they're absent.
        })
    except Exception as e:
        log.warning("emit_block %s error: %s", height, e)


# ── mock mode (no node) ──────────────────────────────────────────────────────
async def mock_task(hub: Hub, stop: asyncio.Event) -> None:
    import random

    sp_index = 0
    height = 6_800_000
    log.info("MOCK mode — emitting synthetic events")
    await hub.broadcast({
        "type": "state", "height": height, "difficulty": 14_000_000_000,
        "subSlotIters": 578_813_952, "netspaceEiB": 31.0, "synced": True, "source": "live", "ts": now_ms(),
    })
    while not stop.is_set():
        ch = secrets.token_hex(8)
        await hub.broadcast({
            "type": "signage_point", "challenge": ch, "spIndex": sp_index,
            "subSlotIters": 578_813_952, "difficulty": 14_000_000_000, "peakHeight": height, "ts": now_ms(),
        })
        passed = sum(1 for _ in range(300) if random.random() < 1 / 512)
        proofs = sum(1 for _ in range(passed) if random.random() < 0.03)
        await hub.broadcast({
            "type": "farming_info", "challenge": ch, "spHash": secrets.token_hex(8),
            "passed": passed, "proofs": proofs, "totalPlots": 300, "lookupMs": round(40 + random.random() * 400, 1), "ts": now_ms(),
        })
        if random.random() < 0.5:
            height += 1
            await hub.broadcast({
                "type": "block", "height": height, "headerHash": secrets.token_hex(8),
                "spIndex": sp_index, "isTransactionBlock": random.random() < 0.5,
                "overflow": False, "kSize": 32, "ts": now_ms(),
            })
        sp_index = (sp_index + 1) % 64
        await asyncio.sleep(2.0)


async def main_async(args: argparse.Namespace) -> None:
    hub = Hub()
    stop = asyncio.Event()
    runner = web.AppRunner(make_app(hub))
    await runner.setup()
    site = web.TCPSite(runner, args.host, args.port)
    await site.start()
    log.info("serving feed on ws://%s:%d/feed", args.host, args.port)

    tasks = []
    if args.mock:
        tasks.append(asyncio.create_task(mock_task(hub, stop)))
    else:
        root, config = load_chia()
        log.info("chia root: %s", root)
        tasks.append(asyncio.create_task(daemon_ws_task(hub, root, config, stop)))
        tasks.append(asyncio.create_task(rpc_poll_task(hub, root, config, stop)))

    try:
        await stop.wait()
    finally:
        for t in tasks:
            t.cancel()
        await runner.cleanup()


def main() -> None:
    p = argparse.ArgumentParser(description="chia-post companion — node → Mainnet Monitor bridge")
    p.add_argument("--host", default="127.0.0.1", help="bind address for the feed server (default 127.0.0.1)")
    p.add_argument("--port", type=int, default=8788, help="feed server port (default 8788)")
    p.add_argument("--mock", action="store_true", help="emit synthetic events; do not connect to a node")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        log.info("shutting down")


if __name__ == "__main__":
    main()
