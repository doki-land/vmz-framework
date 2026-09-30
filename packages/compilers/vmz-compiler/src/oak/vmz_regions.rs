//! Project `.vmz` [`ParsedVmz`] into [`SfcDocumentView`] block regions.

use std::path::Path;

use vmz_oak_frontend_adapter::{
    BlockKind, ByteSpan, SfcBlockRegion, SfcDocumentView,
};

use crate::sfc::{
    DataBlock, ParsedVmz, ScriptBlock, ScriptKind, StyleBlock, TemplateBlock, parse_vmz,
};

/// Parse `.vmz` and build an ordered region map for Oak/Nyar adapters.
pub fn project_vmz_regions(path: impl AsRef<Path>, source: impl Into<String>) -> Result<SfcDocumentView, crate::sfc::SfcError> {
    let parsed = parse_vmz(path, source)?;
    Ok(project_parsed_vmz(&parsed))
}

/// Project an already-parsed SFC into block regions.
pub fn project_parsed_vmz(parsed: &ParsedVmz) -> SfcDocumentView {
    let mut blocks = Vec::new();

    if let Some(router) = &parsed.router {
        blocks.push(data_block_region(BlockKind::Router, &parsed.source, router));
    }
    if let Some(meta) = &parsed.meta {
        blocks.push(data_block_region(BlockKind::Meta, &parsed.source, meta));
    }

    blocks.push(template_block_region(&parsed.source, &parsed.template));

    if let Some(style) = &parsed.style {
        blocks.push(style_block_region(&parsed.source, style));
    }

    blocks.push(script_block_region(&parsed.source, &parsed.client));

    if let Some(server) = &parsed.server {
        blocks.push(script_block_region(&parsed.source, server));
    }

    SfcDocumentView {
        path: parsed.path.clone(),
        source: parsed.source.clone(),
        blocks,
    }
}

fn data_block_region(kind: BlockKind, _source: &str, block: &DataBlock) -> SfcBlockRegion {
    let content_end = block.content_start + block.content.len();
    let close = match kind {
        BlockKind::Router => "</router>",
        BlockKind::Meta => "</meta>",
        _ => "",
    };
    let block_end = if close.is_empty() {
        block.open_end
    } else {
        content_end + close.len()
    };
    SfcBlockRegion {
        kind,
        span: ByteSpan { start: block.tag_start, end: block_end },
        content_span: ByteSpan { start: block.content_start, end: content_end },
    }
}

fn template_block_region(source: &str, block: &TemplateBlock) -> SfcBlockRegion {
    envelope_region(source, block.content_start, block.content.len(), "template", BlockKind::Template)
}

fn style_block_region(source: &str, block: &StyleBlock) -> SfcBlockRegion {
    envelope_region(source, block.content_start, block.content.len(), "style", BlockKind::Style)
}

fn script_block_region(source: &str, block: &ScriptBlock) -> SfcBlockRegion {
    let kind = match block.kind {
        ScriptKind::Client => BlockKind::ScriptClient,
        ScriptKind::Server => BlockKind::ScriptServer,
    };
    envelope_region(source, block.content_start, block.content.len(), "script", kind)
}

fn envelope_region(
    source: &str,
    content_start: usize,
    content_len: usize,
    tag: &str,
    kind: BlockKind,
) -> SfcBlockRegion {
    let open_needle = format!("<{tag}");
    let close = format!("</{tag}>");
    let content_end = content_start + content_len;
    let tag_start = source[..content_start].rfind(&open_needle).unwrap_or(content_start);
    let block_end = source[content_end..]
        .find(&close)
        .map(|i| content_end + i + close.len())
        .unwrap_or(content_end);
    SfcBlockRegion {
        kind,
        span: ByteSpan { start: tag_start, end: block_end },
        content_span: ByteSpan { start: content_start, end: content_end },
    }
}
