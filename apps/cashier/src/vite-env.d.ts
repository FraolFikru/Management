declare module '*.css';

/* Build-time settings (Vite reads them from .env files). */
interface ImportMetaEnv {
  /** SEER backend, e.g. https://seer-api.onrender.com — empty = demo mode */
  readonly VITE_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
