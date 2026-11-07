//! Drives the engine ops behind `resolveConflictAndSync` (pull -> conflicts ->
//! blobs -> stage -> commit -> push) against a real bare remote, with and
//! without a CRDT sidecar conflicting next to the note.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use gitnotes_git2::api::types::{Author, PullKind};
use gitnotes_git2::engine::{ops, ops_conflict, ops_remote};
use uuid::Uuid;

const NOTE: &str = "notes/untitled.md";
const SIDECAR: &str = ".gitnotes/crdt/notes/untitled.md.crdt";

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(["-c", "user.name=T", "-c", "user.email=t@example.com"])
        .args(args)
        .current_dir(dir)
        .output()
        .expect("git runs");
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

fn write(dir: &Path, rel: &str, text: &str) {
    let path = dir.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

struct Fixture {
    root: PathBuf,
    device_a: PathBuf,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// Two clones of one bare remote. B pushes first; A then holds a divergent
/// commit touching the note (and the sidecar when `with_sidecar`).
fn diverged(with_sidecar: bool) -> Fixture {
    let root = std::env::temp_dir().join(format!("gn-resolve-{}", Uuid::new_v4()));
    let bare = root.join("remote.git");
    let seed = root.join("seed");
    let (a, b) = (root.join("a"), root.join("b"));
    fs::create_dir_all(&root).unwrap();
    git(&root, &["init", "-q", "--bare", "-b", "main", bare.to_str().unwrap()]);
    git(&root, &["clone", "-q", bare.to_str().unwrap(), seed.to_str().unwrap()]);
    write(&seed, NOTE, "one\ntwo\nthree\n");
    write(&seed, SIDECAR, "BASE\n");
    git(&seed, &["add", "-A"]);
    git(&seed, &["commit", "-q", "-m", "seed"]);
    git(&seed, &["push", "-q", "origin", "HEAD:main"]);
    git(&root, &["clone", "-q", bare.to_str().unwrap(), a.to_str().unwrap()]);
    git(&root, &["clone", "-q", bare.to_str().unwrap(), b.to_str().unwrap()]);

    write(&b, NOTE, "one\ntwo\nTHEIRS\n");
    if with_sidecar {
        write(&b, SIDECAR, "THEIRS-SIDECAR\n");
    }
    git(&b, &["commit", "-q", "-am", "theirs"]);
    git(&b, &["push", "-q", "origin", "main"]);

    write(&a, NOTE, "one\ntwo\nOURS\n");
    if with_sidecar {
        write(&a, SIDECAR, "OURS-SIDECAR\n");
    }
    git(&a, &["commit", "-q", "-am", "ours"]);
    Fixture { root, device_a: a }
}

fn resolve_and_push(fx: &Fixture, with_sidecar: bool, author: &Author) -> gitnotes_git2::engine::Result<()> {
    let a = fx.device_a.as_path();
    let pulled = ops_remote::pull_repo(a, "origin", None, |_| {})?;
    assert!(matches!(pulled.kind, PullKind::Conflict), "pull kind: {:?}", pulled.message);

    let mut expected = vec![NOTE.to_string()];
    if with_sidecar {
        expected.push(SIDECAR.to_string());
    }
    let mut conflicted: Vec<String> =
        ops::get_conflicts(a)?.into_iter().map(|c| c.path).collect();
    conflicted.sort();
    expected.sort();
    assert_eq!(conflicted, expected);

    let blobs = ops_conflict::get_conflict_blobs(a, NOTE)?;
    assert_eq!((blobs.ours.as_str(), blobs.theirs.as_str()), ("one\ntwo\nOURS\n", "one\ntwo\nTHEIRS\n"));
    if with_sidecar {
        ops_conflict::get_conflict_blobs(a, SIDECAR)?;
    }

    write(a, NOTE, "one\ntwo\nOURS THEIRS\n");
    if with_sidecar {
        write(a, SIDECAR, "MERGED-SIDECAR\n");
    }
    ops_conflict::mark_conflict_resolved(a, NOTE)?;
    if with_sidecar {
        ops_conflict::mark_conflict_resolved(a, SIDECAR)?;
    }
    ops::commit_changes(a, "Resolve conflict", author)?;
    let pushed = ops_remote::push_repo(a, "origin", None, false, |_| {})?;
    assert!(pushed.pushed, "push: {}", pushed.message);
    Ok(())
}

fn author() -> Author {
    Author { name: "T".into(), email: "t@example.com".into() }
}

#[test]
fn resolves_note_only_conflict_with_crdt_off() {
    let fx = diverged(false);
    resolve_and_push(&fx, false, &author()).unwrap();
}

#[test]
fn resolves_note_and_sidecar_conflict_with_crdt_on() {
    let fx = diverged(true);
    resolve_and_push(&fx, true, &author()).unwrap();
}

#[test]
fn empty_author_email_fails_the_commit_after_staging() {
    let fx = diverged(true);
    let empty = Author { name: "gitnotes".into(), email: String::new() };
    let err = resolve_and_push(&fx, true, &empty).unwrap_err();
    assert!(err.to_string().contains("empty name or email"), "{err}");
    // The note is staged, so its conflict stages are gone.
    assert!(ops::get_conflicts(&fx.device_a).unwrap().is_empty());
}
