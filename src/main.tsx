import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './lib/i18n';
import { applyAppearance } from './lib/appearance';
import { applyTheme, getThemePreference, resolveThemePreference } from './lib/theme';
import './index.css';
import './styles/motion.css';

// Paint the right theme before React mounts — otherwise the first
// frame flashes light-on-dark (or the other way). The persistent
// `prefers-color-scheme` listener gets installed inside `App` so
// React owns its own cleanup.
applyTheme(resolveThemePreference(getThemePreference()));
// Regenerated from the settings, so a new build never paints an old stylesheet twice.
applyAppearance();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
