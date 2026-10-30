//! 解析身份层：specifier + importer 上下文 → 唯一模块身份。
//! 覆盖相对解析、`node_modules` 上溯、`exports`/`imports` 条件与封装、
//! 同名不同实例的包身份区分；不读模块语义，只解析身份。
