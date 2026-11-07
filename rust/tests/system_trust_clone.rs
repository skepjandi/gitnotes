//! Clones from a publicly trusted HTTPS host with no `certificate_check`
//! callback, so libgit2's own chain validation decides. The TLS 1.3 fixture
//! tests in `tls13_clone.rs` install a callback that overrides libgit2's
//! verdict, which let a "the SSL certificate is invalid" regression on Apple
//! devices through (the system trust store accepted the chain, but
//! `verify_server_cert` still saw OpenSSL's own failed verify result).
//!
//! Needs network access, so it only runs with `cargo test -- --ignored`.

use git2::build::RepoBuilder;
use uuid::Uuid;

#[test]
#[ignore = "requires network access"]
fn clone_from_publicly_trusted_host_validates_against_system_trust() {
    let destination = std::env::temp_dir().join(format!("gitnotes-system-trust-{}", Uuid::new_v4()));

    let result = RepoBuilder::new().clone("https://github.com/octocat/Hello-World.git", &destination);

    let _ = std::fs::remove_dir_all(&destination);
    if let Err(error) = result {
        panic!("clone from a CA-signed host must succeed: {error}");
    }
}
