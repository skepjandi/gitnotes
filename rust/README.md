# gitnotes_git2 — Rust git engine

Native git engine for GitNotes on top of `git2` (libgit2, vendored). Exposed
to the app through UniFFI-generated Swift/Kotlin bindings wrapped by the
`modules/GitEngine` Expo module.

## License

The Git engine is licensed under MPL-2.0. The license applies to this crate
and its generated platform bindings.

## Layout

- `src/engine/` — pure git2 logic (ops, credentials, lock, timeouts, keys).
- `src/api/` — the UniFFI-exported facade (`#[uniffi::export]`) + wire types.
- `uniffi.toml` — bindings configuration (Swift module `GitNotesGit2`,
  C FFI module `GitNotesGit2FFI`, Kotlin package `uniffi.gitnotes_git2`).
- `uniffi-bindgen.rs` — bindings generator entry point.

## Cross-compile targets

`rust-toolchain.toml` declares the full target list (stable channel):
`aarch64-apple-darwin` (host), `aarch64-apple-ios`, `x86_64-apple-ios`,
`aarch64-apple-ios-sim`, `aarch64-linux-android`, `armv7-linux-androideabi`,
`x86_64-linux-android`, `i686-linux-android`. rustup installs them lazily on
first use.

## Building + generating bindings

Everything is driven by `scripts/build-rust.sh` (repo root):

```sh
scripts/build-rust.sh                 # simulator staticlib (local dev default)
scripts/build-rust.sh --ios           # simulator + device staticlibs
scripts/build-rust.sh --android       # cargo-ndk .so for all Android ABIs
scripts/build-rust.sh --bindings      # regenerate Swift + Kotlin bindings
scripts/build-rust.sh --all           # bindings + iOS + Android
```

Artifacts land in the GitEngine module:

- iOS staticlib: `modules/GitEngine/ios-local/rust/libgitnotes_git2.a`
- Android libs: `modules/GitEngine/android/src/main/jniLibs/<abi>/libgitnotes_git2.so`
- Swift bindings: `modules/GitEngine/ios-local/generated/`
- Kotlin bindings: `modules/GitEngine/android/src/main/java/uniffi/gitnotes_git2/`

Bindings are generated from a host-built `cdylib` (UniFFI library mode reads
the metadata embedded in `target/<host>/{debug}/libgitnotes_git2.dylib`):

```sh
cargo run --features uniffi-cli --bin uniffi-bindgen -- generate \
  --library target/debug/libgitnotes_git2.dylib \
  --language swift --out-dir <out>
```

The generated Swift/Kotlin sources are COMMITTED; re-run `--bindings` whenever
the `api/` facade changes. Bindgen always comes from the same `uniffi` crate
version as the scaffolding (the `uniffi-cli` feature), so versions cannot skew.
The bin is gated behind `required-features` so plain `cargo build` /
`cargo clippy --all-targets` skip it.

## Local iOS development

`npx expo run:ios` is self-contained: the `withGitEngineRust` config plugin
(modules/GitEngine/plugin) adds a "Build Rust (gitnotes_git2)" script phase to
the app target that runs `scripts/build-rust.sh --xcode`. The script detects
`PLATFORM_NAME`/`ARCHS`/`CONFIGURATION`, builds the matching target
(`aarch64-apple-ios-sim` for Apple-silicon simulator dev), and copies the
staticlib to the pod's vendored path before linking.

Pod wiring (modules/GitEngine/ios-local/GitEngine.podspec):
`s.vendored_libraries = 'rust/libgitnotes_git2.a'`; the generated FFI module
(`generated/GitNotesGit2FFI/module.modulemap`) is exposed to the pod's Swift via
`SWIFT_INCLUDE_PATHS = $(PODS_TARGET_SRCROOT)/generated`, and a Podfile
`post_install` hook (injected by `withGitEngineRust.js`) appends the same
absolute path to the aggregate target's `SWIFT_INCLUDE_PATHS` so
`ExpoModulesProvider.swift` can resolve GitEngine's transitive FFI dependency.
System deps are re-declared (`-lz -liconv -lc++`, Security + CoreFoundation
frameworks) because cargo link directives do not propagate through staticlibs.

## EAS cloud builds (authored, not exercised)

`package.json` npm hooks:

- `eas-build-pre-install` → `scripts/eas/pre-install.sh` (rustup targets +
  cargo-ndk).
- `eas-build-post-install` → `scripts/eas/post-install.sh`
  (release `build-rust.sh --bindings --ios` / `--android`).

EAS cloud builds are NOT exercised by this plan (no credentials); the local
build path is the verified one. The unexercised EAS-cloud path is tracked as
an accepted residual risk (plan item F4).

## Checks

```sh
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```
