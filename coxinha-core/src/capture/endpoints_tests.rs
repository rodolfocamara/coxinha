use super::*;

fn endpoint(id: &str, name: &str) -> Endpoint {
    Endpoint {
        id: id.into(),
        name: name.into(),
    }
}

fn names(sources: &[Source]) -> Vec<&str> {
    sources.iter().map(|s| s.name.as_str()).collect()
}

#[test]
fn defaults_come_first_and_are_not_listed_twice() {
    let inputs = [
        endpoint("{a}", "Laptop mic"),
        endpoint("{b}", "Headset mic"),
    ];
    let outputs = [endpoint("{c}", "Speakers"), endpoint("{d}", "Headset")];
    let sources = build_sources(&inputs, &outputs, Some("{b}"), Some("{c}")).unwrap();
    assert_eq!(
        names(&sources),
        [
            "wasapi:default-input",
            "wasapi:{a}",
            "wasapi:default-output",
            "wasapi:{d}"
        ]
    );
    assert_eq!(sources[0].description, "Headset mic");
    assert!(sources[0].is_default && !sources[0].monitor);
    assert!(!sources[1].is_default);
    assert_eq!(sources[2].description, "Speakers");
    assert!(sources[2].is_default && sources[2].monitor);
    assert!(sources.iter().all(|s| !s.absent));
}

#[test]
fn a_missing_kind_offers_none_and_nothing_at_all_is_an_error() {
    let speakers = [endpoint("{c}", "Speakers")];
    let sources = build_sources(&[], &speakers, None, Some("{c}")).unwrap();
    assert_eq!(
        names(&sources),
        ["wasapi:none-input", "wasapi:default-output"]
    );
    assert!(sources[0].absent && sources[0].is_default && !sources[0].monitor);

    let mic = [endpoint("{a}", "Mic")];
    let sources = build_sources(&mic, &[], Some("{a}"), None).unwrap();
    assert_eq!(
        names(&sources),
        ["wasapi:default-input", "wasapi:none-output"]
    );
    assert!(sources[1].absent && sources[1].monitor);

    let error = build_sources(&[], &[], None, None).unwrap_err().to_string();
    assert!(error.contains("no active audio"), "{error}");
}

#[test]
fn endpoints_without_a_default_stay_explicit() {
    let inputs = [endpoint("{a}", "Mic")];
    let sources = build_sources(&inputs, &inputs, Some("{gone}"), None).unwrap();
    assert_eq!(names(&sources), ["wasapi:{a}", "wasapi:{a}"]);
    assert!(sources.iter().all(|s| !s.is_default));
}

#[test]
fn source_names_parse_by_kind() {
    assert_eq!(
        Choice::parse("wasapi:default-input", false).unwrap(),
        Choice::Default
    );
    assert_eq!(
        Choice::parse("wasapi:none-output", true).unwrap(),
        Choice::Absent
    );
    assert_eq!(
        Choice::parse("wasapi:{0.0.1.00000000}.{x}", false).unwrap(),
        Choice::Endpoint("{0.0.1.00000000}.{x}".into())
    );
    for (name, monitor) in [
        ("wasapi:default-output", false),
        ("wasapi:none-input", true),
        ("wasapi:", false),
        ("alsa_input.pci", false),
    ] {
        assert!(Choice::parse(name, monitor).is_err(), "{name}");
    }
}

#[test]
fn packets_of_any_size_become_ordered_20ms_blocks() {
    let mut framer = Framer::default();
    let samples: Vec<i16> = (0..3000).map(|n| n as i16).collect();
    let mut blocks = Vec::new();
    for packet in samples.chunks(441) {
        blocks.extend(framer.push(packet));
    }
    assert_eq!(blocks.len(), 3);
    assert!(blocks.iter().all(|b| b.len() == BLOCK));
    let joined: Vec<i16> = blocks.concat();
    assert_eq!(joined, samples[..3 * BLOCK]);
    assert_eq!(framer.pending(), 3000 - 3 * BLOCK);
}

#[test]
fn pcm_bytes_decode_little_endian() {
    assert_eq!(
        decode(&[1, 0, 0xff, 0x7f, 0, 0x80, 9]),
        [1, i16::MAX, i16::MIN]
    );
}

#[test]
fn absent_is_omitted_from_json_when_false() {
    let source = Source {
        name: "mic".into(),
        description: "Mic".into(),
        monitor: false,
        is_default: true,
        absent: false,
    };
    assert_eq!(
        serde_json::to_value(&source).unwrap(),
        serde_json::json!({"name":"mic","description":"Mic","monitor":false,"is_default":true})
    );
    let absent = Source {
        absent: true,
        ..source
    };
    assert_eq!(serde_json::to_value(&absent).unwrap()["absent"], true);
}
