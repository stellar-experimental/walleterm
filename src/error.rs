use std::fmt;

/// A stable machine code with a readable message.
/// CLI codes (`invalid_input`, `timeout`, ...) and SEP-43 reasons (`invalid_request`, ...) share this type.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    pub code: &'static str,
    pub message: String,
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Error {}

pub(crate) fn fail<T>(code: &'static str, message: &str) -> Result<T> {
    Err(Error::new(code, message))
}
