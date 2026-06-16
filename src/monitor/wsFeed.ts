/**
 * Live feed: a WebSocket to the Python companion sidecar running next to a real
 * chia full node + farmer. The sidecar emits the exact MonitorEvent schema
 * (one JSON object per message), so the UI is identical to the simulated path.
 */
import type { FeedHandlers, MonitorEvent, MonitorFeed } from "./events.ts";

export class WsFeed implements MonitorFeed {
  private ws: WebSocket | null = null;
  private stopped = false;

  constructor(private url: string) {}

  start(h: FeedHandlers): void {
    this.stopped = false;
    h.onStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      h.onStatus("error", String(e));
      return;
    }
    this.ws = ws;
    ws.onopen = () => h.onStatus("live");
    ws.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as MonitorEvent;
        if (e && typeof e.type === "string") h.onEvent(e);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onerror = () => h.onStatus("error", "connection error");
    ws.onclose = () => {
      if (!this.stopped) h.onStatus("closed");
    };
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
  }
}
