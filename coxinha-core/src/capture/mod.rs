//! Arrival-clock capture. Device clock drift is deliberately not claimed as corrected.
mod committed;
mod endpoint_capture;
mod endpoints;
#[cfg(target_os = "linux")]
mod pulse;
mod reconcile;
mod recording;
#[cfg(windows)]
mod windows_audio;
pub use committed::{CommittedTrack, MAX_READ_FRAMES};
pub use endpoint_capture::EndpointCapture;
pub use endpoints::Source;
#[cfg(target_os = "linux")]
pub use pulse::PulseCapture;
#[cfg(target_os = "linux")]
mod sources;
pub use reconcile::OrphanReport;
pub use recording::{CaptureManifest, Recording, Track};
#[cfg(target_os = "linux")]
pub use sources::list_sources;
#[cfg(windows)]
pub use windows_audio::list_sources;
/// The platform's capture adapter: PipeWire on Linux, WASAPI on Windows.
#[cfg(target_os = "linux")]
pub type DeviceCapture = PulseCapture;
#[cfg(windows)]
pub type DeviceCapture = EndpointCapture;

mod imported;
pub use recording::TrackCheckpoint;
