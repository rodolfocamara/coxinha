use super::*;

#[test]
fn the_window_reads_30_days_back_and_180_ahead() {
    let now = Utc::now();
    let (from, to) = window(now);
    assert_eq!(now - from, Duration::days(30));
    assert_eq!(to - now, Duration::days(180));
}

#[test]
fn the_sync_asks_for_the_details_and_keeps_what_it_read() {
    let fields: Vec<&str> = SELECT.split(',').collect();
    for field in [
        "responseStatus",
        "attendees",
        "location",
        "onlineMeeting",
        "bodyPreview",
        "showAs",
        "isOrganizer",
        "webLink",
        "allowNewTimeProposals",
        "responseRequested",
        "id",
        "subject",
        "start",
        "end",
        "isCancelled",
        "isAllDay",
        "organizer",
        "seriesMasterId",
        "type",
        "originalStart",
        "categories",
    ] {
        assert!(fields.contains(&field), "{field}");
    }
}

#[test]
fn paging_limits_hold_for_the_wider_window() {
    // 3.4 events a day measured on the owner's mailbox on 2026-11-03.
    const DAYS: usize = (DAYS_BACK + DAYS_AHEAD) as usize;
    const {
        assert!(PAGE_SIZE * MAX_PAGES >= MAX_EVENTS);
        assert!(DAYS * 4 < MAX_EVENTS / 5);
    }
}
