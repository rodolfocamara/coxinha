/// <reference types="vite/client" />

// TS 6 requires explicit ambient declarations for side-effect CSS
// imports (e.g. `import './index.css'`). Vite handles the actual
// bundling; TS just needs to know these modules exist.
declare module '*.css';

interface ImportMetaEnv {
  readonly VITE_OUTLOOK_CLIENT_ID?: string;
  readonly VITE_OUTLOOK_TENANT?: string;
}
