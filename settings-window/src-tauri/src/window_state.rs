use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
pub struct SettingsState {
    ready: AtomicBool,
    focused: AtomicBool,
}

impl SettingsState {
    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::Acquire)
    }

    pub fn mark_ready(&self) {
        self.ready.store(true, Ordering::Release);
    }

    pub fn prepare_reload(&self) {
        self.ready.store(false, Ordering::Release);
        self.focused.store(false, Ordering::Release);
    }

    pub fn should_dismiss_on_focus_change(&self, focused: bool) -> bool {
        if !self.is_ready() {
            return false;
        }
        let previously_focused = self.focused.swap(focused, Ordering::AcqRel);
        previously_focused && !focused
    }
}

#[cfg(test)]
mod tests {
    use super::SettingsState;

    #[test]
    fn loading_or_initially_unfocused_window_is_not_dismissed() {
        let state = SettingsState::default();
        assert!(!state.should_dismiss_on_focus_change(false));
        state.mark_ready();
        assert!(!state.should_dismiss_on_focus_change(false));
    }

    #[test]
    fn focused_popup_dismisses_once_when_focus_leaves() {
        let state = SettingsState::default();
        state.mark_ready();
        assert!(!state.should_dismiss_on_focus_change(true));
        assert!(state.should_dismiss_on_focus_change(false));
        assert!(!state.should_dismiss_on_focus_change(false));
    }

    #[test]
    fn reloading_does_not_dismiss_the_hidden_window() {
        let state = SettingsState::default();
        state.mark_ready();
        state.should_dismiss_on_focus_change(true);
        state.prepare_reload();
        assert!(!state.should_dismiss_on_focus_change(false));
        state.mark_ready();
        assert!(!state.should_dismiss_on_focus_change(false));
        state.should_dismiss_on_focus_change(true);
        assert!(state.should_dismiss_on_focus_change(false));
    }
}
