/* Picks the order feed: live when VITE_KDS_WS_URL is set, otherwise the demo feed. */

import type { OrderFeed } from "../types";
import { DemoOrderFeed } from "./demo";
import { LiveOrderFeed } from "./live";

export function createFeed(): OrderFeed {
  const env = import.meta.env ?? {};
  const ws = env.VITE_KDS_WS_URL?.trim();
  if (ws) return new LiveOrderFeed(ws, env.VITE_KDS_API_URL?.trim() || new URL(ws.replace(/^ws/, "http")).origin, env.VITE_BRANCH_ID || "BR-BOLE-01");
  return new DemoOrderFeed();
}

export const branchId = (): string => (import.meta.env ?? {}).VITE_BRANCH_ID || "BR-BOLE-01";
