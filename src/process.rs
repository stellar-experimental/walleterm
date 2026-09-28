//! Child process cleanup: SIGTERM, then SIGKILL after a grace period, and always a reap.

use std::time::Duration;

use tokio::process::Child;

/// Stop a child and wait for it to exit. Returns `false` if it survived SIGKILL for another grace period.
pub async fn stop_child(child: &mut Child, grace: Duration) -> bool {
    if let Ok(Some(_)) = child.try_wait() {
        return true;
    }
    if let Some(pid) = child.id() {
        // SAFETY: the PID belongs to our own child, which is not reaped yet.
        unsafe { libc::kill(pid as i32, libc::SIGTERM) };
    }
    if tokio::time::timeout(grace, child.wait()).await.is_ok() {
        return true;
    }
    let _ = child.start_kill();
    tokio::time::timeout(grace, child.wait()).await.is_ok()
}

/// SIGKILL a whole process group that this process created. `ESRCH` and `EPERM` mean no live member.
pub fn kill_group(group: u32) {
    // SAFETY: the group ID is the PID of a supervisor that this process started as a group leader.
    unsafe { libc::killpg(group as i32, libc::SIGKILL) };
}

/// Standard output and error as async sinks for forwarded child output.
pub struct StdoutSink;
pub struct StderrSink;

macro_rules! sink {
    ($name:ident, $stream:expr) => {
        impl tokio::io::AsyncWrite for $name {
            fn poll_write(
                self: std::pin::Pin<&mut Self>,
                _: &mut std::task::Context<'_>,
                buf: &[u8],
            ) -> std::task::Poll<std::io::Result<usize>> {
                use std::io::Write;
                std::task::Poll::Ready($stream.write_all(buf).map(|()| buf.len()))
            }
            fn poll_flush(
                self: std::pin::Pin<&mut Self>,
                _: &mut std::task::Context<'_>,
            ) -> std::task::Poll<std::io::Result<()>> {
                use std::io::Write;
                std::task::Poll::Ready($stream.flush())
            }
            fn poll_shutdown(
                self: std::pin::Pin<&mut Self>,
                _: &mut std::task::Context<'_>,
            ) -> std::task::Poll<std::io::Result<()>> {
                std::task::Poll::Ready(Ok(()))
            }
        }
    };
}
sink!(StdoutSink, std::io::stdout());
sink!(StderrSink, std::io::stderr());

/// Resolves when standard input reaches end of file or fails. A thread reads it, because Tokio's
/// standard input needs a feature that the application does not otherwise use.
pub fn stdin_closed() -> impl Future<Output = ()> {
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    std::thread::spawn(move || {
        use std::io::Read;
        let mut buffer = [0u8; 256];
        let mut stdin = std::io::stdin();
        while matches!(stdin.read(&mut buffer), Ok(n) if n > 0) {}
        let _ = tx.send(());
    });
    async move {
        let _ = rx.await;
    }
}
