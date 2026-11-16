//! JSON helpers shared by the CLI and the bridge.

use std::fmt;

use serde::de::{self, Deserializer, MapAccess, Visitor};
use serde_json::{Map, Value};

/// A JSON value read with a check for repeated keys. `clean` is false when any object inside repeats a key.
/// An object that repeats a key has no `value`. An array keeps its other items.
pub struct Strict {
    pub value: Option<Value>,
    pub clean: bool,
}

impl Strict {
    fn of(value: Value) -> Self {
        Self { value: Some(value), clean: true }
    }
}

impl<'de> de::Deserialize<'de> for Strict {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        deserializer.deserialize_any(StrictVisitor)
    }
}

struct StrictVisitor;

impl<'de> Visitor<'de> for StrictVisitor {
    type Value = Strict;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("JSON")
    }
    fn visit_bool<E>(self, b: bool) -> std::result::Result<Strict, E> {
        Ok(Strict::of(Value::Bool(b)))
    }
    fn visit_i64<E>(self, n: i64) -> std::result::Result<Strict, E> {
        Ok(Strict::of(n.into()))
    }
    fn visit_u64<E>(self, n: u64) -> std::result::Result<Strict, E> {
        Ok(Strict::of(n.into()))
    }
    fn visit_f64<E>(self, n: f64) -> std::result::Result<Strict, E> {
        Ok(Strict::of(n.into()))
    }
    fn visit_str<E>(self, s: &str) -> std::result::Result<Strict, E> {
        Ok(Strict::of(s.into()))
    }
    fn visit_unit<E>(self) -> std::result::Result<Strict, E> {
        Ok(Strict::of(Value::Null))
    }
    fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> std::result::Result<Strict, A::Error> {
        let (mut items, mut clean) = (Vec::new(), true);
        while let Some(item) = seq.next_element::<Strict>()? {
            clean &= item.clean;
            items.extend(item.value);
        }
        Ok(Strict { value: Some(Value::Array(items)), clean })
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> std::result::Result<Strict, A::Error> {
        let (mut object, mut clean, mut whole) = (Map::new(), true, true);
        while let Some(key) = map.next_key::<String>()? {
            let item = map.next_value::<Strict>()?;
            clean &= item.clean;
            match item.value {
                Some(value) if !object.contains_key(&key) => drop(object.insert(key, value)),
                _ => (clean, whole) = (false, false),
            }
        }
        Ok(Strict { value: whole.then_some(Value::Object(object)), clean })
    }
}

/// `true` when no object anywhere in `text` repeats a key. Invalid JSON returns `false`.
pub fn no_duplicates(text: &str) -> bool {
    serde_json::from_str::<Strict>(text).is_ok_and(|s| s.clean)
}

/// One JSON object with no repeated key at any depth.
pub fn strict_object(text: &str) -> Option<Map<String, Value>> {
    match serde_json::from_str::<Strict>(text) {
        Ok(Strict { value: Some(Value::Object(object)), clean: true }) => Some(object),
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
