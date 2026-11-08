//! Arrival-clock capture. Device clock drift is deliberately not claimed as corrected.
mod committed;
#[cfg(target_os = "linux")]
mod pulse;
mod reconcile;
mod recording;
pub use committed::{CommittedTrack, MAX_READ_FRAMES};
#[cfg(target_os = "linux")]
pub use pulse::PulseCapture;
#[cfg(target_os = "linux")]
mod sources;
pub use reconcile::OrphanReport;
pub use recording::{CaptureManifest, Recording, Track};
#[cfg(target_os = "linux")]
pub use sources::{list_sources, Source};

mod imported;
pub use recording::TrackCheckpoint;
