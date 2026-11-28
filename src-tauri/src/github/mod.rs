//! Token-free GitHub repository operations.
//!
//! The raw HTTP request and bearer-token transport boundary is intentionally
//! private to this module.
//!
//! ```compile_fail
//! use okhub_lib::github::client::HttpRequest;
//! ```

mod client;
#[cfg(test)]
pub(crate) use client::automation_test_support;
pub mod model;

pub use client::GithubService;
