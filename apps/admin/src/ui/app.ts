/* Indirection so views can ask for a re-render or navigation without
   importing main.ts (avoids circular imports). main.ts wires these up. */

import type { ViewId } from "../types";

export type ActionHandler = (el: HTMLElement, ev: Event) => void;
export type ActionMap = Record<string, ActionHandler>;

let renderFn: (focusSelector?: string) => void = () => undefined;
let navigateFn: (view: ViewId, focusSelector?: string) => void = () => undefined;

export function wireApp(render: typeof renderFn, navigate: typeof navigateFn): void {
  renderFn = render;
  navigateFn = navigate;
}

export const rerender = (focusSelector?: string): void => renderFn(focusSelector);
export const navigate = (view: ViewId, focusSelector?: string): void => navigateFn(view, focusSelector);
