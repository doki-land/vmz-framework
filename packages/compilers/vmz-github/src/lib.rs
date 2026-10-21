//! GitHub Actions monitoring over the GitHub REST API. Never spawns `gh`.

use std::time::{Duration, Instant};

use boost_http::{HttpTransport, Method, Request, Transport, Url};
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
    Request(#[from] boost_http::RequestError),
    #[error(transparent)]
    Serde(#[from] serde_json::Error),
}

impl MonitorError {
    pub fn msg(s: impl Into<String>) -> Self {
        Self::Message(s.into())
    }
}

/// Run monitor on the calling thread.
pub fn monitor_blocking(request: MonitorRequest) -> Result<MonitorResult, MonitorError> {
    let transport = HttpTransport::new();
    let mut run = resolve_run(&transport, &request)?;

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
        std::thread::sleep(interval);
        run = fetch_run(&transport, &request, run.run_id)?;
    }

    let required = request.required_conclusion.trim().to_ascii_lowercase();
    let actual = run.conclusion.as_deref().unwrap_or("").trim().to_ascii_lowercase();
    if actual != required {
        return Err(MonitorError::msg(format!(
            "run {} conclusion={:?} (required {:?}) — {}",
            run.run_id, run.conclusion, request.required_conclusion, run.html_url
        )));
    }
    Ok(run)
}

fn resolve_run(
    transport: &HttpTransport,
    request: &MonitorRequest,
) -> Result<MonitorResult, MonitorError> {
    if let Some(id) = request.run_id {
        return fetch_run(transport, request, id);
    }

    let workflow = request
        .workflow
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| MonitorError::msg("provide workflow (file name or id) or runId"))?;

    let mut url = api_url(&[
        "repos",
        &request.owner,
        &request.repo,
        "actions",
        "workflows",
        workflow,
        "runs",
    ])?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("per_page", "30");
        if let Some(branch) = request.branch.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            query.append_pair("branch", branch);
        }
    }

    let body = get_json(transport, request.token.as_deref(), url)?;
    let page: RunsJson = serde_json::from_value(body)?;
    let mut runs = page.workflow_runs;
    if let Some(sha) = request.head_sha.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let sha_lower = sha.to_ascii_lowercase();
        runs.retain(|run| {
            run.head_sha.to_ascii_lowercase().starts_with(&sha_lower)
                || sha_lower.starts_with(&run.head_sha.to_ascii_lowercase())
        });
    }

    let first = runs
        .into_iter()
        .next()
        .ok_or_else(|| MonitorError::msg("no matching workflow run found"))?;
    Ok(map_workflow_run(&first))
}

fn fetch_run(
    transport: &HttpTransport,
    request: &MonitorRequest,
    run_id: u64,
) -> Result<MonitorResult, MonitorError> {
    let run_id = run_id.to_string();
    let url = api_url(&["repos", &request.owner, &request.repo, "actions", "runs", &run_id])?;
    let body = get_json(transport, request.token.as_deref(), url)?;
    let run: RunJson = serde_json::from_value(body)?;
    Ok(map_workflow_run(&run))
}

fn api_url(segments: &[&str]) -> Result<Url, MonitorError> {
    let mut url =
        Url::parse("https://api.github.com/").map_err(|err| MonitorError::msg(err.to_string()))?;
    url.path_segments_mut()
        .map_err(|_| MonitorError::msg("GitHub API base URL cannot carry path segments"))?
        .extend(segments);
    Ok(url)
}

fn get_json(
    transport: &HttpTransport,
    token: Option<&str>,
    url: Url,
) -> Result<serde_json::Value, MonitorError> {
    let mut request = Request::new(Method::Get, url)
        .with_header("Accept", "application/vnd.github+json")
        .with_header("User-Agent", "vmz-github");
    if let Some(token) = token.map(str::trim).filter(|token| !token.is_empty()) {
        request.set_header("Authorization", format!("Bearer {token}"));
    }
    let response = transport.send(&request)?;
    if !response.is_success() {
        return Err(MonitorError::msg(format!(
            "GitHub API {}: {}",
            response.status,
            String::from_utf8_lossy(&response.body)
        )));
    }
    serde_json::from_slice(&response.body).map_err(MonitorError::Serde)
}

#[derive(Debug, Deserialize)]
struct RunsJson {
    workflow_runs: Vec<RunJson>,
}

#[derive(Debug, Deserialize)]
struct RunJson {
    id: u64,
    status: String,
    #[serde(default)]
    conclusion: Option<String>,
    html_url: String,
    name: String,
    #[serde(default)]
    head_sha: String,
}

fn map_workflow_run(run: &RunJson) -> MonitorResult {
    MonitorResult {
        run_id: run.id,
        status: run.status.clone(),
        conclusion: run.conclusion.clone(),
        html_url: run.html_url.clone(),
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
    fn maps_a_workflow_run_payload() {
        let run: RunJson = serde_json::from_str(
            r#"{"id":7,"status":"completed","conclusion":"success","html_url":"https://github.com/o/r/actions/runs/7","name":"CI","head_sha":"abc"}"#,
        )
        .unwrap();
        let result = map_workflow_run(&run);
        assert_eq!(result.run_id, 7);
        assert_eq!(result.conclusion.as_deref(), Some("success"));
        assert_eq!(result.name.as_deref(), Some("CI"));
    }

    #[test]
    fn status_completed_match() {
        assert!(status_completed("completed"));
        assert!(status_completed("Completed"));
        assert!(!status_completed("in_progress"));
    }
}
