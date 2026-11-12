/// <reference types="vite/client" />

/* Build-time settings (Vite reads them from .env files). */
interface ImportMetaEnv {
  /** SEER backend, e.g. https://seer-api.onrender.com — empty = built-in demo */
  readonly VITE_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module "*.css";
