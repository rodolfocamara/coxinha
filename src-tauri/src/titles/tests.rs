use super::*;

fn settings(target: &str) -> TitleLlmSettings {
    TitleLlmSettings {
        enabled: true,
        ssh_target: target.into(),
        ..TitleLlmSettings::default()
    }
}

#[test]
fn defaults_are_off_on_port_8000_with_the_owner_model_and_deserialize_partially() {
    let default = TitleLlmSettings::default();
    assert!(!default.enabled);
    assert_eq!(
        (
            default.ssh_target.as_str(),
            default.remote_port,
            default.model.as_str()
        ),
        ("", 8000, "qwen3.5-4b")
    );
    assert_eq!(default.validate(), Ok(()));
    let parsed: TitleLlmSettings =
        serde_json::from_str(r#"{"enabled":true,"sshTarget":"me@mac"}"#).unwrap();
    assert_eq!(parsed, settings("me@mac"));
}

#[test]
fn validate_accepts_user_at_hostname_ipv4_and_ipv6() {
    for target in [
        "macserver@192.168.15.66",
        "macserver@macserver.local",
        "a.b-c_d@mac",
        "me@fe80::1",
    ] {
        assert_eq!(settings(target).validate(), Ok(()), "{target}");
    }
}

#[test]
fn validate_rejects_option_injection_whitespace_and_malformed_targets() {
    for target in [
        "",
        "-oProxyCommand=sh@host",
        "macserver@-oProxyCommand=sh",
        "macserver@host extra",
        "macserver @host",
        "macserver@host\n",
        "macserver@host\u{7}",
        "@192.168.15.66",
        "192.168.15.66",
        "macserver@",
        "macserver@999.1.1.1",
        "macserver@host-.local",
        "macserver@host..local",
        "macserver@host_name",
        "a@b@c",
    ] {
        assert!(
            settings(target).validate().is_err(),
            "{target:?} must be rejected"
        );
    }
}

#[test]
fn validate_checks_port_and_model_even_when_disabled() {
    let mut s = TitleLlmSettings {
        remote_port: 0,
        ..TitleLlmSettings::default()
    };
    assert!(s.validate().is_err());
    s.remote_port = 8000;
    s.model = " ".into();
    assert!(s.validate().is_err());
    s.model = "qwen".into();
    s.ssh_target = "-x".into();
    assert!(
        s.validate().is_err(),
        "a typed target is validated while off"
    );
}

#[test]
fn ssh_args_use_stdio_forwarding_hardened_options_and_end_options_before_the_target() {
    let args: Vec<String> = ssh_args(&TitleLlmSettings {
        remote_port: 8123,
        ..settings("macserver@192.168.15.66")
    })
    .into_iter()
    .map(|a| a.into_string().unwrap())
    .collect();
    let expected = "-W 127.0.0.1:8123 -o BatchMode=yes -o ControlMaster=no -o ControlPath=none \
        -o StrictHostKeyChecking=yes -o ConnectTimeout=5 -o ServerAliveInterval=5 \
        -o ForwardAgent=no -o PermitLocalCommand=no -o ClearAllForwardings=yes \
        -- macserver@192.168.15.66";
    assert_eq!(args.join(" "), expected);
    assert!(
        !args.iter().any(|a| a == "-L" || a == "-R" || a == "-D"),
        "no listener"
    );
}

#[tokio::test]
async fn disabled_or_invalid_settings_never_start_ssh() {
    let missing = OsStr::new("/nonexistent/ssh");
    let off = TitleLlmSettings {
        enabled: false,
        ..settings("me@mac")
    };
    let err = suggest_with(missing, &[], &off, "[00:01] oi", TIMEOUT)
        .await
        .unwrap_err();
    assert!(err.contains("disabled"), "{err}");
    let err = suggest_with(missing, &[], &settings("-bad"), "[00:01] oi", TIMEOUT)
        .await
        .unwrap_err();
    assert!(err.contains("user@host"), "{err}");
    let err = suggest_with(missing, &[], &settings("me@mac"), "  ", TIMEOUT)
        .await
        .unwrap_err();
    assert!(err.contains("empty"), "{err}");
}

#[cfg(unix)]
#[tokio::test]
async fn suggest_sanitizes_the_model_answer() {
    let json = r#"{"choices":[{"message":{"role":"assistant","content":"<think>hmm</think>\n\"**Revis\u00e3o do CRM**\""}}]}"#;
    let script = format!(
        "printf 'HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nContent-Length: {}\\r\\n\\r\\n%s' '{}'; cat >/dev/null",
        json.len(),
        json
    );
    let args: Vec<OsString> = vec!["-c".into(), script.into()];
    let title = suggest_with(
        OsStr::new("sh"),
        &args,
        &settings("me@mac"),
        "[00:01] oi",
        TIMEOUT,
    )
    .await
    .unwrap();
    assert_eq!(title, "Revis\u{e3}o do CRM");
}

/// Talks to the owner's macserver with a synthetic excerpt (no user data).
/// Run with `cargo test -p coxinha titles -- --ignored --nocapture`.
#[tokio::test]
#[ignore = "needs the macserver on the LAN and non-interactive SSH"]
async fn live_macserver_suggests_a_title() {
    let lines: Vec<TranscriptLine> = [
        (
            1_000,
            "Ana",
            "Bom dia, hoje vamos revisar a migracao do CRM para a API v2.",
        ),
        (
            20_000,
            "Bruno",
            "O cutover esta marcado para sexta, depois do fechamento do mes.",
        ),
        (
            45_000,
            "Ana",
            "Precisamos de um plano de rollback caso a sincronizacao de contatos falhe.",
        ),
        (
            80_000,
            "Carla",
            "Eu cuido dos testes de carga na homologacao ate quarta.",
        ),
        (
            120_000,
            "Bruno",
            "E a equipe de suporte precisa ser avisada da janela de manutencao.",
        ),
    ]
    .into_iter()
    .map(|(start_ms, speaker, text)| TranscriptLine {
        start_ms,
        speaker_hint: Some(speaker.into()),
        text: text.into(),
    })
    .collect();
    let excerpt = build_excerpt(
        &lines,
        ExcerptMode::FirstMinutes(FIRST_TITLE_MINUTES),
        MAX_EXCERPT_TOKENS,
    );
    let started = std::time::Instant::now();
    let title = suggest_title(&settings("macserver@192.168.15.66"), &excerpt).await;
    println!("live title: {title:?} in {:?}", started.elapsed());
    assert!(title.is_ok());
}
