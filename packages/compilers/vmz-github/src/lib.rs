//! GitHub Actions monitoring via `octocrab` (GitHub REST). Never spawns `gh`.

use std::time::{Duration, Instant};

use octocrab::models::RunId;
use octocrab::Octocrab;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MonitorMode {
    Status,
    Wait,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorRequest {
    pub owner: String,
    pub repo: String,
    #[serde(default)]
    pub token: Option<String>,
    pub mode: MonitorMode,
    #[serde(default)]
    pub workflow: Option<String>,
    #[serde(default)]
    pub run_id: Option<u64>,
    /// Commit SHA filter (`head_sha`) when listing runs.
    #[serde(default)]
    pub head_sha: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
    #[serde(default = "default_interval_secs")]
    pub interval_secs: u64,
    #[serde(default = "default_required_conclusion")]
    pub required_conclusion: String,
}

fn default_timeout_secs() -> u64 {
    45 * 60
}

fn default_interval_secs() -> u64 {
    15
}

fn default_required_conclusion() -> String {
    "success".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorResult {
    pub run_id: u64,
    pub status: String,
    #[serde(default)]
    pub conclusion: Option<String>,
    pub html_url: String,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Error)]
pub enum MonitorError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Octocrab(#[from] octocrab::Error),
    #[error(transparent)]
    Serde(#[from] serde_json::Error),
}

impl MonitorError {
    pub fn msg(s: impl Into<String>) -> Self {
        Self::Message(s.into())
    }
}

/// Run monitor (blocking). Builds a current-thread Tokio runtime.
pub fn monitor_blocking(request: MonitorRequest) -> Result<MonitorResult, MonitorError> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| MonitorError::msg(format!("tokio runtime: {e}")))?;
    rt.block_on(monitor(request))
}

pub async fn monitor(request: MonitorRequest) -> Result<MonitorResult, MonitorError> {
    let crab = build_client(request.token.as_deref())?;
    let mut run = resolve_run(&crab, &request).await?;

    if request.mode == MonitorMode::Status {
        return Ok(run);
    }

    let timeout = Duration::from_secs(request.timeout_secs.max(1));
    let interval = Duration::from_secs(request.interval_secs.max(1));
    let deadline = Instant::now() + timeout;

    while !status_completed(&run.status) {
        if Instant::now() >= deadline {
            return Err(MonitorError::msg(format!(
                "timed out after {}s waiting for run {} (last status={})",
                request.timeout_secs, run.run_id, run.status
            )));
        }
        tokio::time::sleep(interval).await;
        run = fetch_run(&crab, &request.owner, &request.repo, run.run_id).await?;
    }

    let required = request.required_conclusion.trim().to_ascii_lowercase();
    let actual = run
        .conclusion
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if actual != required {
        return Err(MonitorError::msg(format!(
            "run {} conclusion={:?} (required {:?}) — {}",
            run.run_id, run.conclusion, request.required_conclusion, run.html_url
        )));
    }
    Ok(run)
}

fn build_client(token: Option<&str>) -> Result<Octocrab, MonitorError> {
    match token.map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => Ok(Octocrab::builder().personal_token(t.to_string()).build()?),
        None => Ok(Octocrab::builder().build()?),
    }
}

async fn resolve_run(
    crab: &Octocrab,
    request: &MonitorRequest,
) -> Result<MonitorResult, MonitorError> {
    if let Some(id) = request.run_id {
        return fetch_run(crab, &request.owner, &request.repo, id).await;
    }

    let workflow = request
        .workflow
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| MonitorError::msg("provide workflow (file name or id) or runId"))?;

    let workflows = crab.workflows(&request.owner, &request.repo);
    let mut builder = workflows.list_runs(workflow).per_page(30u8);

    if let Some(branch) = request
        .branch
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        builder = builder.branch(branch);
    }

    let page = builder.send().await?;
    let mut runs = page.items;
    if let Some(sha) = request
        .head_sha
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let sha_lower = sha.to_ascii_lowercase();
        runs.retain(|r| {
            r.head_sha
                .to_ascii_lowercase()
                .starts_with(&sha_lower)
                || sha_lower.starts_with(&r.head_sha.to_ascii_lowercase())
        });
    }

    let first = runs
        .into_iter()
        .next()
        .ok_or_else(|| MonitorError::msg("no matching workflow run found"))?;

    Ok(map_workflow_run(&first))
}

async fn fetch_run(
    crab: &Octocrab,
    owner: &str,
    repo: &str,
    run_id: u64,
) -> Result<MonitorResult, MonitorError> {
    let run = crab
        .workflows(owner, repo)
        .get(RunId(run_id))
        .await?;
    Ok(map_workflow_run(&run))
}

fn map_workflow_run(run: &octocrab::models::workflows::Run) -> MonitorResult {
    MonitorResult {
        run_id: run.id.0,
        status: run.status.clone(),
        conclusion: run.conclusion.clone(),
        html_url: run.html_url.to_string(),
        name: Some(run.name.clone()),
    }
}

fn status_completed(status: &str) -> bool {
    status.eq_ignore_ascii_case("completed")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_roundtrip_json() {
        let req = MonitorRequest {
            owner: "doki-land".into(),
            repo: "vmz-framework".into(),
            token: None,
            mode: MonitorMode::Status,
            workflow: Some("ci.yml".into()),
            run_id: None,
            head_sha: Some("abc".into()),
            branch: Some("dev".into()),
            timeout_secs: 60,
            interval_secs: 5,
            required_conclusion: "success".into(),
        };
        let s = serde_json::to_string(&req).unwrap();
        let back: MonitorRequest = serde_json::from_str(&s).unwrap();
        assert_eq!(back.mode, MonitorMode::Status);
        assert_eq!(back.workflow.as_deref(), Some("ci.yml"));
        assert_eq!(back.timeout_secs, 60);
    }

    #[test]
    fn status_completed_match() {
        assert!(status_completed("completed"));
        assert!(status_completed("Completed"));
        assert!(!status_completed("in_progress"));
    }
}
