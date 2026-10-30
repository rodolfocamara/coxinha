use std::{error::Error, fmt};
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CurationError {
    Capacity,
    Refresh,
    Busy,
    InventoryRow,
    Cursor,
}
impl fmt::Display for CurationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Capacity => "voice_curation_capacity_exceeded",
            Self::Refresh => "voice_curation_refresh_required",
            Self::Busy => "voice_curation_busy",
            Self::InventoryRow => "voice_curation_inventory_row_invalid",
            Self::Cursor => "voice_curation_cursor_invalid",
        })
    }
}
impl Error for CurationError {}
