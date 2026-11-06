use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use git2::build::RepoBuilder;
use git2::{CertificateCheckStatus, FetchOptions, RemoteCallbacks};
use uuid::Uuid;

const TLS_SERVER: &str = r##"
import http.server
import os
import ssl
import subprocess
import sys
import zlib

repository, certificate, key = sys.argv[1:4]


class SmartHttp(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def respond(self, content_type, body):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.path.endswith("/info/refs?service=git-upload-pack"):
            self.send_error(404)
            return
        advertised = subprocess.run(
            ["git", "upload-pack", "--stateless-rpc", "--advertise-refs", repository],
            check=True,
            capture_output=True,
        ).stdout
        banner = b"# service=git-upload-pack\n"
        header = b"%04x" % (len(banner) + 4) + banner + b"0000"
        self.respond("application/x-git-upload-pack-advertisement", header + advertised)

    def do_POST(self):
        if not self.path.endswith("/git-upload-pack"):
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers["Content-Length"]))
        if self.headers.get("Content-Encoding") == "gzip":
            body = zlib.decompress(body, 16 + zlib.MAX_WBITS)
        result = subprocess.run(
            ["git", "upload-pack", "--stateless-rpc", repository],
            input=body,
            check=True,
            capture_output=True,
        ).stdout
        self.respond("application/x-git-upload-pack-result", result)


server = http.server.HTTPServer(("127.0.0.1", 0), SmartHttp)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.minimum_version = ssl.TLSVersion.TLSv1_3
context.maximum_version = ssl.TLSVersion.TLSv1_3
context.load_cert_chain(certificate, key)
server.socket = context.wrap_socket(server.socket, server_side=True)
print(server.server_address[1], flush=True)
server.serve_forever()
"##;

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("gitnotes-tls13-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct TlsGitServer {
    directory: TestDirectory,
    _child: TestServerProcess,
    certificate_der: Vec<u8>,
    port: u16,
}

struct TestServerProcess(Child);

impl Drop for TestServerProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

impl TlsGitServer {
    fn start() -> Self {
        let directory = TestDirectory::new();
        let source = directory.path().join("source");
        let repository = directory.path().join("repo.git");
        let certificate = directory.path().join("server.pem");
        let key = directory.path().join("server.key");
        let certificate_der = directory.path().join("server.der");

        run_git(
            directory.path(),
            ["init", "--initial-branch=main", source.to_str().unwrap()],
        );
        run_git(&source, ["config", "user.name", "TLS test"]);
        run_git(&source, ["config", "user.email", "tls-test@gitnotes.invalid"]);
        fs::write(source.join("README.md"), "TLS 1.3 Git clone fixture\n").unwrap();
        run_git(&source, ["add", "README.md"]);
        run_git(&source, ["commit", "-m", "Add TLS fixture"]);
        run_git(
            directory.path(),
            [
                "clone",
                "--bare",
                source.to_str().unwrap(),
                repository.to_str().unwrap(),
            ],
        );
        let mut request = Command::new("openssl");
        request
            .current_dir(directory.path())
            .args([
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-keyout",
                key.to_str().unwrap(),
                "-out",
                certificate.to_str().unwrap(),
                "-days",
                "1",
                "-subj",
                "/CN=127.0.0.1",
                "-addext",
                "subjectAltName=IP:127.0.0.1",
            ]);
        run(request);

        let mut convert = Command::new("openssl");
        convert
            .current_dir(directory.path())
            .args([
                "x509",
                "-in",
                certificate.to_str().unwrap(),
                "-outform",
                "DER",
                "-out",
                certificate_der.to_str().unwrap(),
            ]);
        run(convert);

        let mut server = Command::new("python3");
        server
            .args(["-u", "-c", TLS_SERVER])
            .arg(&repository)
            .arg(&certificate)
            .arg(&key)
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = TestServerProcess(server.spawn().unwrap());
        let stdout = child.0.stdout.take().unwrap();
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let mut port = String::new();
            let result = BufReader::new(stdout)
                .read_line(&mut port)
                .map(|_| port);
            let _ = sender.send(result);
        });
        let port = receiver
            .recv_timeout(Duration::from_secs(10))
            .expect("TLS test server did not report its bound port")
            .expect("failed to read TLS test server port")
            .trim()
            .parse()
            .expect("TLS test server returned an invalid port");

        Self {
            directory,
            _child: child,
            certificate_der: fs::read(certificate_der).unwrap(),
            port,
        }
    }

    fn url(&self) -> String {
        format!("https://127.0.0.1:{}/repo.git", self.port)
    }
}

fn run_git<const N: usize>(directory: &Path, args: [&str; N]) {
    let mut command = Command::new("git");
    command.current_dir(directory).args(args);
    run(command);
}

fn run(mut command: Command) -> Output {
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "command failed: {:?}\nstdout: {}\nstderr: {}",
        command,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

#[test]
fn tls13_only_server_clone() {
    let server = TlsGitServer::start();
    let destination = server.directory.path().join("clone");
    let expected_certificate = server.certificate_der.clone();
    let mut callbacks = RemoteCallbacks::new();
    callbacks.certificate_check(move |certificate, _hostname| {
        let Some(certificate) = certificate.as_x509() else {
            return Err(git2::Error::from_str("TLS test expected an X.509 certificate"));
        };
        if certificate.data() == expected_certificate {
            Ok(CertificateCheckStatus::CertificateOk)
        } else {
            Err(git2::Error::from_str("TLS test certificate did not match fixture"))
        }
    });
    let mut fetch = FetchOptions::new();
    fetch.remote_callbacks(callbacks);
    let mut builder = RepoBuilder::new();
    builder.fetch_options(fetch);

    let repo = builder.clone(&server.url(), &destination).unwrap();

    assert_eq!(
        fs::read_to_string(destination.join("README.md")).unwrap(),
        "TLS 1.3 Git clone fixture\n"
    );
    assert_eq!(repo.head().unwrap().shorthand().unwrap(), "main");
}

#[test]
fn untrusted_certificate_is_rejected() {
    let server = TlsGitServer::start();
    let destination = server.directory.path().join("clone-untrusted");

    let error = match RepoBuilder::new().clone(&server.url(), &destination) {
        Ok(_) => panic!("clone must fail for a self-signed certificate"),
        Err(error) => error,
    };

    assert_eq!(error.class(), git2::ErrorClass::Ssl, "{error}");
    assert!(!destination.join("README.md").exists());
}
