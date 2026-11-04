# Spec 0062: Comfortable board and system theme

Status: locally validated, 2026-10-24. Native desktop and user acceptance pending.

## Scope

Replace near-black surfaces with a comfortable warm graphite dark palette and a soft off-white light palette. The default theme follows the OS; explicit light/dark preferences remain authoritative. Web content, native form controls, editor and React Flow use one resolved theme. Use the Tauri native theme on Windows/macOS with browser media-query fallback and live change cleanup. On Linux use the live WebKit media preference: installed tao 0.34.8 infers native theme from GTK theme-name suffixes and can contradict the desktop color preference. Do not let that unreliable native result override Linux media.

The board gives the canvas priority: compact action toolbar, clear save state, contextual inspector that can be hidden, collapsed advanced geometry controls, soft grid and distinguishable cards/areas. Keep existing geometry, note links, dependency editing, keyboard paths, persistence and recovery intact. New UI strings require English and pt-BR translations. No automatic capture, network, data migration or user preference reset.

## References inspected in Mobbin

- Craft: compact floating controls and spacious canvas. https://mobbin.com/screens/66b19439-76a3-4493-8e8a-38d95b154645
- Miro: neutral canvas, distinct cards and contextual detail editing. https://mobbin.com/screens/a92c6f99-0daf-4c40-ba72-a4ea3a6bb03c
- Fibery: quiet navigation and canvas-first hierarchy. https://mobbin.com/screens/99741643-6f33-4727-8a4a-594c33d3b2ba

Reuse patterns only; no product assets or branding. Retain Coxinha typography, tokens and restrained warm accent.

## Validation

- Theme defaults to auto, reacts to OS changes, preserves explicit overrides and cleans up listeners; delayed native results cannot overwrite a newer preference or theme event.
- Native form controls and React Flow minimap/controls have appropriate surfaces and legible text in both themes.
- Real browser screenshots in light/dark at 1440 and 1200px, plus narrower layout checks. Inspect card selection, inspector toggle, empty board, editing and persistence/navigation regressions.
- Typecheck, frontend tests and production build; build/install an updated local executable without replacing prior artifacts or user data.
- Independent review for theme lifecycle and board regressions. Native OS acceptance remains distinct from browser emulation.
