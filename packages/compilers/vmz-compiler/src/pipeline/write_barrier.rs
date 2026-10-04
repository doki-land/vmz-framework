//! Owned mutation lowering through the Oak TypeScript frontend.

use std::collections::HashSet;

/// Result of rewriting owned mutations.
#[derive(Debug, Default, Clone)]
pub struct WriteBarrierRewrite {
    /// Source after lowering.
    pub source: String,
    /// Number of lowered mutation sites.
    pub rewritten: usize,
}

/// Lower strides, transposes, then individual owned writes through Oak.
pub fn rewrite_static_path_writes(
    source: &str,
    owned_fields: &HashSet<String>,
) -> WriteBarrierRewrite {
    let stride = rewrite_array_item_strides(source, owned_fields);
    let transpose = rewrite_list_transpose(&stride.source, owned_fields);
    let writes =
        super::write_barrier_oak::rewrite_static_path_writes(&transpose.source, owned_fields)
            .expect("Oak failed to parse owned mutation source");
    WriteBarrierRewrite {
        source: writes.source,
        rewritten: stride.rewritten + transpose.rewritten + writes.rewritten,
    }
}

/// Lower owned array stride loops through Oak.
pub fn rewrite_array_item_strides(
    source: &str,
    owned_fields: &HashSet<String>,
) -> WriteBarrierRewrite {
    super::write_barrier_oak::rewrite_array_item_strides(source, owned_fields)
        .expect("Oak failed to parse array stride source")
}

/// Lower owned list transposes through Oak.
pub fn rewrite_list_transpose(source: &str, owned_fields: &HashSet<String>) -> WriteBarrierRewrite {
    super::write_barrier_oak::rewrite_list_transpose(source, owned_fields)
        .expect("Oak failed to parse list transpose source")
}
