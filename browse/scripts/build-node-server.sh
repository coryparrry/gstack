#!/usr/bin/env bash
# Build a Node.js-compatible server bundle for Windows.
#
# On Windows, Bun can't launch or connect to Playwright's Chromium
# (oven-sh/bun#4253, #9911). This script produces a server bundle
# that runs under Node.js with Bun API polyfills.

set -e

if ! command -v bun >/dev/null 2>&1; then
  BUN_WIN_PATH="$(where.exe bun 2>/dev/null | tr -d '\r' | head -n 1)"
  if [ -n "$BUN_WIN_PATH" ]; then
    if command -v cygpath >/dev/null 2>&1; then
      BUN_BIN="$(cygpath -u "$BUN_WIN_PATH")"
    elif command -v wslpath >/dev/null 2>&1; then
      BUN_BIN="$(wslpath -u "$BUN_WIN_PATH")"
    else
      BUN_BIN=""
    fi

    if [ -n "$BUN_BIN" ]; then
      BUN_SHIM_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t gstack-bun)"
      ln -sf "$BUN_BIN" "$BUN_SHIM_DIR/bun"
      PATH="$BUN_SHIM_DIR:$PATH"
      export PATH
    fi
  fi
fi

GSTACK_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_DIR="$GSTACK_DIR/browse/src"
DIST_DIR="$GSTACK_DIR/browse/dist"
SERVER_TS_BUN_PATH="$SRC_DIR/server.ts"
SERVER_OUT_BUN_PATH="$DIST_DIR/server-node.mjs"

if [ -n "${BUN_BIN:-}" ] && command -v wslpath >/dev/null 2>&1; then
  case "$BUN_BIN" in
    *.exe)
      SERVER_TS_BUN_PATH="$(wslpath -w "$SERVER_TS_BUN_PATH")"
      SERVER_OUT_BUN_PATH="$(wslpath -w "$SERVER_OUT_BUN_PATH")"
      ;;
  esac
fi

echo "Building Node-compatible server bundle..."

# Step 1: Transpile server.ts to a single .mjs bundle (externalize runtime deps)
#
# Externalize packages with native addons, dynamic imports, or runtime resolution.
# If you add a new dependency that uses `await import()` or has a .node addon,
# add it here. Otherwise `bun build --outfile` will fail with
# "cannot write multiple output files without an output directory".
bun build "$SERVER_TS_BUN_PATH" \
  --target=node \
  --outfile "$SERVER_OUT_BUN_PATH" \
  --external playwright \
  --external playwright-core \
  --external diff \
  --external "bun:sqlite" \
  --external "@ngrok/ngrok"

# Step 2: Post-process
# Replace import.meta.dir with a resolvable reference
perl -pi -e 's/import\.meta\.dir/__browseNodeSrcDir/g' "$DIST_DIR/server-node.mjs"
# Stub out bun:sqlite (macOS-only cookie import, not needed on Windows)
perl -pi -e 's|import { Database } from "bun:sqlite";|const Database = null; // bun:sqlite stubbed on Node|g' "$DIST_DIR/server-node.mjs"

# Step 3: Create the final file with polyfill header injected after the first line
{
  head -1 "$DIST_DIR/server-node.mjs"
  echo '// -- Windows Node.js compatibility (auto-generated) --'
  echo 'import { fileURLToPath as _ftp } from "node:url";'
  echo 'import { dirname as _dn } from "node:path";'
  echo 'const __browseNodeSrcDir = _dn(_dn(_ftp(import.meta.url))) + "/src";'
  echo '{ const _r = createRequire(import.meta.url); _r("./bun-polyfill.cjs"); }'
  echo '// -- end compatibility --'
  tail -n +2 "$DIST_DIR/server-node.mjs"
} > "$DIST_DIR/server-node.tmp.mjs"

mv "$DIST_DIR/server-node.tmp.mjs" "$DIST_DIR/server-node.mjs"

# Step 4: Copy polyfill to dist/
cp "$SRC_DIR/bun-polyfill.cjs" "$DIST_DIR/bun-polyfill.cjs"

echo "Node server bundle ready: $DIST_DIR/server-node.mjs"
