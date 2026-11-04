#!/bin/sh
# Builds dist/ext-yt-scroll-skip-<version>.zip with only the files the extension needs at runtime,
# ready to upload to the Chrome Web Store (or addons.mozilla.org).
set -eu
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
out="dist/ext-yt-scroll-skip-$version.zip"
mkdir -p dist
rm -f "$out"
zip -q -X "$out" manifest.json defaults.js content.js page-bridge.js background.js options.html options.js icon.png LICENSE
echo "$out"
unzip -l "$out"
