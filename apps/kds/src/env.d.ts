/* Build-time settings (Vite reads them from .env files). */
interface ImportMetaEnv {
  readonly VITE_KDS_WS_URL?: string;
  readonly VITE_KDS_API_URL?: string;
  readonly VITE_BRANCH_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/* Vite bundles imported stylesheets. */
declare module "*.css";
