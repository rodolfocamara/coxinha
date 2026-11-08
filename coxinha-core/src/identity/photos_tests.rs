use super::*;

const NOW: i64 = 1_800_000_000;
const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3];
const INVITED: &str = "Participant in meetings from your calendar";

fn invitee(name: &str, mail: &str) -> PhotoInvitee {
    PhotoInvitee {
        name: name.into(),
        mail: mail.into(),
    }
}

fn store() -> Result<(tempfile::TempDir, Store)> {
    let dir = tempfile::tempdir()?;
    let store = Store::open(dir.path())?;
    Ok((dir, store))
}

fn files(store: &Store) -> usize {
    std::fs::read_dir(store.photos_dir()).map_or(0, |entries| entries.count())
}

#[test]
fn off_by_default_nothing_is_due_or_written() -> Result<()> {
    let (_d, s) = store()?;
    let id = s.create_person("Ana Souza", &[], INVITED)?;
    assert_eq!(s.photo_status()?, PhotoStatus::default());
    let invitees = [invitee("Ana Souza", "ana@example.test")];
    assert!(s.photo_due(&invitees, NOW, 10)?.is_empty());
    assert!(!s.photo_record(&id, NOW, Some(JPEG))?);
    assert_eq!(files(&s), 0);
    assert_eq!(s.photo_read(&id)?, None);
    Ok(())
}

#[test]
fn only_people_imported_from_invitees_with_a_known_mail_are_due() -> Result<()> {
    let (_d, s) = store()?;
    s.photo_enable()?;
    let imported = s.create_person("Ana Souza", &[], INVITED)?;
    s.create_person("Typed Person", &[], "Typed by the owner")?;
    s.create_person("No Mail", &[], INVITED)?;
    let invitees = [
        invitee("ana  SOUZA", " Ana@Example.test "),
        invitee("Typed Person", "typed@example.test"),
    ];
    assert_eq!(
        s.photo_due(&invitees, NOW, 10)?,
        [DuePhoto {
            person_id: imported,
            mail: "ana@example.test".into()
        }]
    );
    Ok(())
}

#[test]
fn a_name_with_two_mails_is_skipped() -> Result<()> {
    let (_d, s) = store()?;
    s.photo_enable()?;
    s.create_person("Ana Souza", &[], INVITED)?;
    let invitees = [
        invitee("Ana Souza", "ana@example.test"),
        invitee("Ana Souza", "ana.other@example.test"),
        invitee("Ana Souza", "ana@example.test"),
    ];
    assert!(s.photo_due(&invitees, NOW, 10)?.is_empty());
    Ok(())
}

#[test]
fn a_photo_is_not_asked_again_within_the_week() -> Result<()> {
    let (_d, s) = store()?;
    s.photo_enable()?;
    let id = s.create_person("Ana Souza", &[], INVITED)?;
    let invitees = [invitee("Ana Souza", "ana@example.test")];
    assert!(s.photo_record(&id, NOW, Some(JPEG))?);
    assert!(s
        .photo_due(&invitees, NOW + WEEK_SECONDS - 1, 10)?
        .is_empty());
    assert_eq!(s.photo_due(&invitees, NOW + WEEK_SECONDS, 10)?.len(), 1);
    assert_eq!(
        s.photo_read(&id)?,
        Some(("image/jpeg".into(), JPEG.to_vec()))
    );
    Ok(())
}

#[test]
fn no_photo_is_remembered_for_the_week_and_drops_an_older_photo() -> Result<()> {
    let (_d, s) = store()?;
    s.photo_enable()?;
    let id = s.create_person("Ana Souza", &[], INVITED)?;
    let invitees = [invitee("Ana Souza", "ana@example.test")];
    s.photo_record(&id, NOW, Some(JPEG))?;
    let later = NOW + WEEK_SECONDS;
    assert!(s.photo_record(&id, later, None)?);
    assert!(s.photo_due(&invitees, later + 60, 10)?.is_empty());
    assert_eq!(s.photo_due(&invitees, later + WEEK_SECONDS, 10)?.len(), 1);
    assert_eq!(s.photo_read(&id)?, None);
    assert_eq!(s.photo_status()?.stored, 0);
    assert_eq!(files(&s), 0);
    Ok(())
}

#[test]
fn only_jpeg_and_png_are_kept() -> Result<()> {
    let (_d, s) = store()?;
    s.photo_enable()?;
    let id = s.create_person("Ana Souza", &[], INVITED)?;
    assert!(s.photo_record(&id, NOW, Some(b"<svg onload=x>"))?);
    assert_eq!(s.photo_read(&id)?, None);
    let oversized = [JPEG, &vec![0; MAX_PHOTO_BYTES]].concat();
    assert!(s.photo_record(&id, NOW, Some(&oversized))?);
    assert_eq!(s.photo_read(&id)?, None);
    let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0];
    assert!(s.photo_record(&id, NOW, Some(&png))?);
    assert_eq!(
        s.photo_read(&id)?.map(|(media, _)| media).as_deref(),
        Some("image/png")
    );
    Ok(())
}

