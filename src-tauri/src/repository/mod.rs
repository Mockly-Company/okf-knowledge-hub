//! Token-free repository operations.
//!
//! Raw credentials and git adapter ports are intentionally crate-private.
//!
//! ```compile_fail
//! use okhub_lib::repository::service::GitRepositoryPort;
//! ```

pub(crate) mod git2_adapter;
pub mod model;
pub mod service;
