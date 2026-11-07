#!/bin/sh
# Installs gitnotes-bridge from the GitNotēs repository (no npm publish needed).
#
#   curl -fsSL https://raw.githubusercontent.com/skepjandi/gitnotes/main/bridge/install.sh | sh
#
# What it does: downloads the repo tarball, builds bridge/ with npm, and puts a
# `gitnotes-bridge` launcher in ~/.local/bin. Nothing outside the two paths below is touched.
#
# Environment overrides:
#   GITNOTES_BRIDGE_REF          git ref to install (default: main)
#   GITNOTES_BRIDGE_REPO         owner/name on GitHub (default: skepjandi/gitnotes)
#   GITNOTES_BRIDGE_HOME         install dir (default: ~/.gitnotes-bridge/app)
#   GITNOTES_BRIDGE_BIN_DIR      launcher dir (default: ~/.local/bin)
#   GITNOTES_BRIDGE_TARBALL_URL  full tarball URL; replaces the GitHub download (testing, mirrors)
#
# Uninstall: rm -rf ~/.gitnotes-bridge/app ~/.local/bin/gitnotes-bridge
#            (~/.gitnotes-bridge/config.json holds your token; delete it to unpair every phone.)
set -eu

REPO="${GITNOTES_BRIDGE_REPO:-skepjandi/gitnotes}"
REF="${GITNOTES_BRIDGE_REF:-main}"
INSTALL_DIR="${GITNOTES_BRIDGE_HOME:-$HOME/.gitnotes-bridge/app}"
BIN_DIR="${GITNOTES_BRIDGE_BIN_DIR:-$HOME/.local/bin}"
TARBALL_URL="${GITNOTES_BRIDGE_TARBALL_URL:-https://codeload.github.com/$REPO/tar.gz/$REF}"
MIN_NODE_MAJOR=20

say() { printf '%s\n' "$*"; }
fail() { printf 'gitnotes-bridge install: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "'$1' is required but was not found on PATH. $2"; }

need curl "Install curl and re-run."
need tar "Install tar and re-run."
need node "Install Node.js $MIN_NODE_MAJOR or newer from https://nodejs.org and re-run."
need npm "npm ships with Node.js; reinstall Node.js from https://nodejs.org."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge "$MIN_NODE_MAJOR" ] 2>/dev/null ||
  fail "Node.js $MIN_NODE_MAJOR or newer is required (found $(node -v))."

WORK_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t gitnotes-bridge)"
trap 'rm -rf "$WORK_DIR"' EXIT INT TERM

say "Downloading gitnotes-bridge ($REPO @ $REF)..."
curl -fsSL "$TARBALL_URL" -o "$WORK_DIR/source.tar.gz" ||
  fail "download failed from $TARBALL_URL (is the ref '$REF' pushed?)"
tar -xzf "$WORK_DIR/source.tar.gz" -C "$WORK_DIR" ||
  fail "could not unpack the download."

SOURCE_DIR=""
for candidate in "$WORK_DIR"/*/bridge; do
  [ -f "$candidate/package.json" ] && SOURCE_DIR="$candidate" && break
done
[ -n "$SOURCE_DIR" ] || fail "the download does not contain a bridge/ directory (ref '$REF' predates the bridge?)."

say "Installing to $INSTALL_DIR ..."
mkdir -p "$(dirname "$INSTALL_DIR")"
STAGING_DIR="$INSTALL_DIR.new"
rm -rf "$STAGING_DIR"
mv "$SOURCE_DIR" "$STAGING_DIR"

(
  cd "$STAGING_DIR"
  say "Building (npm install)..."
  npm install --no-audit --no-fund --loglevel=error >/dev/null
  [ -f dist/cli.js ] || { echo "build did not produce dist/cli.js" >&2; exit 1; }
  npm prune --omit=dev --no-audit --no-fund --loglevel=error >/dev/null
) || { rm -rf "$STAGING_DIR"; fail "build failed. Re-run without redirects: cd '$STAGING_DIR' && npm install"; }

rm -rf "$INSTALL_DIR"
mv "$STAGING_DIR" "$INSTALL_DIR"

mkdir -p "$BIN_DIR"
LAUNCHER="$BIN_DIR/gitnotes-bridge"
cat >"$LAUNCHER" <<EOF
#!/bin/sh
exec node "$INSTALL_DIR/dist/cli.js" "\$@"
EOF
chmod +x "$LAUNCHER"

say ""
say "Installed: $LAUNCHER"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "Note: $BIN_DIR is not on your PATH. Add it, e.g.:  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
say ""
say "Next:  gitnotes-bridge --root ~/code"
say "It prints a pairing link; open it on your phone (or paste it in GitNotēs → Settings → Coding agents)."
say "Phone access from outside your LAN: see https://github.com/$REPO/tree/$REF/bridge#readme"
