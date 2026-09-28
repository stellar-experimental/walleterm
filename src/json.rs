//! JSON helpers shared by the CLI and the bridge.

use std::fmt;

use serde::de::{self, Deserializer, MapAccess, Visitor};
use serde_json::{Map, Value};

/// Walk any JSON value and reject a repeated key in any object.
pub struct NoDuplicates;

impl<'de> de::Deserialize<'de> for NoDuplicates {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        deserializer.deserialize_any(NoDuplicates)
    }
}

impl<'de> Visitor<'de> for NoDuplicates {
    type Value = NoDuplicates;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("JSON")
    }
    fn visit_bool<E>(self, _: bool) -> std::result::Result<Self, E> {
        Ok(self)
    }
    fn visit_i64<E>(self, _: i64) -> std::result::Result<Self, E> {
        Ok(self)
    }
    fn visit_u64<E>(self, _: u64) -> std::result::Result<Self, E> {
        Ok(self)
    }
    fn visit_f64<E>(self, _: f64) -> std::result::Result<Self, E> {
        Ok(self)
    }
    fn visit_str<E>(self, _: &str) -> std::result::Result<Self, E> {
        Ok(self)
    }
    fn visit_unit<E>(self) -> std::result::Result<Self, E> {
        Ok(self)
    }
    fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> std::result::Result<Self, A::Error> {
        while seq.next_element::<NoDuplicates>()?.is_some() {}
        Ok(self)
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> std::result::Result<Self, A::Error> {
        let mut seen = std::collections::HashSet::new();
        while let Some(key) = map.next_key::<String>()? {
            if !seen.insert(key) {
                return Err(de::Error::custom("duplicate"));
            }
            map.next_value::<NoDuplicates>()?;
        }
        Ok(self)
    }
}

/// `true` when no object anywhere in `text` repeats a key. Invalid JSON returns `false`.
pub fn no_duplicates(text: &str) -> bool {
    serde_json::from_str::<NoDuplicates>(text).is_ok()
}

/// One JSON object with no repeated key at any depth.
pub fn strict_object(text: &str) -> Option<Map<String, Value>> {
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(object)) if no_duplicates(text) => Some(object),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicates_fail_at_any_depth() {
        assert!(strict_object(r#"{"a":1,"b":{"c":[{"d":1}]}}"#).is_some());
        assert!(strict_object(r#"{"a":1,"a":2}"#).is_none());
        assert!(strict_object(r#"{"a":{"b":1,"b":1}}"#).is_none());
        assert!(strict_object(r#"{"a":[{"b":1,"\u0062":2}]}"#).is_none());
        assert!(strict_object("[]").is_none());
        assert!(strict_object("{").is_none());
    }
}
