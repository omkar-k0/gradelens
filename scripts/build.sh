#!/bin/sh
# Builds the Chrome Web Store upload: only the files the extension needs, no tests or docs.
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/gradelens-$VERSION.zip"
mkdir -p dist
rm -f "$OUT"
zip -q -r -X "$OUT" manifest.json _locales src popup icons fonts LICENSE -x "*.DS_Store"
echo "$OUT"
unzip -l "$OUT" | tail -1
