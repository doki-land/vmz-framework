//! 保序 JSON 值。
//!
//! `exports`/`imports` 的条件对象必须按 package.json 中的**书写顺序**逐键匹配
//! （Node 语义：条件顺序是作者责任）。`serde_json::Value` 的默认 Map 是
//! `BTreeMap`（按键字典序），会把 `{ "node", "import", "default" }` 之类的
//! 条件顺序打乱，因此这里手写一个顺序敏感的 `Deserialize` 收集为
//! `Vec<(String, Json)>`，object 键严格按文档出现顺序入列。

use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Json {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Json>),
    /// 键按 package.json 书写顺序排列。
    Object(Vec<(String, Json)>),
}

impl Json {
    pub(crate) fn as_str(&self) -> Option<&str> {
        match self {
            Json::String(text) => Some(text),
            _ => None,
        }
    }

    pub(crate) fn as_object(&self) -> Option<&[(String, Json)]> {
        match self {
            Json::Object(entries) => Some(entries),
            _ => None,
        }
    }

    pub(crate) fn get(&self, key: &str) -> Option<&Json> {
        self.as_object()?.iter().find(|(name, _)| name == key).map(|(_, value)| value)
    }
}

impl<'de> Deserialize<'de> for Json {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct JsonVisitor;

        impl<'de> Visitor<'de> for JsonVisitor {
            type Value = Json;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("一个 JSON 值")
            }

            fn visit_bool<E: de::Error>(self, value: bool) -> Result<Json, E> {
                Ok(Json::Bool(value))
            }

            fn visit_i64<E: de::Error>(self, value: i64) -> Result<Json, E> {
                Ok(Json::Number(value as f64))
            }

            fn visit_u64<E: de::Error>(self, value: u64) -> Result<Json, E> {
                Ok(Json::Number(value as f64))
            }

            fn visit_f64<E: de::Error>(self, value: f64) -> Result<Json, E> {
                Ok(Json::Number(value))
            }

            fn visit_str<E: de::Error>(self, value: &str) -> Result<Json, E> {
                Ok(Json::String(value.to_string()))
            }

            fn visit_string<E: de::Error>(self, value: String) -> Result<Json, E> {
                Ok(Json::String(value))
            }

            fn visit_unit<E: de::Error>(self) -> Result<Json, E> {
                Ok(Json::Null)
            }

            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Json, A::Error> {
                let mut out = Vec::new();
                while let Some(value) = seq.next_element::<Json>()? {
                    out.push(value);
                }
                Ok(Json::Array(out))
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Json, A::Error> {
                let mut out: Vec<(String, Json)> = Vec::new();
                // 逐键按文档顺序收集，绝不排序。
                while let Some(entry) = map.next_entry::<String, Json>()? {
                    out.push(entry);
                }
                Ok(Json::Object(out))
            }
        }

        deserializer.deserialize_any(JsonVisitor)
    }
}
