pub mod a11y;
pub mod audits;
pub mod check_templates;
pub mod files;
pub mod runs;
pub mod target_lists;

use std::sync::{Mutex, MutexGuard};

use crate::models::AppData;
use crate::AppState;

/// Lock a mutex, recovering the data if a previous holder panicked.
///
/// A poisoned `std::sync::Mutex` would otherwise make every later `lock()`
/// fail for the rest of the session. The data guarded here is always left in
/// a consistent state between statements (mutations go through
/// [`AppState::mutate_data`], which only commits after a successful save), so
/// continuing with it is safe.
pub(crate) fn lock_or_recover<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Resolve a "clearable" optional update argument.
///
/// Tauri deserializes a JSON `null` for an `Option<Option<T>>` argument as the
/// outer `None` (exactly like a missing key), so `null` cannot mean "clear".
/// The frontend therefore sends an empty string to clear a value:
/// `None` → leave unchanged, `Some("")`/`Some(None)` → clear, `Some(v)` → set.
pub(crate) fn clearable(v: Option<Option<String>>) -> Option<Option<String>> {
    v.map(|inner| inner.filter(|s| !s.trim().is_empty()))
}

impl AppState {
    /// Lock the in-memory app data, recovering from a poisoned lock.
    pub fn lock_data(&self) -> MutexGuard<'_, AppData> {
        lock_or_recover(&self.data)
    }

    /// Apply `f` to a copy of the app data, persist the copy, and only then
    /// replace the in-memory data. If `f` or the save fails, the in-memory
    /// state is left unchanged, so memory and disk never diverge.
    pub fn mutate_data<R>(
        &self,
        f: impl FnOnce(&mut AppData) -> Result<R, String>,
    ) -> Result<R, String> {
        let mut guard = self.lock_data();
        let mut next = guard.clone();
        let result = f(&mut next)?;
        self.storage.save(&next)?;
        *guard = next;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::clearable;

    #[test]
    fn clearable_distinguishes_unchanged_clear_and_set() {
        assert_eq!(clearable(None), None);
        assert_eq!(clearable(Some(None)), Some(None));
        assert_eq!(clearable(Some(Some(String::new()))), Some(None));
        assert_eq!(clearable(Some(Some("  ".into()))), Some(None));
        assert_eq!(clearable(Some(Some("x".into()))), Some(Some("x".into())));
    }
}
