#!/usr/bin/env bash
# Renders options.png: every option rasterised at its real pixel size on each panel colour.
# Needs rsvg-convert and ImageMagick 7. Usage: docs/design/logo/sheet.sh
set -euo pipefail
cd "$(dirname "$0")"
node build.mjs >/dev/null
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

sizes=(16 22 32 64 256)
bgs=("#0A0A0A" "#1f1f1f" "#f5f5f5")
names=(a b c d)
titles=("A  Bitten silhouette (applied)" "B  Waveform filling" "C  Monoline + record dot" "D  Listening mascot")
font=$(fc-match -f '%{file}' 'sans-serif:weight=600')

label() { # text colour size out
  magick -background none -fill "$2" -font "$font" -pointsize "$3" label:"$1" "$4"
}

cell() { # svg size bg out
  local pad=$(( $2 < 64 ? 14 : 20 ))
  rsvg-convert -w "$2" -h "$2" "$1" -o "$tmp/r.png"
  magick -size $(( $2 + pad * 2 ))x$(( 256 + 40 )) "xc:$3" "$tmp/r.png" -gravity center -composite "$4"
}

zoom() { # svg size bg out (pixel zoom so 16 px legibility can be judged)
  rsvg-convert -w "$2" -h "$2" "$1" -o "$tmp/z.png"
  magick "$tmp/z.png" -background "$3" -flatten -filter point -resize 800% "$tmp/z8.png"
  magick -size $(( $2 * 8 + 40 ))x$(( 256 + 40 )) "xc:$3" "$tmp/z8.png" -gravity center -composite "$4"
}

blocks=()
for i in "${!names[@]}"; do
  n=${names[$i]}
  rows=()
  label "${titles[$i]}" "#fafafa" 30 "$tmp/t.png"
  magick -size 1240x70 xc:"#0A0A0A" "$tmp/t.png" -gravity west -geometry +24+0 -composite "$tmp/title-$n.png"
  rows+=("$tmp/title-$n.png")
  for b in "${!bgs[@]}"; do
    bg=${bgs[$b]}
    parts=()
    for s in "${sizes[@]}"; do cell "svg/$n-app.svg" "$s" "$bg" "$tmp/$n-$b-app-$s.png"; parts+=("$tmp/$n-$b-app-$s.png"); done
    magick -size 30x296 "xc:$bg" "$tmp/gap.png"; parts+=("$tmp/gap.png")
    for s in 16 22 32 64; do cell "svg/$n-tray.svg" "$s" "$bg" "$tmp/$n-$b-tray-$s.png"; parts+=("$tmp/$n-$b-tray-$s.png"); done
    zoom "svg/$n-tray.svg" 16 "$bg" "$tmp/$n-$b-zoom.png"; parts+=("$tmp/$n-$b-zoom.png")
    parts+=("$tmp/gap.png")
    for s in 26 64; do cell "svg/$n-mark.svg" "$s" "$bg" "$tmp/$n-$b-mark-$s.png"; parts+=("$tmp/$n-$b-mark-$s.png"); done
    magick "${parts[@]}" +append -background "$bg" -gravity west -extent 1240x296 "$tmp/$n-row-$b.png"
    rows+=("$tmp/$n-row-$b.png")
  done
  magick "${rows[@]}" -append "$tmp/block-$n.png"
  blocks+=("$tmp/block-$n.png")
done

label "Coxinha logo options. App icon at 16, 22, 32, 64, 256 px; tray at 16, 22, 32, 64 px plus 16 px zoomed 8x; in-app mark at 26 and 64 px. Rows: #0A0A0A, #1f1f1f, #f5f5f5." "#a1a1aa" 17 "$tmp/h.png"
magick -size 1240x80 xc:"#0A0A0A" "$tmp/h.png" -gravity west -geometry +24+0 -composite "$tmp/head.png"
magick "$tmp/head.png" "${blocks[@]}" -append -strip options.png
echo "wrote $(pwd)/options.png"
