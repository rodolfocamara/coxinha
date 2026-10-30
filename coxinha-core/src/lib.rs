//! Local meeting domain. No desktop runtime or implicit network access.
pub mod artifacts;
pub mod capture;
pub mod identity;
pub mod jobs;
pub mod processing;
pub mod speech;
pub mod store;
#[cfg(feature = "stt-whisper")]
pub mod whisper;

pub mod recognition;

pub mod curation;
