//! Spec 0116: a multilingual model decodes every window; windows that come
//! out Portuguese are decoded again by the Portuguese specialist.
use super::{language, Asr, AsrFactory, AsrWord};
use anyhow::Result;
use std::sync::Arc;

pub struct RoutedFactory {
    multilingual: Arc<dyn AsrFactory>,
    portuguese: Arc<dyn AsrFactory>,
}

impl RoutedFactory {
    pub fn new(multilingual: Arc<dyn AsrFactory>, portuguese: Arc<dyn AsrFactory>) -> Self {
        Self {
            multilingual,
            portuguese,
        }
    }
}

impl AsrFactory for RoutedFactory {
    fn load(&self) -> Result<Box<dyn Asr>> {
        Ok(Box::new(Routed {
            multilingual: self.multilingual.load()?,
            portuguese: self.portuguese.load()?,
        }))
    }
}

struct Routed {
    multilingual: Box<dyn Asr>,
    portuguese: Box<dyn Asr>,
}

impl Asr for Routed {
    fn transcribe(&mut self, pcm16k: &[f32]) -> Result<Vec<AsrWord>> {
        let words = self.multilingual.transcribe(pcm16k)?;
        let text: Vec<&str> = words.iter().map(|w| w.text.as_str()).collect();
        if language::portuguese(&text.join(" ")) {
            return self.portuguese.transcribe(pcm16k);
        }
        Ok(words)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Returns `text` split into words, counting its calls.
    struct Fixed(&'static str, Arc<AtomicUsize>);
    impl Asr for Fixed {
        fn transcribe(&mut self, _: &[f32]) -> Result<Vec<AsrWord>> {
            self.1.fetch_add(1, Ordering::SeqCst);
            Ok(self
                .0
                .split(' ')
                .map(|t| AsrWord {
                    t0_ms: 0,
                    t1_ms: 1,
                    text: t.to_owned(),
                })
                .collect())
        }
    }
    struct FixedFactory(&'static str, Arc<AtomicUsize>);
    impl AsrFactory for FixedFactory {
        fn load(&self) -> Result<Box<dyn Asr>> {
            Ok(Box::new(Fixed(self.0, self.1.clone())))
        }
    }

    fn routed(multilingual: &'static str) -> (Box<dyn Asr>, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let factory = RoutedFactory::new(
            Arc::new(FixedFactory(multilingual, Arc::default())),
            Arc::new(FixedFactory("então a gente fecha", calls.clone())),
        );
        (factory.load().unwrap(), calls)
    }

    fn text(words: &[AsrWord]) -> String {
        words
            .iter()
            .map(|w| w.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    }

    #[test]
    fn a_portuguese_window_is_decoded_again_by_the_portuguese_pass() {
        let (mut asr, calls) = routed("então a gente fechou cada story point");
        assert_eq!(
            text(&asr.transcribe(&[0.0; 16]).unwrap()),
            "então a gente fecha"
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn an_english_window_keeps_the_multilingual_words() {
        let (mut asr, calls) = routed("we need the new example of course");
        assert_eq!(
            text(&asr.transcribe(&[0.0; 16]).unwrap()),
            "we need the new example of course"
        );
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }
}
