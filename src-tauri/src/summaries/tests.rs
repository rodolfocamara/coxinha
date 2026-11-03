use super::*;

#[test]
fn summaries_need_the_title_endpoint_and_their_own_opt_in() {
    let mut settings = TitleLlmSettings::default();
    assert!(!settings.summaries, "off by default");
    assert!(!allowed(&settings));
    settings.enabled = true;
    assert!(!allowed(&settings));
    settings.summaries = true;
    assert!(allowed(&settings));
    settings.enabled = false;
    assert!(!allowed(&settings));
    let old: TitleLlmSettings = serde_json::from_str(r#"{"enabled":true}"#).unwrap();
    assert!(!old.summaries, "settings saved before 0108 stay off");
}

#[test]
fn failed_meetings_wait_their_backoff_and_success_clears_it() {
    let mut retry = Retry::default();
    let now = Instant::now();
    retry.failed("m1", now);
    assert_eq!(retry.waiting(now), vec!["m1".to_string()]);
    assert!(retry.waiting(now + Duration::from_secs(61)).is_empty());
    retry.failed("m1", now);
    assert_eq!(
        retry.waiting(now + Duration::from_secs(61)),
        vec!["m1".to_string()]
    );
    retry.succeeded("m1");
    assert!(retry.waiting(now).is_empty());
}
