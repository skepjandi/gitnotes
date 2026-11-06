use std::path::Path;
use std::process::Command;

/// The vendored libgit2 sources in the cargo registry must be patched before
/// libgit2-sys compiles: Apple targets need OpenSSL, because SecureTransport
/// cannot negotiate TLS 1.3. Cargo compiles a dependency's build script
/// before the dependent crate's build script, so the patch is applied by
/// scripts/patch-libgit2-sys.sh before the build starts.
fn ensure_libgit2_is_patched() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let script = manifest_dir.join("../scripts/patch-libgit2-sys.sh");

    if !script.exists() {
        panic!("patch script not found at {}", script.display());
    }

    let status = Command::new("bash")
        .arg(&script)
        .arg("--check")
        .status()
        .expect("failed to run scripts/patch-libgit2-sys.sh");

    if !status.success() {
        let _ = Command::new("bash").arg(&script).status();
        panic!(
            "libgit2-sys was compiled unpatched. The patch is applied now - run the build again."
        );
    }
}

fn main() {
    ensure_libgit2_is_patched();

    cc::Build::new()
        .file("src/chkstk_stub.c")
        .compile("chkstk_stub");
    println!("cargo:rerun-if-changed=src/chkstk_stub.c");
}
