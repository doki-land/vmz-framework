//! Oak Vue directive / hang regressions (moved from upstream `oak-vue` tests).
//!
//! CI runs this binary in isolation with memory and time bounds — see
//! `.github/workflows/vue-oak-regression.yml`.

use oak_core::{Builder, GreenNode, GreenTree, ParseSession, Parser, Source, SourceText};
use oak_vue::{
    VueBuilder, VueLanguage, VueParser,
    ast::{VueAttribute, VueNode},
};
use std::{
    alloc::{GlobalAlloc, Layout, System},
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
    time::{Duration, Instant},
};

struct CountingAllocator;

static TRACKING: AtomicBool = AtomicBool::new(false);
static ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);
static BYTES: AtomicUsize = AtomicUsize::new(0);

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if TRACKING.load(Ordering::Relaxed) {
            ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
            BYTES.fetch_add(layout.size(), Ordering::Relaxed);
        }
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) }
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        if TRACKING.load(Ordering::Relaxed) {
            ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
            BYTES.fetch_add(size, Ordering::Relaxed);
        }
        unsafe { System.realloc(pointer, layout, size) }
    }
}

fn count_nodes(node: &GreenNode<'_, VueLanguage>) -> usize {
    1 + node
        .children
        .iter()
        .map(|child| match child {
            GreenTree::Node(child) => count_nodes(child),
            GreenTree::Leaf(_) => 0,
        })
        .sum::<usize>()
}

