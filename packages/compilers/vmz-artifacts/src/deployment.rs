use std::collections::{BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use vmz_compiler::{DeploymentDocument, DEPLOYMENT_SCHEMA};
use vmz_protocol::VmzModuleKind;

use crate::error::ArtifactError;

/// One client component row derived from [`DeploymentDocument`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentEntry {
    /// Stable chunk id (`components/Button`, …).
    pub chunk_id: String,
    /// PascalCase tag (basename of chunk id).
    pub name: String,
    /// Client entry path relative to dist.
    pub entry: String,
    /// Workspace-relative source `.vmz` path.
    pub source: String,
}

/// Parse and validate `vmz-deployment.json` body.
pub fn parse_deployment_json(text: &str) -> Result<DeploymentDocument, ArtifactError> {
    let doc: DeploymentDocument = serde_json::from_str(text)?;
    validate_deployment(&doc)?;
    Ok(doc)
}

/// Validate schema id only (structure is enforced by serde).
pub fn validate_deployment(doc: &DeploymentDocument) -> Result<(), ArtifactError> {
    if doc.schema != DEPLOYMENT_SCHEMA {
        return Err(ArtifactError::Schema(doc.schema.clone()));
    }
    Ok(())
}

fn normalize_chunk_id(id: &str) -> String {
    id.replace('\\', "/")
}

/// Component units from deployment (sorted by chunk id).
pub fn component_entries(doc: &DeploymentDocument) -> Vec<ComponentEntry> {
    let mut out = Vec::new();
    for unit in &doc.units {
        if unit.kind != VmzModuleKind::Component {
            continue;
        }
        let chunk_id = normalize_chunk_id(&unit.chunk_id);
        let name = match chunk_id.rsplit('/').next().filter(|s| !s.is_empty()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let entry = if unit.client_entry.is_empty() {
            format!("{chunk_id}.client.js")
        } else {
            normalize_chunk_id(&unit.client_entry)
        };
        out.push(ComponentEntry {
            chunk_id,
            name,
            entry,
            source: unit.source.clone(),
        });
    }
    out.sort_by(|a, b| a.chunk_id.cmp(&b.chunk_id));
    out
}

/// Forward `dependsOn` closure from root chunk ids (includes roots).
pub fn collect_depends_on_closure(
    doc: &DeploymentDocument,
    roots: &[impl AsRef<str>],
) -> BTreeSet<String> {
    let mut by_id: HashMap<String, usize> = HashMap::new();
    for (idx, unit) in doc.units.iter().enumerate() {
        by_id.insert(normalize_chunk_id(&unit.chunk_id), idx);
    }
    let mut out = BTreeSet::new();
    let mut stack: Vec<String> = roots
        .iter()
        .map(|r| normalize_chunk_id(r.as_ref()))
        .filter(|s| !s.is_empty())
        .collect();
    while let Some(id) = stack.pop() {
        if !out.insert(id.clone()) {
            continue;
        }
        let Some(&idx) = by_id.get(&id) else {
            continue;
        };
        let unit = &doc.units[idx];
        for dep in &unit.depends_on {
            let d = normalize_chunk_id(dep);
            if !out.contains(&d) {
                stack.push(d);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"{
  "schema": "vmz.deployment.v0",
  "units": [
    {
      "chunkId": "pages/index",
      "kind": "page",
      "dependsOn": ["components/Button", "layouts/App"]
    },
    {
      "chunkId": "components/Button",
      "kind": "component",
      "clientEntry": "components/Button.client.js",
      "source": "src/components/Button.vmz",
      "dependsOn": ["components/Icon"]
    },
    {
      "chunkId": "components/Icon",
      "kind": "component",
      "clientEntry": "components/Icon.client.js",
      "source": "src/components/Icon.vmz"
    },
    {
      "chunkId": "layouts/App",
      "kind": "component",
      "clientEntry": "layouts/App.client.js",
      "source": "src/layouts/App.vmz"
    }
  ]
}"#;

    #[test]
    fn closure_matches_depends_on_graph() {
        let doc = parse_deployment_json(FIXTURE).expect("fixture");
        let closure = collect_depends_on_closure(&doc, &["pages/index"]);
        assert!(closure.contains("pages/index"));
        assert!(closure.contains("components/Button"));
        assert!(closure.contains("components/Icon"));
        assert!(closure.contains("layouts/App"));
        assert_eq!(closure.len(), 4);
    }

    #[test]
    fn component_entries_sorted() {
        let doc = parse_deployment_json(FIXTURE).expect("fixture");
        let entries = component_entries(&doc);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].name, "Button");
        assert_eq!(entries[1].name, "Icon");
        assert_eq!(entries[2].chunk_id, "layouts/App");
    }

    #[test]
    fn rejects_wrong_schema() {
        let bad = FIXTURE.replace(DEPLOYMENT_SCHEMA, "vmz.deployment.v99");
        let err = parse_deployment_json(&bad).unwrap_err();
        assert!(matches!(err, ArtifactError::Schema(_)));
    }
}
