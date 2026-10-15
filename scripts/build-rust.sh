#!/usr/bin/env bash
# Builds the gitnotes_git2 Rust crate for the mobile targets and copies the
# artifacts into the GitEngine Expo module. Also regenerates the UniFFI
# Swift/Kotlin bindings from the host-built cdylib.
#
# Usage:
#   scripts/build-rust.sh                 # simulator lib (default local dev)
#   scripts/build-rust.sh --ios           # simulator + device staticlibs
#   scripts/build-rust.sh --android       # cargo-ndk shared libs (all ABIs)
#   scripts/build-rust.sh --bindings      # regenerate Swift/Kotlin bindings
#   scripts/build-rust.sh --all           # everything above
#   scripts/build-rust.sh --xcode         # Xcode build-phase mode: build only
#                                         # the target selected by the current
#                                         # platform/arch/configuration
#
# Environment:
#   RUST_PROFILE=debug|release (default: debug)

set -euo pipefail

# Xcode build phases run with a minimal PATH; make rustup/cargo visible.
export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v cargo >/dev/null 2>&1 && [ -f "$HOME/.cargo/env" ]; then
  . "$HOME/.cargo/env"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
RUST_DIR="$ROOT_DIR/rust"
MODULE_DIR="$ROOT_DIR/modules/GitEngine"
IOS_LIB_DIR="$MODULE_DIR/ios-local/rust"
JNI_DIR="$MODULE_DIR/android/src/main/jniLibs"
SWIFT_GEN_DIR="$MODULE_DIR/ios-local/generated"
KOTLIN_GEN_DIR="$MODULE_DIR/android/src/main/java"

PROFILE="${RUST_PROFILE:-debug}"

log() { echo "[build-rust] $*"; }

cargo_build() {
  local target="$1"
  log "cargo build --target $target ($PROFILE)"
  if [ "$PROFILE" = "release" ]; then
    (cd "$RUST_DIR" && cargo build --target "$target" --release)
  else
    (cd "$RUST_DIR" && cargo build --target "$target")
  fi
}

copy_ios_lib() {
  local target="$1"
  mkdir -p "$IOS_LIB_DIR"
  cp "$RUST_DIR/target/$target/$PROFILE/libgitnotes_git2.a" "$IOS_LIB_DIR/libgitnotes_git2.a"
  log "copied $target staticlib -> $IOS_LIB_DIR/libgitnotes_git2.a"
}

build_ios_sim() {
  if [ "${1:-}" = "arm64" ] || [ "$(uname -m)" = "arm64" ]; then
    cargo_build "aarch64-apple-ios-sim"
    copy_ios_lib "aarch64-apple-ios-sim"
  else
    cargo_build "x86_64-apple-ios"
    copy_ios_lib "x86_64-apple-ios"
  fi
}

build_ios() {
  cargo_build "aarch64-apple-ios-sim"
  copy_ios_lib "aarch64-apple-ios-sim"
  cargo_build "aarch64-apple-ios"
  log "device staticlib at $RUST_DIR/target/aarch64-apple-ios/$PROFILE/libgitnotes_git2.a"
}

build_android() {
  if ! command -v cargo-ndk >/dev/null 2>&1; then
    log "cargo-ndk not found; installing"
    cargo install cargo-ndk
  fi
  local targets=(
    "aarch64-linux-android:arm64-v8a"
    "armv7-linux-androideabi:armeabi-v7a"
    "x86_64-linux-android:x86_64"
    "i686-linux-android:x86"
  )
  for entry in "${targets[@]}"; do
    local target="${entry%%:*}"
    local abi="${entry##*:}"
    log "cargo ndk build --target $target ($PROFILE)"
    if [ "$PROFILE" = "release" ]; then
      (cd "$RUST_DIR" && cargo ndk --target "$target" --platform 24 build --release)
    else
      (cd "$RUST_DIR" && cargo ndk --target "$target" --platform 24 build)
    fi
    mkdir -p "$JNI_DIR/$abi"
    cp "$RUST_DIR/target/$target/$PROFILE/libgitnotes_git2.so" "$JNI_DIR/$abi/"
    log "copied $target -> $JNI_DIR/$abi/libgitnotes_git2.so"
  done
}