#[test]
fn event_shell_directive_has_bounded_allocations_and_exact_spans() {
    let source = SourceText::new(r#"<button @click="(() => armed = !armed)">"#);
    let language = VueLanguage::default();
    let parser = VueParser::new(&language);
    let mut session = ParseSession::default();
    TRACKING.store(true, Ordering::Relaxed);
    let start = Instant::now();
    let parsed = parser.parse(&source, &[], &mut session);
    let elapsed = start.elapsed();
    TRACKING.store(false, Ordering::Relaxed);
    let root = parsed.result.expect("minimal event directive CST");
    let allocations = ALLOCATIONS.load(Ordering::Relaxed);
    let bytes = BYTES.load(Ordering::Relaxed);
    let nodes = count_nodes(root);
    assert!(elapsed < Duration::from_millis(100), "parse took {elapsed:?}");
    assert!(allocations < 1024, "{allocations} allocations");
    assert!(bytes < 1024 * 1024, "{bytes} allocated bytes");
    assert!(nodes < 128, "{nodes} nodes");
    assert_eq!(root.byte_length as usize, source.length());
    eprintln!("event_shell: {elapsed:?}, {allocations} allocations, {bytes} bytes, {nodes} nodes");

    let source = SourceText::new(
        r#"<template><button @click="(() => armed = !armed)" :title="label">{{ label }}</button><li v-for="item in items" :key="item.id">{{ item }}</li></template>"#,
    );
    let mut session = ParseSession::default();
    let parsed = parser.parse(&source, &[], &mut session);
    assert_eq!(parsed.result.unwrap().byte_length as usize, source.length());
    let builder = VueBuilder::new();
    let mut session = ParseSession::default();
    let built = builder.build(&source, &[], &mut session).result.unwrap();
    let VueNode::Element(button) = &built.blocks[0].children[0] else {
        panic!("expected button");
    };
    let VueAttribute::Directive(click) = &button.attributes[0] else {
        panic!("expected event directive");
    };
    assert_eq!(
        source.get_text_in(click.value.as_ref().unwrap().span.clone()),
        "(() => armed = !armed)"
    );
    let VueAttribute::Directive(title) = &button.attributes[1] else {
        panic!("expected title directive");
    };
    assert_eq!(source.get_text_in(title.value.as_ref().unwrap().span.clone()), "label");
    let VueNode::Element(list) = &built.blocks[0].children[1] else {
        panic!("expected list element");
    };
    assert_eq!(source.get_text_in(list.tag_name.clone()), "li");
}

#[test]
fn builder_preserves_directive_arguments() {
    let source = SourceText::new(r#"<template><Like client:idle @click="armed = !armed" /></template>"#);
    let language = VueLanguage::default();
    let parser = VueParser::new(&language);
    let mut parse_session = ParseSession::default();
    assert!(parser.parse(&source, &[], &mut parse_session).result.is_ok());
    let builder = VueBuilder::new();
    let mut build_session = ParseSession::default();
    let root = builder.build(&source, &[], &mut build_session).result.unwrap();
    let VueNode::Element(element) = &root.blocks[0].children[0] else {
        panic!("expected component")
    };
    let VueAttribute::Directive(client) = &element.attributes[0] else {
        panic!("expected client directive")
    };
    assert_eq!(source.get_text_in(client.name.clone()), "client");
    assert_eq!(source.get_text_in(client.arg.as_ref().unwrap().span.clone()), "idle");
    let VueAttribute::Directive(click) = &element.attributes[1] else {
        panic!("expected click directive")
    };
    assert_eq!(source.get_text_in(click.name.clone()), "click");
    assert!(click.arg.is_none());
}

#[test]
fn valueless_directive_does_not_consume_next_attribute() {
    let source = SourceText::new(r#"<template><button v-else :type="type" disabled @click="run" /></template>"#);
    let mut session = ParseSession::default();
    let root = VueBuilder::new().build(&source, &[], &mut session).result.unwrap();
    let VueNode::Element(element) = &root.blocks[0].children[0] else {
        panic!("expected button")
    };
    assert_eq!(element.attributes.len(), 4);
    let VueAttribute::Directive(otherwise) = &element.attributes[0] else {
        panic!("expected else");
    };
    assert_eq!(source.get_text_in(otherwise.span.clone()).trim(), "v-else");
    assert!(otherwise.arg.is_none());
    assert!(otherwise.value.is_none());
    let VueAttribute::Directive(binding) = &element.attributes[1] else {
        panic!("expected binding")
    };
    assert_eq!(source.get_text_in(binding.span.clone()).trim(), r#":type="type""#);
}

#[test]
fn counter_directive_expressions_do_not_stall() {
    let cases = [
        r#"<button @input="((e) => note = e.target.value)">"#,
        r#"<button @click="(() => count++)">"#,
        r#"<select @change="((e) => plan = e.target.value)">"#,
    ];
    let language = VueLanguage::default();
    let parser = VueParser::new(&language);
    for source in cases {
        let source = SourceText::new(source);
        let mut session = ParseSession::default();
        let parsed = parser.parse(&source, &[], &mut session);
        assert!(!parsed.has_errors(), "parse errors for {source:?}: {:?}", parsed.diagnostics);
    }
    let source = SourceText::new(
        r#"<template>
    <div data-testid="counter-root">
        <label>
            Note
            <input type="text" data-testid="counter-note" :value="note" @input="((e) => note = e.target.value)" />
        </label>
        <button type="button" aria-label="Increment counter" data-testid="counter-inc" @click="(() => count++)">
            count:
            {{ count }}
        </button>
        <label>
            Plan
            <select data-testid="counter-plan" :value="plan" @change="((e) => plan = e.target.value)">
                <option value>—</option>
                <option value="ops">Ops</option>
                <option value="dev">Dev</option>
            </select>
        </label>
    </div>
</template>"#,
    );
    let builder = VueBuilder::new();
    let mut build_session = ParseSession::default();
    let built = builder.build(&source, &[], &mut build_session);
    assert!(built.result.is_ok(), "full template build errors: {:?}", built.diagnostics);
}

#[test]
fn keyword_attr_name_for_does_not_hang() {
    let source = SourceText::new(r#"<template><label :for="controlId" class="x">{{ label }}</label></template>"#);
    let language = VueLanguage::default();
    let parser = VueParser::new(&language);
    let mut session = ParseSession::default();
    let parsed = parser.parse(&source, &[], &mut session);
    assert!(!parsed.has_errors(), "parse errors: {:?}", parsed.diagnostics);

    let builder = VueBuilder::new();
    let mut cache = ParseSession::default();
    let built = Builder::build(&builder, &source, &[], &mut cache);
    assert!(built.result.is_ok(), "build failed: {:?}", built.diagnostics);
}
