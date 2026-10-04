//! Conservative row-kernel hook.
use vmz_types::{ViewAttr, ViewNode};
/// Return no specialized kernel until Oak structural lowering proves eligibility.
pub fn try_emit_row_kernel_js(_tag: &str, _attrs: &[ViewAttr], _children: &[ViewNode], _as_name: &str, _box_id: &str, _fields: &[String], _scope: &[String], _aliases: &[(String, String)], _key_bound: Option<&str>) -> Option<String> { None }
