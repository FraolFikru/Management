declare module '*.css';

/* Build-time settings (Vite reads them from .env files). */
interface ImportMetaEnv {
  /** Eirsha Ops backend, e.g. https://eirsha-api.onrender.com — empty = demo mode */
  readonly VITE_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
