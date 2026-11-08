# Icons

Generated from the Coxinha logo, option A in `docs/design/logo/` (sources in
`docs/design/logo/svg/`, regenerate with `node docs/design/logo/build.mjs`).

- `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, `icon.ico`,
  `icon.icns`: app and installer icons, from `a-app.svg`.
- `tray.png`: the tray glyph, from `a-tray.svg`. It is drawn for 16-22 px and
  outlined so it reads on dark and light panels; do not replace it with the
  app icon.

```bash
rsvg-convert -w 1024 -h 1024 docs/design/logo/svg/a-app.svg -o /tmp/coxinha.png
pnpm tauri icon /tmp/coxinha.png -o /tmp/coxinha-icons   # copy the six files above
rsvg-convert -w 32 -h 32 docs/design/logo/svg/a-tray.svg -o src-tauri/icons/tray.png
```
