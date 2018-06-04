use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use clap::Args as ClapArgs;
use vmz_compiler::{Result, ResultExt, bail};

/// Arguments for `vmz serve`.
#[derive(Debug, ClapArgs)]
pub struct Args {
    /// Project root (defaults to current directory)
    #[arg(default_value = ".")]
    pub path: PathBuf,

    /// Dist directory (relative to project root unless absolute)
    #[arg(short, long, default_value = "dist")]
    pub out_dir: PathBuf,

    /// Listen port
    #[arg(long, default_value = "5173")]
    pub port: u16,

    /// Listen host
    #[arg(long, default_value = "127.0.0.1")]
    pub host: String,

    /// Run `vmz build` before serving
    #[arg(long)]
    pub build: bool,
}

/// Optionally build, then spawn `vmz-serve-host.mjs` and wait for exit.
pub fn run(args: Args) -> Result<()> {
    let (project, dist) = resolve_dirs(&args.path, &args.out_dir)?;

    if args.build {
        crate::commands::build::run(crate::commands::build::Args {
            path: project.clone(),
            out_dir: args.out_dir.clone(),
            release: false,
        })?;
    }

    let host_js = dist.join("vmz-serve-host.mjs");
    if !host_js.is_file() {
        bail!("missing {} — run `vmz build` first (or pass --build)", host_js.display());
    }

    eprintln!("vmz serve — {} (http://{}:{})", host_js.display(), args.host, args.port);

    let mut child = spawn_host(&project, &dist, &args.host, args.port)?;
    let status = child.wait().context("wait for vmz-serve-host")?;
    if !status.success() {
        bail!("vmz serve failed: {status}");
    }
    Ok(())
}

pub(crate) fn resolve_dirs(path: &Path, out_dir: &Path) -> Result<(PathBuf, PathBuf)> {
    let project =
        if path.is_absolute() { path.to_path_buf() } else { std::env::current_dir()?.join(path) };
    let dist = if out_dir.is_absolute() { out_dir.to_path_buf() } else { project.join(out_dir) };
    Ok((project, dist))
}

pub(crate) fn spawn_host(project: &Path, dist: &Path, host: &str, port: u16) -> Result<Child> {
    spawn_host_with(project, dist, host, port, false)
}

pub(crate) fn spawn_host_with(
    project: &Path,
    dist: &Path,
    host: &str,
    port: u16,
    dev: bool,
) -> Result<Child> {
    let host_js = dist.join("vmz-serve-host.mjs");
    let node = std::env::var("VMZ_NODE").unwrap_or_else(|_| "node".into());
    let mut cmd = Command::new(&node);
    cmd.arg(&host_js)
        .current_dir(project)
        .env("VMZ_DIST", dist)
        .env("VMZ_PORT", port.to_string())
        .env("VMZ_HOST", host)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    if dev {
        cmd.env("VMZ_DEV", "1");
    }
    cmd.spawn().with_context(|| format!("spawn {node} {}", host_js.display()))
}

pub(crate) fn stop_host(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Ask a running serve-host to soft-reload modules (POST /__vmz/reload).
pub(crate) fn soft_reload_host(host: &str, port: u16) -> Result<()> {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    let mut stream = TcpStream::connect((host, port))
        .with_context(|| format!("connect {host}:{port} for soft reload"))?;
    stream.set_read_timeout(Some(Duration::from_secs(15)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let req = format!(
        "POST /__vmz/reload HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(req.as_bytes())?;
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf)?;
    let text = String::from_utf8_lossy(&buf);
    let status_ok = text.lines().next().map(|l| l.contains(" 200 ")).unwrap_or(false);
    let body_ok = text.contains("\"ok\":true") || text.contains("\"ok\": true");
    if !status_ok || !body_ok {
        bail!("soft reload failed: {text}");
    }
    Ok(())
}
