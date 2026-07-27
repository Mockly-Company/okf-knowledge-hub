//! Token-free GitHub repository operations.
//!
//! The raw HTTP request and bearer-token transport boundary is intentionally
//! private to this module.
//!
//! ```compile_fail
//! use okhub_lib::github::client::HttpRequest;
//! ```

mod client;
pub mod model;

pub use client::GithubService;
