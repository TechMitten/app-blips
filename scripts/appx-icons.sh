#!/usr/bin/env bash
# Makes the Microsoft Store tile images in build/appx/ from build/icon.png
# (needs ImageMagick). Rerun after changing the icon, then commit the PNGs.
#
# Windows picks the file that matches the screen's scaling (.scale-NNN) or the
# exact pixel size it draws at (.targetsize-NN, used by the taskbar, Start list
# and title bar); with only one size it stretches that one and the icon looks
# blurry or tiny. The icon is full-bleed with its own dark background, so the
# targetsize images also come as "unplated" (no colored square drawn behind
# them), and the tiles' plate color (appx.backgroundColor in
# electron-builder.yml) matches the icon's edge instead of the user's accent.
set -euo pipefail
cd "$(dirname "$0")/.."
src=build/icon.png
out=build/appx
bg='#262630'
rm -f "$out"/*.png
mkdir -p "$out"

square() { # name base-size
  for scale in 100 125 150 200 400; do
    local px=$(( $2 * scale / 100 ))
    convert "$src" -filter Lanczos -resize "${px}x${px}" "$out/$1.scale-$scale.png"
  done
}
square StoreLogo 50
square Square150x150Logo 150
square Square44x44Logo 44

for size in 16 24 32 48 256; do
  convert "$src" -filter Lanczos -resize "${size}x${size}" "$out/Square44x44Logo.targetsize-$size.png"
  cp "$out/Square44x44Logo.targetsize-$size.png" "$out/Square44x44Logo.targetsize-${size}_altform-unplated.png"
done

# Wide tile: the icon centered on its own background color.
for scale in 100 125 150 200 400; do
  w=$(( 310 * scale / 100 )); h=$(( 150 * scale / 100 ))
  convert "$src" -filter Lanczos -resize "${h}x${h}" -background "$bg" -gravity center -extent "${w}x${h}" "$out/Wide310x150Logo.scale-$scale.png"
done
