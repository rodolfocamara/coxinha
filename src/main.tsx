import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './lib/i18n';
import { applyTheme, getThemePreference, resolveThemePreference } from './lib/theme';
import './index.css';
import './styles/motion.css';

// Paint the right theme before React mounts — otherwise the first
// frame flashes light-on-dark (or the other way). The persistent
// `prefers-color-scheme` listener gets installed inside `App` so
// React owns its own cleanup.
applyTheme(resolveThemePreference(getThemePreference()));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
