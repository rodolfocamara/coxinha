use super::*;

#[test]
fn removes_think_blocks_closed_unclosed_and_template_opened() {
    assert_eq!(
        sanitize_title("<think>\nplan\n</think>\n\nMigracao do CRM").as_deref(),
        Some("Migracao do CRM")
    );
    assert_eq!(
        sanitize_title("<THINK>a</Think>Plano <think>b</think>Q3").as_deref(),
        Some("Plano Q3")
    );
    assert_eq!(
        sanitize_title("reasoning only\n</think>\nRevisao de metas").as_deref(),
        Some("Revisao de metas")
    );
    assert_eq!(
        sanitize_title("Roadmap<think>never closed"),
        Some("Roadmap".into())
    );
    assert_eq!(sanitize_title("<think>never closed\nTitle"), None);
}

#[test]
fn takes_the_first_non_empty_line() {
    assert_eq!(
        sanitize_title("\n  \nKickoff do projeto\nExplanation follows").as_deref(),
        Some("Kickoff do projeto")
    );
    assert_eq!(
        sanitize_title("```\nKickoff\n```").as_deref(),
        Some("Kickoff")
    );
}

#[test]
fn removes_quotes_wikilinks_and_markdown_marks() {
    let cases = [
        ("\"Reuniao de vendas\"", "Reuniao de vendas"),
        ("\u{201c}Reuniao de vendas\u{201d}", "Reuniao de vendas"),
        ("'Reuniao de vendas'", "Reuniao de vendas"),
        ("`Sprint` review", "Sprint review"),
        ("[[Sprint]] review", "Sprint review"),
        ("## **Planejamento** _Q3_", "Planejamento _Q3_"),
        ("__Planejamento__ ~~velho~~", "Planejamento velho"),
        ("- 1. > Retro do time", "Retro do time"),
        ("T\u{ed}tulo: Retro do time.", "Retro do time"),
        ("Title: Retro", "Retro"),
        ("Pauta: orcamento", "Pauta: orcamento"),
    ];
    for (raw, want) in cases {
        assert_eq!(sanitize_title(raw).as_deref(), Some(want), "{raw:?}");
    }
}

#[test]
fn removes_urls_and_keeps_link_text() {
    assert_eq!(
        sanitize_title("Demo https://evil.example/x?y=1 do produto").as_deref(),
        Some("Demo do produto")
    );
    assert_eq!(
        sanitize_title("Ver (www.evil.example) agora").as_deref(),
        Some("Ver agora")
    );
    assert_eq!(
        sanitize_title("[Demo](https://evil.example) final").as_deref(),
        Some("Demo final")
    );
    assert_eq!(sanitize_title("https://evil.example"), None);
}

#[test]
fn removes_control_and_invisible_characters() {
    assert_eq!(
        sanitize_title("Plano\u{7}\u{1b}[31m Q3\u{200b}\u{202e}").as_deref(),
        Some("Plano31m Q3")
    );
    assert_eq!(sanitize_title("Plano\tQ3\r").as_deref(), Some("Plano Q3"));
}

#[test]
fn caps_at_80_characters_on_a_boundary() {
    let long = "palavra ".repeat(20);
    let title = sanitize_title(&long).unwrap();
    assert!(title.chars().count() <= 80);
    assert!(title.ends_with("palavra"), "cut between words: {title:?}");

    let accented = "\u{e7}".repeat(100);
    let title = sanitize_title(&accented).unwrap();
    assert_eq!(
        title.chars().count(),
        80,
        "multibyte text is cut on a character boundary"
    );
}

#[test]
fn empty_or_markup_only_answers_are_none() {
    for raw in [
        "",
        "   \n\t",
        "\"\"",
        "**",
        "[[]]",
        "<think>x</think>",
        "- ",
        "#",
    ] {
        assert_eq!(sanitize_title(raw), None, "{raw:?}");
    }
}
