//! Borrowed cancellation bridge for the synchronous whisper-rs 0.16 call.
//! Do not use that version's allocating closure helper: its trampoline casts
//! boxed trait-object userdata to F and the allocation is not retained by params.
use crate::processing::ProcessingControl;
use anyhow::Result;
use std::ffi::c_void;
use whisper_rs::{FullParams, WhisperState};

unsafe extern "C" fn requested(data: *mut c_void) -> bool {
    // SAFETY: only run() registers this callback, with a live shared control.
    // Reading its AtomicBool is thread-safe and cannot unwind through C.
    unsafe { (&*data.cast::<ProcessingControl>()).is_cancelled() }
}

pub(super) fn run(
    state: &mut WhisperState,
    mut params: FullParams<'_, '_>,
    samples: &[f32],
    control: &ProcessingControl,
) -> Result<()> {
    control.check()?;
    // SAFETY: full() synchronously completes native work before returning. The
    // borrowed control remains alive throughout; neither params nor its userdata
    // escapes this function. The callback only reads an atomic, never a context.
    unsafe {
        params.set_abort_callback(Some(requested));
        params.set_abort_callback_user_data(std::ptr::from_ref(control).cast_mut().cast());
    }
    let result = state.full(params, samples);
    control.check()?;
    result?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn callback_reads_the_same_live_token_without_an_owned_closure() {
        let control = ProcessingControl::default();
        let data = std::ptr::from_ref(&control).cast_mut().cast();
        // SAFETY: the control outlives both direct callback invocations.
        assert!(!unsafe { requested(data) });
        control.clone().cancel();
        assert!(unsafe { requested(data) });
    }
}
