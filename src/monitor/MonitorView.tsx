import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BlockEvent,
  FarmingInfoEvent,
  FeedHandlers,
  FeedStatus,
  MonitorFeed,
  SignagePointEvent,
  StateEvent,
} from "./events.ts";
import { DEFAULT_SIM, SimFeed } from "./simFeed.ts";
import { WsFeed } from "./wsFeed.ts";
import { PosMachine } from "./PosMachine.tsx";

const SP_PER_SUB_SLOT = 64;

interface Toast {
  id: number;
  kind: "block" | "close" | "pass" | "win";
  icon: string;
  title: string;
  sub: string;
}

export function MonitorView() {
  const [source, setSource] = useState<"sim" | "ws">("sim");
  const [wsUrl, setWsUrl] = useState("ws://localhost:8788/feed");
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [statusDetail, setStatusDetail] = useState<string | undefined>();
  const [chain, setChain] = useState<StateEvent | null>(null);
  const [sp, setSp] = useState<SignagePointEvent | null>(null);
  const [farm, setFarm] = useState({ last: null as FarmingInfoEvent | null, rounds: 0, passed: 0, proofs: 0, bestFraction: null as number | null });
  const [blocks, setBlocks] = useState<BlockEvent[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [speed, setSpeed] = useState(DEFAULT_SIM.speed);

  const feedRef = useRef<MonitorFeed | null>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const toastId = useRef(0);

  const addToast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { ...t, id }].slice(-5));
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 5200);
  }, []);

  useEffect(() => {
    const feed: MonitorFeed = source === "sim" ? new SimFeed() : new WsFeed(wsUrl);
    if (feed instanceof SimFeed) feed.speed = speedRef.current;
    feedRef.current = feed;

    const handlers: FeedHandlers = {
      onStatus: (s, d) => { setStatus(s); setStatusDetail(d); },
      onEvent: (e) => {
        if (e.type === "state") setChain(e);
        else if (e.type === "signage_point") setSp(e);
        else if (e.type === "farming_info") {
          setFarm((prev) => {
            let best = prev.bestFraction;
            for (const a of e.attempts ?? [])
              if (a.windowFraction != null && (best == null || a.windowFraction < best)) best = a.windowFraction;
            return {
              last: e,
              rounds: prev.rounds + 1,
              passed: prev.passed + e.passed,
              proofs: prev.proofs + e.proofs,
              bestFraction: best,
            };
          });
          if (e.proofs > 0)
            addToast({ kind: "win", icon: "🏆", title: `YOUR FARM WON ${e.proofs} proof${e.proofs > 1 ? "s" : ""}!`, sub: `${e.passed} of ${e.totalPlots} plots cleared the filter` });
          else if (e.passed > 0)
            addToast({ kind: "pass", icon: "🎯", title: `${e.passed} plot${e.passed > 1 ? "s" : ""} cleared the filter`, sub: "your farm · this round" });
        } else if (e.type === "block") {
          setBlocks((prev) => [e, ...prev].slice(0, 24));
          const wf = e.windowFraction;
          const close = wf != null && wf > 0.85;
          const depth = wf != null ? `landed at ${Math.round(wf * 100)}% of the window` : `sp ${e.spIndex}`;
          addToast({
            kind: close ? "close" : "block",
            icon: close ? "😅" : "⛏",
            title: `Block #${e.height.toLocaleString()} won`,
            sub: `${depth}${e.isTransactionBlock ? " · tx" : ""}${close ? " — nail-biter!" : ""}`,
          });
        }
      },
    };
    feed.start(handlers);
    return () => feed.stop();
    // speed is applied live via the effect below, not by recreating the feed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, wsUrl, addToast]);

  useEffect(() => {
    const f = feedRef.current;
    if (f instanceof SimFeed) f.speed = speed;
  }, [speed]);

  const totalPlots = farm.last?.totalPlots ?? DEFAULT_SIM.farmPlots;

  return (
    <div className="monitor">
      <div className="mon-bar">
        <span className={`mon-badge ${chain?.source === "live" ? "live" : "sim"}`}>
          {chain?.source === "live" ? "LIVE" : "SIM"}
        </span>
        <span className={`mon-status ${status}`}>● {status}{statusDetail ? ` — ${statusDetail}` : ""}</span>
        <span className="mon-stat">height <b>{chain ? chain.height.toLocaleString() : "—"}</b></span>
        <span className="mon-stat">netspace <b>{chain ? `${chain.netspaceEiB} EiB` : "—"}</b></span>
        <span className="mon-stat">difficulty <b>{chain ? chain.difficulty.toLocaleString() : "—"}</b></span>
        <span className="mon-spacer" />
        {source === "sim" ? (
          <>
            <label className="mon-speed">speed ×{speed}
              <input type="range" min={1} max={16} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
            </label>
            <button className="mon-conn-btn" onClick={() => setSource("ws")}>connect node…</button>
          </>
        ) : (
          <>
            <input className="mon-url" value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} spellCheck={false} />
            <button className="mon-conn-btn" onClick={() => setSource("sim")}>use sim</button>
          </>
        )}
      </div>

      <div className="mon-panel sp-strip">
        <div className="sp-strip-head">
          <h3>Signage point <span>the lottery clock · {SP_PER_SUB_SLOT} per sub-slot</span></h3>
          <span className="sp-now">
            sp <b>{sp?.spIndex ?? "—"}</b> / {SP_PER_SUB_SLOT} · challenge <code>{sp?.challenge ?? "…"}</code>
          </span>
        </div>
        <div className="sp-wheel">
          {Array.from({ length: SP_PER_SUB_SLOT }).map((_, i) => {
            const cur = sp?.spIndex ?? -1;
            const cls = i === cur ? "sp-tick now" : i < cur ? "sp-tick lit" : "sp-tick";
            return <span key={i} className={cls} />;
          })}
        </div>
      </div>

      <div className="mon-panel farm-panel">
        <h3>Your farm <span>{totalPlots} k=8 plots · the proof-of-space function chain</span></h3>
        <div className={`farm-jackpot ${farm.last?.proofs ? "on" : ""}`}>
          {farm.last?.proofs ? `🏆 ${farm.last.proofs} winning proof${farm.last.proofs > 1 ? "s" : ""}!` : "watch the challenge flow through the real function chain…"}
        </div>
        <PosMachine round={farm.last} />
        <div className="farm-stats">
          <span>rounds <b>{farm.rounds}</b></span>
          <span>passed <b>{farm.passed}</b></span>
          <span>wins <b>{farm.proofs}</b></span>
          <span>best <b>{farm.bestFraction != null ? `${farm.bestFraction.toFixed(2)}×` : "—"}</b></span>
        </div>
      </div>

      <div className="mon-panel blk-panel">
        <h3>Blocks won <span>network-wide · bar = how deep into the signage-point window the winner landed</span></h3>
        {blocks.length === 0 && <div className="farm-idle" style={{ padding: "12px 0" }}>waiting for the next block…</div>}
        {blocks.map((b) => {
          const wf = b.windowFraction;
          const known = wf != null;
          const pct = known ? Math.round(wf * 100) : 0;
          const close = known && wf > 0.85;
          return (
            <div className="blk-row" key={`${b.height}-${b.headerHash}`}>
              <span className="blk-h">#{b.height.toLocaleString()}</span>
              <span className="blk-sp">sp {b.spIndex}</span>
              <span className="blk-bar">
                {known && <span className="blk-fill" style={{ width: `${Math.max(2, pct)}%`, background: close ? "var(--win)" : "var(--cc)" }} />}
              </span>
              <span className="blk-pct" style={close ? { color: "var(--win)" } : undefined}>{known ? `${pct}%` : "—"}</span>
              <span className="blk-badges">
                <span className="blk-k">k{b.kSize}</span>
                {b.isTransactionBlock && <span className="blk-tx">tx</span>}
                {b.overflow && <span className="blk-of">of</span>}
              </span>
            </div>
          );
        })}
      </div>

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div className={`toast ${t.kind}`} key={t.id}>
            <span className="toast-icon">{t.icon}</span>
            <div>
              <div className="toast-title">{t.title}</div>
              <div className="toast-sub">{t.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