generate_bindings() {
  local host
  host="$(rustc -vV | grep '^host:' | cut -d' ' -f2)"
  log "building host cdylib for bindgen ($host)"
  if [ "$PROFILE" = "release" ]; then
    (cd "$RUST_DIR" && cargo build --release)
  else
    (cd "$RUST_DIR" && cargo build)
  fi

  local dylib="$RUST_DIR/target/$PROFILE/libgitnotes_git2.dylib"

  local tmp
  tmp="$(mktemp -d)"
  log "generating Swift bindings"
  (cd "$RUST_DIR" && cargo run --features uniffi-cli --bin uniffi-bindgen -- generate \
    --library "$dylib" --language swift --out-dir "$tmp/swift")
  mkdir -p "$SWIFT_GEN_DIR/GitNotesGit2FFI"
  cp "$tmp/swift/GitNotesGit2.swift" "$SWIFT_GEN_DIR/GitNotesGit2.swift"
  cp "$tmp/swift/GitNotesGit2FFI.h" "$SWIFT_GEN_DIR/GitNotesGit2FFI/GitNotesGit2FFI.h"
  cp "$tmp/swift/GitNotesGit2FFI.modulemap" "$SWIFT_GEN_DIR/GitNotesGit2FFI/module.modulemap"

  log "generating Kotlin bindings"
  (cd "$RUST_DIR" && cargo run --features uniffi-cli --bin uniffi-bindgen -- generate \
    --library "$dylib" --language kotlin --out-dir "$tmp/kotlin" --no-format)
  mkdir -p "$KOTLIN_GEN_DIR/uniffi/gitnotes_git2"
  cp "$tmp/kotlin/uniffi/gitnotes_git2/gitnotes_git2.kt" \
    "$KOTLIN_GEN_DIR/uniffi/gitnotes_git2/gitnotes_git2.kt"
  # UniFFI <= 0.32 emits Kotlin that does not compile when an error variant
  # has a field named `message` (mozilla/uniffi-rs#2938); BridgeError does.
  # Rename the colliding field to `errorMessage` inside BridgeException.
  python3 "$SCRIPT_DIR/fix-kotlin-uniffi-message.py" \
    "$KOTLIN_GEN_DIR/uniffi/gitnotes_git2/gitnotes_git2.kt"
  # UniFFI <= 0.32 returns u16 values sign-extended on Android ART, causing
  # checksum comparisons to fail for values >= 0x8000 (mozilla/uniffi-rs#2939).
  # Mask each comparison with & 0xFFFF to fix.
  python3 "$SCRIPT_DIR/fix-kotlin-uniffi-checksum.py" \
    "$KOTLIN_GEN_DIR/uniffi/gitnotes_git2/gitnotes_git2.kt"

  rm -rf "$tmp"
  log "bindings regenerated into $MODULE_DIR"
}

build_for_xcode() {
  local platform="${PLATFORM_NAME:-iphonesimulator}"
  local archs="${ARCHS:-arm64}"
  local arch
  arch="$(echo "$archs" | awk '{print $1}')"
  local config="${CONFIGURATION:-Debug}"
  if [ "$config" = "Release" ]; then
    PROFILE="release"
  fi

  local target
  case "$platform:$arch" in
    iphonesimulator:arm64) target="aarch64-apple-ios-sim" ;;
    iphonesimulator:x86_64) target="x86_64-apple-ios" ;;
    iphoneos:arm64) target="aarch64-apple-ios" ;;
    *)
      log "unknown PLATFORM_NAME/ARCHS: $platform/$arch"
      exit 1
      ;;
  esac

  cargo_build "$target"
  copy_ios_lib "$target"
}

DO_IOS_SIM=0
DO_IOS=0
DO_ANDROID=0
DO_BINDINGS=0
DO_XCODE=0

if [ "$#" -eq 0 ]; then
  DO_IOS_SIM=1
fi
for arg in "$@"; do
  case "$arg" in
    --ios) DO_IOS=1 ;;
    --ios-sim) DO_IOS_SIM=1 ;;
    --android) DO_ANDROID=1 ;;
    --bindings) DO_BINDINGS=1 ;;
    --xcode) DO_XCODE=1 ;;
    --all) DO_IOS=1; DO_ANDROID=1; DO_BINDINGS=1 ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if [ "$DO_XCODE" -eq 1 ]; then build_for_xcode; fi
if [ "$DO_BINDINGS" -eq 1 ]; then generate_bindings; fi
if [ "$DO_IOS_SIM" -eq 1 ]; then build_ios_sim; fi
if [ "$DO_IOS" -eq 1 ]; then build_ios; fi
if [ "$DO_ANDROID" -eq 1 ]; then build_android; fi
