//! Spec 0116 P2: tells Portuguese from English by marker words alone.

const PORTUGUESE: &[&str] = &[
    "agora", "ainda", "aqui", "aí", "bem", "com", "coisa", "da", "das", "de", "depois", "dos", "e",
    "ela", "ele", "eles", "em", "então", "essa", "esse", "eu", "foi", "gente", "isso", "isto",
    "já", "lá", "mais", "mas", "meu", "minha", "muito", "na", "nada", "nas", "nos", "né", "não",
    "nós", "o", "os", "ou", "para", "pode", "porque", "pra", "que", "sim", "sua", "seu", "só",
    "também", "tem", "ter", "tudo", "tá", "um", "uma", "vai", "vou", "você", "vocês", "é",
];

const ENGLISH: &[&str] = &[
    "about", "all", "an", "and", "are", "at", "be", "because", "but", "can", "for", "from", "has",
    "have", "how", "i", "if", "in", "is", "it", "just", "know", "like", "my", "need", "not", "of",
    "or", "our", "should", "so", "that", "the", "there", "they", "think", "this", "to", "want",
    "was", "we", "were", "what", "when", "which", "why", "will", "with", "would", "yeah", "you",
    "your",
];

/// True unless English markers outnumber Portuguese ones. The owner speaks
/// Portuguese, and the multilingual model writes their speech as gibberish in
/// other languages, which has no English markers.
pub(crate) fn portuguese(text: &str) -> bool {
    let (mut pt, mut en, mut any) = (0usize, 0usize, false);
    for word in text.split(|c: char| !c.is_alphanumeric()) {
        let word = word.to_lowercase();
        if word.is_empty() {
            continue;
        }
        any = true;
        if PORTUGUESE.contains(&word.as_str()) || word.contains(['ã', 'õ', 'ç', 'â', 'ê', 'ô'])
        {
            pt += 1;
        } else if ENGLISH.contains(&word.as_str()) {
            en += 1;
        }
    }
    any && pt >= en
}

#[cfg(test)]
mod tests {
    use super::portuguese;

    #[test]
    fn owner_meeting_sentences_are_told_apart() {
        assert!(!portuguese(
            "And this is just out of curiosity, why we are counting this measurement when we make the agile project"
        ));
        assert!(!portuguese(
            "But for Brazil we will also use the distributor or no?"
        ));
        assert!(portuguese(
            "Sim, sim, sim. É, e que pra gente achar a necessidade acertar você possível, né?"
        ));
        assert!(portuguese(
            "Deixa eu ver se eu consigo ver aqui construir CCB"
        ));
        assert!(portuguese("São três horas, cada story point."));
    }

    #[test]
    fn only_english_or_silence_keeps_the_multilingual_text() {
        assert!(!portuguese(""));
        assert!(!portuguese(" . "));
        assert!(!portuguese("Ah, I love"));
        assert!(portuguese("Det kan sue big infir om visibraciones."));
        assert!(portuguese("sim, yeah"));
    }
}
