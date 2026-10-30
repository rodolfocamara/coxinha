//! Cooperative cancellation is a request, never proof that a worker has joined.
use anyhow::Result;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

#[derive(Clone, Default, Debug)]
pub struct ProcessingControl(Arc<AtomicBool>);

#[derive(Debug)]
pub struct ProcessingCancelled;
impl std::fmt::Display for ProcessingCancelled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("local processing cancelled")
    }
}
impl std::error::Error for ProcessingCancelled {}

impl ProcessingControl {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
    pub fn check(&self) -> Result<()> {
        if self.is_cancelled() {
            Err(ProcessingCancelled.into())
        } else {
            Ok(())
        }
    }

    pub(crate) fn digest(&self, path: &std::path::Path) -> Result<(String, u64)> {
        use sha2::{Digest, Sha256};
        use std::io::Read;
        self.check()?;
        let mut file = std::fs::File::open(path)?;
        let mut digest = Sha256::new();
        let mut bytes = 0u64;
        let mut buffer = [0u8; 65536];
        loop {
            self.check()?;
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            bytes = bytes
                .checked_add(count as u64)
                .ok_or_else(|| anyhow::anyhow!("file length overflow"))?;
            digest.update(&buffer[..count]);
        }
        self.check()?;
        Ok((format!("{:x}", digest.finalize()), bytes))
    }
}
