use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};
use clap::Args as ClapArgs;
use walkdir::WalkDir;

use crate::commands::serve::{resolve_dirs, soft_reload_host, spawn_host_with, stop_host};

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

    /// Poll interval for `src/` changes (milliseconds)
    #[arg(long, default_value = "300")]
    pub poll_ms: u64,
}

pub fn run(args: Args) -> Result<()> {
    let (project, dist) = resolve_dirs(&args.path, &args.out_dir)?;
    let src = project.join("src");
    if !src.is_dir() {
        bail!("vmz dev: missing src/ under {}", project.display());
    }

    eprintln!("vmz dev: initial build...");
    build_project(&project, &args.out_dir)?;

    let host_js = dist.join("vmz-serve-host.mjs");
    if !host_js.is_file() {
        bail!("vmz dev: missing {}", host_js.display());
    }

    eprintln!("vmz dev -> http://{}:{} (watching {})", args.host, args.port, src.display());

    let mut child = spawn_host_with(&project, &dist, &args.host, args.port, true)?;
    let mut fingerprint = src_fingerprint(&src)?;

    loop {
        thread::sleep(Duration::from_millis(args.poll_ms.max(50)));

        // If the host died, exit (unless we are about to rebuild).
        if let Some(status) = child.try_wait().context("poll serve-host")? {
            bail!("vmz serve-host exited: {status}");
        }

        let next = match src_fingerprint(&src) {
            Ok(fp) => fp,
            Err(err) => {
                eprintln!("vmz dev: watch error: {err}");
                continue;
            }
        };
        if next == fingerprint {
            continue;
        }

        // Debounce bursty saves.
        thread::sleep(Duration::from_millis(200));
        let next = src_fingerprint(&src).unwrap_or(next);
        fingerprint = next;

        eprintln!("vmz dev: change detected — rebuilding...");
        match build_project(&project, &args.out_dir) {
            Ok(()) => {
                eprintln!("vmz dev: soft reloading...");
                if let Err(err) = soft_reload_host(&args.host, args.port) {
                    eprintln!("vmz dev: soft reload failed ({err}) — restarting server...");
                    stop_host(&mut child);
                    child = spawn_host_with(&project, &dist, &args.host, args.port, true)?;
                }
                fingerprint = src_fingerprint(&src).unwrap_or(fingerprint);
            }
            Err(err) => {
                eprintln!("vmz dev: build failed (keeping old server): {err}");
            }
        }
    }
}

fn build_project(project: &Path, out_dir: &Path) -> Result<()> {
    crate::commands::build::run(crate::commands::build::Args {
        path: project.to_path_buf(),
        out_dir: out_dir.to_path_buf(),
        release: false,
    })
}

/// Cheap change detector: path + mtime + size for watched extensions under `src/`.
pub(crate) fn src_fingerprint(src: &Path) -> Result<u64> {
    let mut h: u64 = 0xcbf29ce484222325;
    let mut paths: Vec<PathBuf> = WalkDir::new(src)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.path().to_path_buf())
        .filter(|p| is_watched_source(p))
        .collect();
    paths.sort();
    for p in paths {
        let meta = std::fs::metadata(&p).with_context(|| format!("stat {}", p.display()))?;
        let modified = meta
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        h = h.wrapping_mul(0x100000001b3).wrapping_add(modified);
        h = h.wrapping_mul(0x100000001b3).wrapping_add(meta.len());
        for b in p.to_string_lossy().as_bytes() {
            h = h.wrapping_mul(0x100000001b3).wrapping_add(u64::from(*b));
        }
    }
    Ok(h)
}

fn is_watched_source(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some("vmz" | "ts" | "tsx" | "js" | "mjs" | "css" | "json") => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn fingerprint_changes_when_file_updates() {
        let dir = std::env::temp_dir().join(format!("vmz-dev-fp-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("x.vmz");
        fs::write(&file, "a").unwrap();
        let a = src_fingerprint(&dir).unwrap();
        thread::sleep(Duration::from_millis(20));
        fs::write(&file, "b").unwrap();
        let b = src_fingerprint(&dir).unwrap();
        assert_ne!(a, b);
        let _ = fs::remove_dir_all(&dir);
    }
}
