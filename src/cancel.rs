//! A cloneable cancellation flag with a reason, awaited by async work and checked by sync code.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::Notify;

use crate::error::Error;

#[derive(Clone, Default)]
pub struct Cancel(Arc<Inner>);

#[derive(Default)]
struct Inner {
    done: AtomicBool,
    notify: Notify,
    reason: Mutex<Option<Error>>,
}

impl Cancel {
    pub fn new() -> Self {
        Self::default()
    }

    /// Cancel once. Later calls keep the first reason.
    pub fn cancel(&self, reason: Error) {
        let mut slot = self.0.reason.lock().unwrap();
        if self.0.done.swap(true, Ordering::SeqCst) {
            return;
        }
        *slot = Some(reason);
        drop(slot);
        self.0.notify.notify_waiters();
    }

    /// Cancel with the reason an `AbortController` gives by default.
    pub fn abort(&self) {
        self.cancel(aborted());
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.done.load(Ordering::SeqCst)
    }

    pub fn reason(&self) -> Error {
        self.0.reason.lock().unwrap().clone().unwrap_or_else(aborted)
    }

    pub async fn cancelled(&self) {
        loop {
            let notified = self.0.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }

    /// A new flag that cancels when any source cancels or `timeout` passes.
    pub fn any(sources: &[&Cancel], timeout: Duration) -> Cancel {
        let combined = Cancel::new();
        let sources: Vec<Cancel> = sources.iter().map(|&c| c.clone()).collect();
        if let Some(first) = sources.iter().find(|c| c.is_cancelled()) {
            combined.cancel(first.reason());
            return combined;
        }
        let target = combined.clone();
        tokio::spawn(async move {
            let any = async {
                let waits: Vec<_> = sources.iter().map(|c| Box::pin(c.cancelled())).collect();
                let (_, index, _) = select_all(waits).await;
                sources[index].reason()
            };
            tokio::select! {
                reason = any => target.cancel(reason),
                () = tokio::time::sleep(timeout) => target.cancel(timed_out()),
                () = target.cancelled() => {}
            }
        });
        combined
    }

    /// Run `work` unless the flag cancels first.
    pub async fn run<T>(&self, work: impl Future<Output = Result<T, Error>>) -> Result<T, Error> {
        tokio::select! {
            biased;
            () = self.cancelled() => Err(self.reason()),
            result = work => result,
        }
    }
}

pub fn aborted() -> Error {
    Error::new("internal", "This operation was aborted.")
}

pub fn timed_out() -> Error {
    Error::new("bridge_unavailable", "The operation timed out.")
}

/// The first of several futures to finish, without an extra crate.
async fn select_all<F: Future + Unpin>(mut futures: Vec<F>) -> (F::Output, usize, Vec<F>) {
    std::future::poll_fn(move |cx| {
        for (i, f) in futures.iter_mut().enumerate() {
            if let std::task::Poll::Ready(value) = std::pin::Pin::new(f).poll(cx) {
                return std::task::Poll::Ready((value, i, Vec::new()));
            }
        }
        std::task::Poll::Pending
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn any_follows_the_first_source_or_the_timeout() {
        let (a, b) = (Cancel::new(), Cancel::new());
        let combined = Cancel::any(&[&a, &b], Duration::from_secs(10));
        tokio::task::yield_now().await;
        b.cancel(Error::new("internal", "second"));
        combined.cancelled().await;
        assert_eq!(combined.reason().message, "second");
        let timed = Cancel::any(&[&a], Duration::from_secs(5));
        timed.cancelled().await;
        assert_eq!(timed.reason().code, "bridge_unavailable");
        let early = Cancel::new();
        early.abort();
        assert!(Cancel::any(&[&early], Duration::from_secs(1)).is_cancelled());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn run_stops_pending_work() {
        let flag = Cancel::new();
        let stopper = flag.clone();
        tokio::spawn(async move { stopper.abort() });
        let result: Result<(), Error> = flag.run(std::future::pending()).await;
        assert_eq!(result.unwrap_err().message, "This operation was aborted.");
    }
}
