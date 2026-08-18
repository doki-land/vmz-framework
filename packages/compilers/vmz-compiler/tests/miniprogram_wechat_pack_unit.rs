//! WeChat packaging writer unit tests.

use std::fs;

use vmz_compiler::miniprogram::wechat_pack::{
    emit_wechat_page, lower_miniprogram_wechat_packaging, wechat_page_stem,
};
use vmz_protocol::VmzModuleKind;
use vmz_types::{
    Binding, BindingId, DeploymentView, Effect, EffectId, ExprId, FieldId, FieldKind, IrDepPath,
    PROGRAM_SCHEMA, ProgramModule, ProgramUnit, ProgramUnitKind, ReactiveComponent, StateSlot,
    StubStatus, UnitId, ViewAttr, ViewAttrValue, ViewEach, ViewNode, ViewStatus, ViewView,
    WritePath,
};

fn home_unit() -> ProgramUnit {
    let view = ViewView {
        status: ViewStatus::Native,
        binding_ids: vec![BindingId(0), BindingId(2), BindingId(3)],
        region_ids: vec![],
        roots: vec![ViewNode::Element {
            tag: "div".into(),
            attrs: vec![ViewAttr {
                name: "class".into(),
                value: ViewAttrValue::Static { value: "page".into() },
                binding: None,
            }],
            children: vec![
                ViewNode::Element {
                    tag: "div".into(),
                    attrs: vec![
                        ViewAttr {
                            name: "class".into(),
                            value: ViewAttrValue::Static { value: "loc".into() },
                            binding: None,
                        },
                        ViewAttr {
                            name: "@click".into(),
                            value: ViewAttrValue::Interp { expr: "onStore".into() },
                            binding: Some(BindingId(2)),
                        },
                    ],
                    children: vec![ViewNode::Interp {
                        expr: "store".into(),
                        binding: Some(BindingId(0)),
                    }],
                    each: None,
                },
                ViewNode::Element {
                    tag: "div".into(),
                    attrs: vec![ViewAttr {
                        name: "class".into(),
                        value: ViewAttrValue::Static { value: "deal".into() },
                        binding: None,
                    }],
                    children: vec![ViewNode::Interp {
                        expr: "item.title".into(),
                        binding: Some(BindingId(1)),
                    }],
                    each: Some(ViewEach {
                        list_expr: "deals".into(),
                        as_name: "item".into(),
                        key_expr: Some("item.id".into()),
                        list_binding: Some(BindingId(3)),
                        key_binding: None,
                        region: None,
                    }),
                },
            ],
            each: None,
        }],
    };
    let reactive = ReactiveComponent {
        name: "HomePage".into(),
        state_slots: vec![StateSlot {
            id: FieldId(0),
            name: "store".into(),
            kind: FieldKind::State,
        }],
        properties: vec![],
        bindings: vec![
            Binding::Text {
                id: BindingId(0),
                reads: vec![IrDepPath::Field(FieldId(0))],
                region: None,
                expr: Some(ExprId(1)),
            },
            Binding::Event {
                id: BindingId(2),
                reads: vec![],
                region: None,
                expr: Some(ExprId(0)),
                attr: "@click".into(),
            },
        ],
        effects: vec![Effect {
            id: EffectId(0),
            name: "onStore".into(),
            reads: vec![],
            writes: vec![WritePath { path: IrDepPath::Field(FieldId(0)) }],
            async_boundary: false,
            calls: vec![],
            opaque_callee: false,
            star_reasons: vec![],
        }],
        control_regions: vec![],
        exprs: vec![],
    };
    ProgramUnit {
        id: UnitId { unit_id: 0 },
        name: "HomePage".into(),
        kind: ProgramUnitKind::Component,
        semantic: Default::default(),
        reactive,
        view,
        plan: Default::default(),
        resource: Default::default(),
        motion: Default::default(),
        lifetime: Default::default(),
        server: Default::default(),
        deployment: DeploymentView {
            status: StubStatus::Partial,
            unit_kind: Some(VmzModuleKind::Page),
            chunk_id: Some("pages/home".into()),
            client_entry: None,
            program_ir: None,
            region_ids: vec![],
            capabilities: vec![],
            server_module_id: None,
            client_calls: vec![],
            resume_entries: vec![],
        },
        graph: Default::default(),
    }
}

#[test]
fn stem_follows_wechat_page_file_layout() {
    assert_eq!(wechat_page_stem("pages/home"), "pages/home/home");
    assert_eq!(wechat_page_stem("pages/index"), "pages/index/index");
}

#[test]
fn emit_matches_rewrite_mini_home_markers() {
    let (wxml, wxss) = emit_wechat_page(&home_unit(), ".page { padding: 24rpx; }\n").expect("ok");
    assert!(wxml.contains("<view class=\"page\">"), "{wxml}");
    assert!(wxml.contains("bindtap=\"onStore\""), "{wxml}");
    assert!(wxml.contains("wx:for=\"{{b.B_3}}\""), "{wxml}");
    assert!(wxml.contains("{{item.title}}"), "{wxml}");
    assert!(!wxml.contains("@click"), "{wxml}");
    assert!(wxss.contains("24rpx"), "{wxss}");
}

#[test]
fn writes_pages_under_dist_wechat() {
    let nanos =
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("vmz-wechat-pack-{nanos}"));
    fs::create_dir_all(dir.join("dist")).unwrap();
    let module = ProgramModule {
        schema: PROGRAM_SCHEMA.into(),
        source: "src/pages/home.vmz".into(),
        units: vec![home_unit()],
    };
    let body = serde_json::to_string_pretty(&module).unwrap();
    fs::write(dir.join("dist").join("home.program.json"), body).unwrap();
    fs::write(dir.join("dist").join("vmz.css"), ".page { color: #3d6b2f; }\n").unwrap();

    let report = lower_miniprogram_wechat_packaging(&dir);
    assert!(report.status == vmz_protocol::CheckReportStatus::Ready, "{:?}", report.diagnostics);
    assert_eq!(report.pack_root, "dist/wechat");
    let wxml_path = dir.join("dist/wechat/pages/home/home.wxml");
    let wxss_path = dir.join("dist/wechat/pages/home/home.wxss");
    let page_js = dir.join("dist/wechat/pages/home/home.js");
    let app_json = dir.join("dist/wechat/app.json");
    let app_js = dir.join("dist/wechat/app.js");
    let project = dir.join("dist/wechat/project.config.json");
    let wxml = fs::read_to_string(&wxml_path).unwrap();
    let wxss = fs::read_to_string(&wxss_path).unwrap();
    assert!(wxml.contains("bindtap=\"onStore\""), "{wxml}");
    assert!(wxss.contains("#3d6b2f") || wxss.contains(".page"), "{wxss}");
    assert!(
        fs::read_to_string(&page_js).unwrap().contains("onShareAppMessage"),
        "{}",
        fs::read_to_string(&page_js).unwrap()
    );
    assert!(
        fs::read_to_string(&app_js).unwrap().contains("App("),
        "{}",
        fs::read_to_string(&app_js).unwrap()
    );
    let project_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(project).unwrap()).unwrap();
    assert_eq!(project_json["compileType"].as_str(), Some("miniprogram"), "{project_json}");
    assert_eq!(project_json["miniprogramRoot"].as_str(), Some("./"), "{project_json}");
    let app: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(app_json).unwrap()).unwrap();
    assert!(
        app["pages"].as_array().unwrap().iter().any(|p| p.as_str() == Some("pages/home/home")),
        "{app}"
    );
    let _ = fs::remove_dir_all(&dir);
}
