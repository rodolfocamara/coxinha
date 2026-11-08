use super::*;
use serde_json::json;

#[test]
fn presets_map_to_outlook_colour_indexes() {
    assert_eq!(preset("preset0"), Some(0));
    assert_eq!(preset("preset7"), Some(7));
    assert_eq!(preset("Preset24"), Some(24));
    for raw in [
        "none", "None", "preset25", "preset", "preset-1", "preset+1", "red", "",
    ] {
        assert_eq!(preset(raw), None, "{raw}");
    }
}

#[test]
fn master_list_keeps_names_and_colours_and_skips_blank_names() {
    let page = json!({"value": [
        {"id": "1", "displayName": "Architect", "color": "preset7"},
        {"id": "2", "displayName": " CTO ", "color": "preset0"},
        {"id": "3", "displayName": "Plain", "color": "none"},
        {"id": "4", "displayName": "  ", "color": "preset1"},
        {"id": "5", "color": "preset2"}
    ]});
    assert_eq!(
        parse_master(&page).unwrap(),
        vec![
            Category {
                name: "Architect".into(),
                preset: Some(7)
            },
            Category {
                name: "CTO".into(),
                preset: Some(0)
            },
            Category {
                name: "Plain".into(),
                preset: None
            },
        ]
    );
    assert!(parse_master(&json!({"error": {}})).is_err());
}

#[test]
fn events_carry_their_category_names_in_order() {
    let item = json!({"id":"e1","subject":"Weekly","start":{"dateTime":"2026-11-02T12:00:00","timeZone":"UTC"},"end":{"dateTime":"2026-11-02T13:00:00","timeZone":"UTC"},"isCancelled":false,"isAllDay":false,"attendees":[],"categories":["Manager"," ","UX"]});
    assert_eq!(
        parse_event(&item).unwrap().categories,
        vec!["Manager", "UX"]
    );
    let mut legacy = item.clone();
    legacy.as_object_mut().unwrap().remove("categories");
    assert!(parse_event(&legacy).unwrap().categories.is_empty());
}

#[test]
fn old_caches_without_categories_still_load() {
    let cached: Snapshot = serde_json::from_value(json!({
        "account": "sub", "syncedAt": null,
        "events": [{"id":"e","title":"T","startsAt":"2026-11-02T12:00:00Z","endsAt":"2026-11-02T13:00:00Z","cancelled":false,"allDay":false,"attendees":[]}]
    }))
    .unwrap();
    assert!(cached.categories.is_empty());
    assert!(cached.events[0].categories.is_empty());
    assert_eq!(cached.category_access, CategoryAccess::default());
}

#[test]
fn granted_scopes_decide_read_and_write() {
    let old = "https://graph.microsoft.com/Calendars.ReadBasic openid offline_access";
    assert_eq!(
        granted(Some(old)),
        Some(CategoryAccess {
            read: false,
            write: false
        })
    );
    let full = "https://graph.microsoft.com/Calendars.ReadBasic https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/MailboxSettings.Read";
    assert_eq!(
        granted(Some(full)),
        Some(CategoryAccess {
            read: true,
            write: true
        })
    );
    assert_eq!(
        granted(Some("mailboxsettings.readwrite Calendars.Read")),
        Some(CategoryAccess {
            read: true,
            write: false
        })
    );
    // Calendars.ReadWrite.Shared is not this account's own calendar write.
    assert_eq!(
        granted(Some("Calendars.ReadWrite.Shared")).map(|a| a.write),
        Some(false)
    );
    assert_eq!(granted(None), None);
}

fn snapshot_with(categories: Vec<Category>, access: CategoryAccess) -> Snapshot {
    Snapshot {
        categories,
        category_access: access,
        ..Snapshot::default()
    }
}

#[test]
fn missing_scope_reads_as_reconnect_and_failures_keep_the_last_list() {
    let architect = Category {
        name: "Architect".into(),
        preset: Some(7),
    };
    let full = CategoryAccess {
        read: true,
        write: true,
    };
    let previous = snapshot_with(vec![architect.clone()], full);

    let mut listed = Snapshot::default();
    apply_master(
        &mut listed,
        Some(full),
        Master::Listed(vec![architect.clone()]),
        None,
    );
    assert_eq!(listed.categories, vec![architect.clone()]);
    assert_eq!(listed.category_access, full);

    let mut forbidden = Snapshot::default();
    apply_master(&mut forbidden, None, Master::Forbidden, Some(&previous));
    assert_eq!(
        forbidden.category_access,
        CategoryAccess {
            read: false,
            write: false
        }
    );
    assert!(forbidden.categories.is_empty());

    let mut failed = Snapshot::default();
    apply_master(&mut failed, Some(full), Master::Failed, Some(&previous));
    assert_eq!(failed.categories, vec![architect]);
    assert!(failed.category_access.read);

    let mut first = Snapshot::default();
    apply_master(&mut first, Some(full), Master::Failed, None);
    assert!(first.categories.is_empty());
    assert!(!first.category_access.read);
}

#[test]
fn patch_body_and_url_are_exact() {
    let names = clean(vec![" UX ".into(), "ux".into(), "".into(), "CTO".into()]).unwrap();
    assert_eq!(names, vec!["UX", "CTO"]);
    assert_eq!(patch_body(&names), json!({"categories": ["UX", "CTO"]}));
    assert_eq!(patch_body(&[]), json!({"categories": []}));
    assert!(clean((0..26).map(|n| format!("c{n}")).collect()).is_err());

    let url = event_url("AAMk/a+b=").unwrap();
    assert_eq!(url.host_str(), Some("graph.microsoft.com"));
    assert_eq!(url.path(), "/v1.0/me/events/AAMk%2Fa+b=");
    assert!(event_url("").is_err());
    assert!(event_url("../me")
        .unwrap()
        .path()
        .starts_with("/v1.0/me/events/"));
}

#[test]
fn a_successful_change_rewrites_only_that_cached_event() {
    let event = |id: &str| -> Event {
        serde_json::from_value(json!({"id": id, "title": id, "startsAt": "2026-11-02T12:00:00Z", "endsAt": "2026-11-02T13:00:00Z", "cancelled": false, "allDay": false, "attendees": [], "categories": ["CTO"]})).unwrap()
    };
    let mut snapshot = Snapshot {
        events: vec![event("a"), event("b")],
        ..Snapshot::default()
    };
    assert!(apply_categories(&mut snapshot, "b", &["UX".into()]));
    assert_eq!(snapshot.events[0].categories, vec!["CTO"]);
    assert_eq!(snapshot.events[1].categories, vec!["UX"]);
    assert!(!apply_categories(&mut snapshot, "missing", &[]));
}

#[test]
fn refresh_keeps_the_scope_old_connections_consented_to() {
    assert_eq!(
        REFRESH_SCOPE,
        "https://graph.microsoft.com/Calendars.ReadBasic openid offline_access"
    );
    for scope in REFRESH_SCOPE.split(' ') {
        assert!(AUTHORIZE_SCOPE.split(' ').any(|s| s == scope));
    }
    assert_eq!(
        granted(Some(AUTHORIZE_SCOPE)),
        Some(CategoryAccess {
            read: true,
            write: true
        })
    );
}
