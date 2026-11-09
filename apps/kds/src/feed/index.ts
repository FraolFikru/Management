/* Picks the order feed: live when VITE_KDS_WS_URL is set, otherwise the demo feed. */

import type { OrderFeed } from "../types";
import { DemoOrderFeed } from "./demo";
import { LiveOrderFeed } from "./live";
import { currentUser } from "../auth";

/** True when this build points at a backend (VITE_KDS_WS_URL set). */
export const liveConfigured = (): boolean => Boolean((import.meta.env ?? {}).VITE_KDS_WS_URL?.trim());

export function createFeed(): OrderFeed {
  const env = import.meta.env ?? {};
  const ws = env.VITE_KDS_WS_URL?.trim();
  if (ws) return new LiveOrderFeed(ws, env.VITE_KDS_API_URL?.trim() || new URL(ws.replace(/^ws/, "http")).origin, branchId());
  return new DemoOrderFeed();
}

/** The signed-in user's branch, else VITE_BRANCH_ID, else Bole. */
export const branchId = (): string => currentUser()?.branchId || (import.meta.env ?? {}).VITE_BRANCH_ID || "BR-BOLE";
