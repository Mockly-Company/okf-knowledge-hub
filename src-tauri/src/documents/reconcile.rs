#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReconcileDecision {
    Start,
    Wait,
}

#[derive(Debug, Default)]
pub(crate) struct ReconcileGate {
    running: bool,
    pending: bool,
    closed: bool,
}

impl ReconcileGate {
    pub(crate) fn request(&mut self) -> ReconcileDecision {
        if self.closed {
            return ReconcileDecision::Wait;
        }
        if self.running {
            self.pending = true;
            return ReconcileDecision::Wait;
        }
        self.running = true;
        ReconcileDecision::Start
    }

    pub(crate) fn finish(&mut self) -> ReconcileDecision {
        if self.closed {
            self.running = false;
            self.pending = false;
            return ReconcileDecision::Wait;
        }
        if std::mem::take(&mut self.pending) {
            return ReconcileDecision::Start;
        }
        self.running = false;
        ReconcileDecision::Wait
    }

    pub(crate) fn close(&mut self) {
        self.closed = true;
        self.pending = false;
    }
}

#[cfg(test)]
mod tests {
    use super::{ReconcileDecision, ReconcileGate};

    #[test]
    fn idle_request_starts_one_run() {
        let mut gate = ReconcileGate::default();
        assert_eq!(gate.request(), ReconcileDecision::Start);
        assert_eq!(gate.request(), ReconcileDecision::Wait);
    }

    #[test]
    fn many_requests_during_a_run_become_one_follow_up() {
        let mut gate = ReconcileGate::default();
        assert_eq!(gate.request(), ReconcileDecision::Start);
        assert_eq!(gate.request(), ReconcileDecision::Wait);
        assert_eq!(gate.request(), ReconcileDecision::Wait);
        assert_eq!(gate.finish(), ReconcileDecision::Start);
        assert_eq!(gate.finish(), ReconcileDecision::Wait);
    }

    #[test]
    fn closing_drops_pending_and_rejects_future_runs() {
        let mut gate = ReconcileGate::default();
        assert_eq!(gate.request(), ReconcileDecision::Start);
        assert_eq!(gate.request(), ReconcileDecision::Wait);
        gate.close();
        assert_eq!(gate.finish(), ReconcileDecision::Wait);
        assert_eq!(gate.request(), ReconcileDecision::Wait);
    }
}
