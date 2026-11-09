/* Indirection so views can open dialogs without importing the dialogs
   module (which itself imports from views) — avoids an import cycle. */

import type { Modal } from "../store";

type Opener = (m: Exclude<Modal, null>, from: HTMLElement) => void;
let opener: Opener = () => undefined;

export const registerModalOpener = (fn: Opener): void => { opener = fn; };
export const openModal: Opener = (m, from) => opener(m, from);