#[test]
fn a_bad_person_id_never_reaches_the_filesystem() -> Result<()> {
    let (_d, s) = store()?;
    s.photo_enable()?;
    assert!(!s.photo_record("../../escape", NOW, Some(JPEG))?);
    assert_eq!(s.photo_read("../../escape")?, None);
    assert_eq!(files(&s), 0);
    Ok(())
}

#[test]
fn the_photo_leaves_with_the_person() -> Result<()> {
    let (_d, s) = store()?;
    s.photo_enable()?;
    let gone = s.create_person("Ana Souza", &[], INVITED)?;
    let kept = s.create_person("Bruno Lima", &[], INVITED)?;
    s.photo_record(&gone, NOW, Some(JPEG))?;
    s.photo_record(&kept, NOW, Some(JPEG))?;
    s.profiles
        .execute("DELETE FROM person WHERE id=?1", [&gone])?;
    assert_eq!(s.photo_read(&gone)?, None);
    s.photo_sweep()?;
    assert_eq!(files(&s), 1);
    assert!(s.photo_read(&kept)?.is_some());
    assert!(!s.photo_record(&gone, NOW, Some(JPEG))?);
    assert_eq!(s.photo_index()?.len(), 1);
    Ok(())
}

#[test]
fn the_opt_out_deletes_every_photo_and_stops_late_downloads() -> Result<()> {
    let (_d, s) = store()?;
    s.photo_enable()?;
    let id = s.create_person("Ana Souza", &[], INVITED)?;
    s.photo_record(&id, NOW, Some(JPEG))?;
    assert_eq!(s.photo_status()?.stored, 1);
    s.photo_disable()?;
    assert!(!s.photos_dir().exists());
    assert_eq!(s.photo_status()?, PhotoStatus::default());
    assert!(s.photo_index()?.is_empty());
    assert!(!s.photo_record(&id, NOW, Some(JPEG))?);
    assert!(!s.photos_dir().exists());
    // A new opt-in starts over: nothing is remembered about the earlier one.
    s.photo_enable()?;
    let invitees = [invitee("Ana Souza", "ana@example.test")];
    assert_eq!(s.photo_due(&invitees, NOW, 10)?.len(), 1);
    Ok(())
}

#[test]
fn files_left_by_an_interrupted_opt_out_are_swept() -> Result<()> {
    let (_d, s) = store()?;
    std::fs::create_dir_all(s.photos_dir())?;
    std::fs::write(s.photos_dir().join("left-behind"), JPEG)?;
    assert!(s.photo_due(&[], NOW, 10)?.is_empty());
    assert!(!s.photos_dir().exists());
    Ok(())
}

#[test]
fn a_block_stays_until_a_new_consent_and_a_pause_until_its_time() -> Result<()> {
    let (_d, s) = store()?;
    s.photo_enable()?;
    s.create_person("Ana Souza", &[], INVITED)?;
    let invitees = [invitee("Ana Souza", "ana@example.test")];
    s.photo_pause(NOW + 60)?;
    assert!(s.photo_due(&invitees, NOW, 10)?.is_empty());
    assert_eq!(s.photo_due(&invitees, NOW + 60, 10)?.len(), 1);
    s.photo_block("calendar.photosForbidden")?;
    assert!(s.photo_due(&invitees, NOW + WEEK_SECONDS, 10)?.is_empty());
    assert_eq!(
        s.photo_status()?.blocked.as_deref(),
        Some("calendar.photosForbidden")
    );
    s.photo_enable()?;
    assert_eq!(s.photo_status()?.blocked, None);
    assert_eq!(s.photo_due(&invitees, NOW, 10)?.len(), 1);
    Ok(())
}

#[test]
fn oldest_checks_come_first_up_to_the_limit() -> Result<()> {
    let (_d, s) = store()?;
    s.photo_enable()?;
    let checked = s.create_person("Ana Souza", &[], INVITED)?;
    let fresh = s.create_person("Bruno Lima", &[], INVITED)?;
    s.photo_record(&checked, NOW, None)?;
    let invitees = [
        invitee("Ana Souza", "ana@example.test"),
        invitee("Bruno Lima", "bruno@example.test"),
    ];
    let due = s.photo_due(&invitees, NOW + WEEK_SECONDS, 1)?;
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].person_id, fresh);
    Ok(())
}

#[test]
fn origins_follow_the_import_texts_in_both_locales() -> Result<()> {
    let en: serde_json::Value = serde_json::from_str(include_str!("../../../src/locales/en.json"))?;
    let pt: serde_json::Value =
        serde_json::from_str(include_str!("../../../src/locales/pt-BR.json"))?;
    let people_en: serde_json::Value =
        serde_json::from_str(include_str!("../../../src/locales/areas/people.en.json"))?;
    let people_pt: serde_json::Value =
        serde_json::from_str(include_str!("../../../src/locales/areas/people.pt-BR.json"))?;
    for text in [
        &en["speakers"]["inviteeConsent"],
        &pt["speakers"]["inviteeConsent"],
        &people_en["people"]["import"]["consent"],
        &people_pt["people"]["import"]["consent"],
    ] {
        let text = text.as_str().unwrap_or("missing locale key");
        assert!(INVITEE_ORIGINS.contains(&text), "{text}");
    }
    Ok(())
}
