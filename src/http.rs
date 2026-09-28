//! The loopback HTTP/1 server shared by the bridge and the demo. Handlers receive a small request view
//! and a lazy, bounded body reader; they never see Hyper types.

use std::convert::Infallible;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::{TokioIo, TokioTimer};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpListener, TcpStream};

use crate::bridge::{BodyReader, BoxFuture, Fail, HttpRequest, Reply, fail};
use crate::cancel::Cancel;

pub const MAX_BODY: usize = 393_216;
pub const HEADER_TIMEOUT: Duration = Duration::from_secs(10);
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// A service: one reply for each request. Errors are already replies.
pub type Handler = Arc<dyn Fn(HttpRequest, BodyReader) -> BoxFuture<Reply> + Send + Sync>;

fn header(req: &Request<Incoming>, name: &str) -> Option<String> {
    let mut values = req.headers().get_all(name).iter();
    let first = values.next()?.to_str().ok()?.to_owned();
    // A repeated header is ambiguous. Treat it as absent.
    values.next().is_none().then_some(first)
}

/// Read the body within the request deadline, counting each frame before it enters the buffer.
fn body_reader(body: Incoming, started: Instant) -> BodyReader {
    Box::new(move || {
        Box::pin(async move {
            let left = REQUEST_TIMEOUT.saturating_sub(started.elapsed());
            let read = async {
                let mut body = body;
                let mut bytes = Vec::new();
                while let Some(frame) = body.frame().await {
                    let Ok(frame) = frame else {
                        return Err(fail("invalid_request", "The request body could not be read.", None));
                    };
                    if let Ok(data) = frame.into_data() {
                        if data.len() > MAX_BODY - bytes.len() {
                            return Err(fail("invalid_request", "The request is too large.", Some(413)));
                        }
                        bytes.extend_from_slice(&data);
                    }
                }
                Ok(bytes)
            };
            tokio::time::timeout(left, read)
                .await
                .unwrap_or_else(|_| Err(fail("invalid_request", "The request timed out.", Some(408))))
        }) as BoxFuture<std::result::Result<Vec<u8>, Fail>>
    })
}

pub fn response(reply: Reply) -> Response<Full<Bytes>> {
    let mut builder = Response::builder().status(reply.status);
    let has_type = reply.headers.iter().any(|(name, _)| name.eq_ignore_ascii_case("content-type"));
    if reply.body.is_some() && !has_type {
        builder = builder
            .header("Content-Type", "application/json")
            .header("Cache-Control", "no-store")
            .header("X-Content-Type-Options", "nosniff");
    }
    for (name, value) in &reply.headers {
        builder = builder.header(*name, value);
    }
    let body = match reply.raw {
        Some(raw) => raw,
        None => reply.body.map(|v| Bytes::from(v.to_string())).unwrap_or_default(),
    };
    builder.body(Full::new(body)).unwrap_or_else(|_| Response::new(Full::new(Bytes::new())))
}

/// Records the time of the last read or write, so the server can close idle connections.
struct Tracked {
    inner: TcpStream,
    last: Arc<AtomicU64>,
    epoch: Instant,
}

impl Tracked {
    fn touch(&self) {
        self.last.store(self.epoch.elapsed().as_millis() as u64, Ordering::Relaxed);
    }
}

impl AsyncRead for Tracked {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let before = buf.filled().len();
        let result = std::pin::Pin::new(&mut self.inner).poll_read(cx, buf);
        if buf.filled().len() > before {
            self.touch();
        }
        result
    }
}

impl AsyncWrite for Tracked {
    fn poll_write(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        let result = std::pin::Pin::new(&mut self.inner).poll_write(cx, data);
        if let Poll::Ready(Ok(n)) = &result
            && *n > 0
        {
            self.touch();
        }
        result
    }
    fn poll_flush(mut self: std::pin::Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(mut self: std::pin::Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

async fn serve_connection(stream: TcpStream, handler: Handler, idle: Duration, stop: Cancel) {
    let epoch = Instant::now();
    let last = Arc::new(AtomicU64::new(0));
    let io = TokioIo::new(Tracked { inner: stream, last: last.clone(), epoch });
    let service = service_fn(move |req: Request<Incoming>| {
        let handler = handler.clone();
        async move {
            let started = Instant::now();
            let view = HttpRequest {
                method: req.method().as_str().to_owned(),
                target: req.uri().to_string(),
                host: header(&req, "host"),
                origin: header(&req, "origin"),
                authorization: header(&req, "authorization"),
                content_type: header(&req, "content-type"),
            };
            let reader = body_reader(req.into_body(), started);
            // A request that reached the handler runs to completion, even if the client disconnects.
            // Hyper drops this service future on disconnect; the spawned task keeps state changes whole.
            let task = tokio::spawn(handler(view, reader));
            let reply = task.await.unwrap_or_else(|_| {
                Reply::failure(fail(
                    "internal",
                    "The bridge could not complete this request. Check its terminal.",
                    Some(500),
                ))
            });
            Ok::<_, Infallible>(response(reply))
        }
    });
    let mut builder = http1::Builder::new();
    builder.timer(TokioTimer::new()).header_read_timeout(HEADER_TIMEOUT).max_buf_size(MAX_BODY + 65_536);
    let connection = builder.serve_connection(io, service);
    tokio::pin!(connection);
    let watchdog = async {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let quiet = epoch.elapsed().saturating_sub(Duration::from_millis(last.load(Ordering::Relaxed)));
            if quiet >= idle {
                return;
            }
        }
    };
    tokio::select! {
        _ = connection.as_mut() => {}
        () = watchdog => {}
        () = stop.cancelled() => {}
    }
}

/// Serve until `stop` cancels. Each connection closes after `idle` without traffic.
pub async fn serve(listener: TcpListener, handler: Handler, idle: Duration, stop: Cancel) {
    loop {
        let accepted = tokio::select! {
            accepted = listener.accept() => accepted,
            () = stop.cancelled() => return,
        };
        let Ok((stream, _)) = accepted else { continue };
        let _ = stream.set_nodelay(true);
        tokio::spawn(serve_connection(stream, handler.clone(), idle, stop.clone()));
    }
}
