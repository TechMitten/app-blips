#!/usr/bin/env bash
# Makes build/icon.png, the Microsoft Store tile images in build/appx/ and the
# Partner Center listing images in build/store-listing/ from build/icon.svg
# (needs rsvg-convert and ImageMagick: apt install librsvg2-bin imagemagick).
# Rerun after changing the icon, then commit the PNGs.
#
# Windows picks the file that matches the screen's scaling (.scale-NNN) or the
# exact pixel size it draws at (.targetsize-NN, used by the taskbar, Start list
# and title bar); with only one size it stretches that one and the icon looks
# blurry or tiny. Every size is rendered straight from the SVG rather than
# scaled down from a PNG, so the small ones stay sharp. The icon is a rounded
# square with transparent corners, so the targetsize images also come as
# "unplated" (no colored square drawn behind them), and the tiles' plate color
# (appx.backgroundColor in electron-builder.yml) matches the icon's own
# background so the plate and the icon read as one shape.
set -euo pipefail
cd "$(dirname "$0")/.."
src=build/icon.svg
out=build/appx
listing=build/store-listing
bg='#0A0A0A'
rm -f "$out"/*.png "$listing"/*.png
mkdir -p "$out" "$listing"

render() { # size file
  rsvg-convert -w "$1" -h "$1" "$src" -o "$2"
}

render 1024 build/icon.png

square() { # name base-size
  for scale in 100 125 150 200 400; do
    render $(( $2 * scale / 100 )) "$out/$1.scale-$scale.png"
  done
}
square StoreLogo 50
square Square150x150Logo 150
square Square44x44Logo 44

for size in 16 24 32 48 256; do
  render "$size" "$out/Square44x44Logo.targetsize-$size.png"
  cp "$out/Square44x44Logo.targetsize-$size.png" "$out/Square44x44Logo.targetsize-${size}_altform-unplated.png"
done

# Wide tile: the icon centered on its own background color.
tmp=$(mktemp --suffix=.png)
trap 'rm -f "$tmp"' EXIT
for scale in 100 125 150 200 400; do
  w=$(( 310 * scale / 100 )); h=$(( 150 * scale / 100 ))
  render "$h" "$tmp"
  convert "$tmp" -background "$bg" -gravity center -extent "${w}x${h}" "$out/Wide310x150Logo.scale-$scale.png"
done

# Partner Center → Store listing → Store logos. Box and poster art are opaque
# (the icon on its own background, so its corners disappear); the 300x300 app
# tile icon keeps the rounded shape.
art() { # width height icon-size file
  render "$3" "$tmp"
  convert "$tmp" -background "$bg" -gravity center -extent "$1x$2" -flatten "$listing/$4"
}
art 1080 1080 760 box-art-1080x1080.png
art 2160 2160 1520 box-art-2160x2160.png
art 720 1080 560 poster-art-720x1080.png
art 1440 2160 1120 poster-art-1440x2160.png
render 300 "$listing/app-tile-icon-300x300.png"
