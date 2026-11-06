#!/usr/bin/env bash
# Patches the vendored libgit2-sys sources in the cargo registry.
#
# Why: libgit2-sys selects SecureTransport as its TLS backend on Apple
# targets. SecureTransport cannot negotiate TLS 1.3 and has been deprecated
# since iOS 13, so HTTPS clones against TLS 1.3-only servers fail with
# errSSLPeerProtocolVersion (-9836). The patch in rust/patches/ switches Apple
# targets to OpenSSL and validates the server chain against the system trust
# store with Security.framework.
#
# The patch must be in place before libgit2-sys is compiled. Cargo runs a
# dependency's build script before the dependent crate's build script, so
# patching from rust/build.rs always lands one build too late.
#
# Usage:
#   scripts/patch-libgit2-sys.sh           apply the patch when it differs
#   scripts/patch-libgit2-sys.sh --check   exit 0 only when every tree is patched
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUST_DIR="$SCRIPT_DIR/../rust"
PATCH_DIR="$RUST_DIR/patches"
CARGO_HOME_DIR="${CARGO_HOME:-$HOME/.cargo}"

CHECK_ONLY=0
if [ "${1:-}" = "--check" ]; then
  CHECK_ONLY=1
fi

patches=()
while IFS= read -r patch_file; do
  patches+=("$patch_file")
done < <(find "$PATCH_DIR" -maxdepth 1 -name '*.patch' | sort)

if [ "${#patches[@]}" -eq 0 ]; then
  echo "no patch files found in $PATCH_DIR" >&2
  exit 1
fi

patched_files=()
while IFS= read -r patched_file; do
  patched_files+=("$patched_file")
done < <(for patch_file in "${patches[@]}"; do
  sed -n 's|^--- a/||p' "$patch_file"
done | sort -u)

if [ "${#patched_files[@]}" -eq 0 ]; then
  echo "the patches in $PATCH_DIR touch no files" >&2
  exit 1
fi

crate_dirs=()
while IFS= read -r crate_dir; do
  crate_dirs+=("$crate_dir")
done < <(find "$CARGO_HOME_DIR/registry/src" -maxdepth 2 -type d -name 'libgit2-sys-*' 2>/dev/null | sort)

if [ "${#crate_dirs[@]}" -eq 0 ]; then
  echo "libgit2-sys sources not found under $CARGO_HOME_DIR/registry/src" >&2
  echo "run 'cargo fetch' in $RUST_DIR first" >&2
  exit 1
fi

status=0

for crate_dir in "${crate_dirs[@]}"; do
  package="$(basename "$crate_dir")"
  version="${package#libgit2-sys-}"
  tarball="$(find "$CARGO_HOME_DIR/registry/cache" -maxdepth 2 -name "libgit2-sys-$version.crate" 2>/dev/null | head -1)"

  if [ -z "$tarball" ]; then
    echo "the crate archive for libgit2-sys $version is not cached" >&2
    echo "run 'cargo fetch' in $RUST_DIR first" >&2
    exit 1
  fi

  work_dir="$(mktemp -d)"
  trap 'rm -rf "$work_dir"' EXIT

  tar -xzf "$tarball" -C "$work_dir"
  pristine="$work_dir/$package"

  for patch_file in "${patches[@]}"; do
    if ! output="$(patch --batch -p1 -d "$pristine" -i "$patch_file" 2>&1)"; then
      printf '%s\n' "$output" >&2
      echo "failed to apply $(basename "$patch_file") to libgit2-sys $version" >&2
      exit 1
    fi
  done

  for patched_file in "${patched_files[@]}"; do
    source_file="$pristine/$patched_file"
    target_file="$crate_dir/$patched_file"

    if [ ! -f "$source_file" ]; then
      echo "patched file $patched_file is missing from libgit2-sys $version" >&2
      exit 1
    fi

    if [ -f "$target_file" ] && cmp -s "$source_file" "$target_file"; then
      continue
    fi

    if [ "$CHECK_ONLY" -eq 1 ]; then
      echo "libgit2-sys $version is not patched: $patched_file differs" >&2
      status=1
      continue
    fi

    echo "patching $patched_file in libgit2-sys $version"
    cp "$source_file" "$target_file"
  done

  rm -rf "$work_dir"
  trap - EXIT
done

exit $status
