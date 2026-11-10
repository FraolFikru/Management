/// <reference types="vite/client" />

/* Build-time settings (Vite reads them from .env files). */
interface ImportMetaEnv {
  /** Eirsha Ops backend, e.g. https://eirsha-api.onrender.com */
  readonly VITE_API_URL?: string;
  /** Live-update address, if it is not the backend's own /ws */
  readonly VITE_WS_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module "*.css";
