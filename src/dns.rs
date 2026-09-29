//! Direct DNS A lookups for the public tunnel name. A new Quick Tunnel name gets its DNS record several seconds
//! after cloudflared prints it. The macOS system resolver caches the first negative answer for longer than
//! readiness waits, so the probe asks the `/etc/resolv.conf` nameservers itself and keeps no cache.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;

use hyper_util::client::legacy::connect::dns::Name;
use tokio::net::UdpSocket;

use crate::bridge::BoxFuture;
use crate::error::{Error, Result};

/// A lookup ends within 2 seconds, so its message survives the 2.5-second probe limit.
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(2);
const _: () = assert!(LOOKUP_TIMEOUT.as_millis() < crate::tunnel::PROBE_TIMEOUT.as_millis());
/// A response to a query without EDNS has at most 512 bytes (RFC 1035, section 4.2.1).
const MAX_MESSAGE: usize = 512;
/// resolv.conf uses at most three nameservers.
const MAX_SERVERS: usize = 3;
/// A longer CNAME chain is not followed.
const MAX_ALIASES: usize = 8;
const TYPE_A: u16 = 1;
const TYPE_CNAME: u16 = 5;
const CLASS_IN: u16 = 1;

pub type LookupFn = dyn Fn(String) -> BoxFuture<Result<Ipv4Addr>> + Send + Sync;

/// The HTTPS client's resolver. The connection keeps the URL host name for TLS and the `Host` header.
#[derive(Clone)]
pub struct Resolver(Arc<LookupFn>);

impl Resolver {
    /// Ask the `/etc/resolv.conf` nameservers for each new connection.
    pub fn direct() -> Self {
        Self::new(|host| Box::pin(async move { lookup(&host).await }))
    }

    /// A resolver with another lookup. Tests use it without network access.
    pub fn new(lookup: impl Fn(String) -> BoxFuture<Result<Ipv4Addr>> + Send + Sync + 'static) -> Self {
        Self(Arc::new(lookup))
    }
}

impl tower_service::Service<Name> for Resolver {
    type Response = std::iter::Once<SocketAddr>;
    type Error = Error;
    type Future = BoxFuture<Result<Self::Response>>;

    fn poll_ready(&mut self, _: &mut Context<'_>) -> Poll<Result<()>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, name: Name) -> Self::Future {
        let lookup = (self.0)(name.as_str().to_owned());
        // Port 0 takes the URL port.
        Box::pin(async move { lookup.await.map(|ip| std::iter::once(SocketAddr::from((ip, 0)))) })
    }
}

fn failure(message: impl Into<String>) -> Error {
    Error::new("internal", message)
}

/// Look up one IPv4 address for `host` at the `/etc/resolv.conf` nameservers.
async fn lookup(host: &str) -> Result<Ipv4Addr> {
    let config = std::fs::read_to_string("/etc/resolv.conf").unwrap_or_default();
    lookup_at(host, &nameservers(&config)).await
}

/// The first three `nameserver` addresses, on port 53. Scoped IPv6 addresses do not parse and are skipped.
fn nameservers(config: &str) -> Vec<SocketAddr> {
    config
        .lines()
        .filter_map(|line| {
            let mut words = line.split_whitespace();
            if words.next() != Some("nameserver") {
                return None;
            }
            words.next()?.parse::<IpAddr>().ok().map(|ip| SocketAddr::new(ip, 53))
        })
        .take(MAX_SERVERS)
        .collect()
}

/// Ask every server at once. The first address wins. Otherwise the last failure explains the lookup.
async fn lookup_at(host: &str, servers: &[SocketAddr]) -> Result<Ipv4Addr> {
    let name = encode_name(host).ok_or_else(|| failure("The tunnel host name is not valid."))?;
    if servers.is_empty() {
        return Err(failure("The DNS configuration has no nameserver."));
    }
    let deadline = tokio::time::Instant::now() + LOOKUP_TIMEOUT;
    // Dropping the set stops the other queries.
    let mut asks = tokio::task::JoinSet::new();
    for &server in servers {
        asks.spawn(ask(server, name.clone()));
    }
    let mut last = failure("The DNS lookup timed out.");
    loop {
        tokio::select! {
            joined = asks.join_next() => match joined {
                Some(Ok(Ok(address))) => return Ok(address),
                Some(Ok(Err(e))) => last = e,
                Some(Err(_)) => {}
                None => return Err(last),
            },
            () = tokio::time::sleep_until(deadline) => return Err(last),
        }
    }
}

/// Send one A query to `server` and wait for its answer. Datagrams that do not answer this query are ignored.
async fn ask(server: SocketAddr, name: Vec<u8>) -> Result<Ipv4Addr> {
    let failed = || failure("The DNS request failed.");
    let local: SocketAddr = match server {
        SocketAddr::V4(_) => (Ipv4Addr::UNSPECIFIED, 0).into(),
        SocketAddr::V6(_) => (Ipv6Addr::UNSPECIFIED, 0).into(),
    };
    let socket = UdpSocket::bind(local).await.map_err(|_| failed())?;
    // A connected socket receives datagrams only from this server.
    socket.connect(server).await.map_err(|_| failed())?;
    let id = u16::from_be_bytes(crate::util::random::<2>());
    socket.send(&query(id, &name)).await.map_err(|_| failed())?;
    let mut buffer = [0u8; MAX_MESSAGE + 1];
    loop {
        let n = socket.recv(&mut buffer).await.map_err(|_| failed())?;
        if n <= MAX_MESSAGE
            && let Some(answer) = answer(&buffer[..n], id, &name)
        {
            return answer;
        }
    }
}

/// The lowercase wire form of a host name: length-prefixed labels and a zero byte.
fn encode_name(host: &str) -> Option<Vec<u8>> {
    let mut name = Vec::new();
    for label in host.split('.') {
        if label.is_empty()
            || label.len() > 63
            || !label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return None;
        }
        name.push(label.len() as u8);
        name.extend(label.bytes().map(|b| b.to_ascii_lowercase()));
    }
    name.push(0);
    (name.len() <= 255).then_some(name)
}

/// A recursive query with one question: `name`, type A, class IN. It has no EDNS record.
fn query(id: u16, name: &[u8]) -> Vec<u8> {
    let mut message = Vec::with_capacity(16 + name.len());
    message.extend_from_slice(&id.to_be_bytes());
    message.extend_from_slice(&[0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]);
    message.extend_from_slice(name);
    message.extend_from_slice(&TYPE_A.to_be_bytes());
    message.extend_from_slice(&CLASS_IN.to_be_bytes());
    message
}

fn word(message: &[u8], at: usize) -> Option<u16> {
    message.get(at..at.checked_add(2)?).map(|b| u16::from_be_bytes([b[0], b[1]]))
}

/// Read a name at `at` in its lowercase wire form, and the offset after it.
/// Compression pointers must point backward, so every name ends.
fn read_name(message: &[u8], mut at: usize) -> Option<(Vec<u8>, usize)> {
    let mut name = Vec::new();
    let mut end = None;
    loop {
        let length = *message.get(at)? as usize;
        match length & 0xC0 {
            0x00 if length == 0 => {
                name.push(0);
                return (name.len() <= 255).then_some((name, end.unwrap_or(at + 1)));
            }
            0x00 => {
                let label = message.get(at + 1..at + 1 + length)?;
                name.push(length as u8);
                name.extend(label.iter().map(u8::to_ascii_lowercase));
                if name.len() > 255 {
                    return None;
                }
                at += 1 + length;
            }
            0xC0 => {
                let pointer = ((length & 0x3F) << 8) | *message.get(at + 1)? as usize;
                if pointer >= at {
                    return None;
                }
                end.get_or_insert(at + 2);
                at = pointer;
            }
            _ => return None,
        }
    }
}

/// Read a response to query `id` for `name`. `None` means that the datagram does not answer this query.
fn answer(message: &[u8], id: u16, name: &[u8]) -> Option<Result<Ipv4Addr>> {
    let flags = word(message, 2)?;
    // A response to a standard query, with exactly the question that was asked.
    if word(message, 0)? != id || flags & 0x8000 == 0 || flags & 0x7800 != 0 || word(message, 4)? != 1 {
        return None;
    }
    let (question, at) = read_name(message, 12)?;
    if question != name || word(message, at)? != TYPE_A || word(message, at + 2)? != CLASS_IN {
        return None;
    }
    // A truncated answer can omit records. It is not used.
    if flags & 0x0200 != 0 {
        return Some(Err(failure("The DNS answer was truncated.")));
    }
    match flags & 0x000F {
        0 => {}
        3 => return Some(Err(failure("The DNS lookup found no such tunnel name."))),
        code => return Some(Err(failure(format!("The DNS lookup failed (RCODE {code}).")))),
    }
    let count = word(message, 6)?;
    Some(address(message, count, at + 4, name).ok_or_else(|| failure("The DNS answer has no IPv4 address.")))
}

/// Follow the answer from `name` through CNAME records in the same answer to the first A record.
fn address(message: &[u8], count: u16, mut at: usize, name: &[u8]) -> Option<Ipv4Addr> {
    struct Record {
        owner: Vec<u8>,
        kind: u16,
        data: std::ops::Range<usize>,
    }
    let mut records = Vec::new();
    for _ in 0..count {
        let (owner, fields) = read_name(message, at)?;
        let (kind, class, length) =
            (word(message, fields)?, word(message, fields + 2)?, word(message, fields + 8)? as usize);
        let data = fields + 10..fields + 10 + length;
        message.get(data.clone())?;
        at = data.end;
        if class == CLASS_IN {
            records.push(Record { owner, kind, data });
        }
    }
    let mut target = name.to_vec();
    for _ in 0..MAX_ALIASES {
        let owned = || records.iter().filter(|r| r.owner == target);
        if let Some(record) = owned().find(|r| r.kind == TYPE_A && r.data.len() == 4) {
            let b = &message[record.data.clone()];
            return Some(Ipv4Addr::new(b[0], b[1], b[2], b[3]));
        }
        let alias = owned().find(|r| r.kind == TYPE_CNAME)?;
        target = read_name(message, alias.data.start)?.0;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOST: &str = "Bridge-Name.trycloudflare.com";

    fn name() -> Vec<u8> {
        encode_name(HOST).unwrap()
    }

    /// A response header and the echoed question.
    fn response(id: u16, flags: u16, answers: u16) -> Vec<u8> {
        let mut message = query(id, &name());
        message[2..4].copy_from_slice(&flags.to_be_bytes());
        message[6..8].copy_from_slice(&answers.to_be_bytes());
        message
    }

    fn record(message: &mut Vec<u8>, owner: &[u8], kind: u16, data: &[u8]) {
        message.extend_from_slice(owner);
        message.extend_from_slice(&kind.to_be_bytes());
        message.extend_from_slice(&CLASS_IN.to_be_bytes());
        message.extend_from_slice(&60u32.to_be_bytes());
        message.extend_from_slice(&(data.len() as u16).to_be_bytes());
        message.extend_from_slice(data);
    }

    /// A pointer to the question name at offset 12.
    const QUESTION: [u8; 2] = [0xC0, 12];

    #[test]
    fn names_use_the_lowercase_wire_form() {
        assert_eq!(encode_name(HOST).unwrap(), b"\x0bbridge-name\x0dtrycloudflare\x03com\x00".to_vec());
        let (long, many) = ("a".repeat(64), ["a"; 128].join("."));
        for host in ["", "a..b", "a.", "a b", long.as_str(), many.as_str()] {
            assert_eq!(encode_name(host), None, "{host}");
        }
        assert!(encode_name(&vec!["a".repeat(63); 4].join(".")[..253]).is_some());
    }

    #[test]
    fn a_query_asks_one_recursive_a_question() {
        let message = query(0xBEEF, &name());
        assert_eq!(&message[..12], &[0xBE, 0xEF, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]);
        assert_eq!(&message[message.len() - 4..], &[0, 1, 0, 1]);
    }

    #[test]
    fn only_nameserver_lines_count() {
        let config = "# comment\nsearch example.com\nnameserver 100.100.100.100\nnameserver fe80::1%en0\n\
                      nameserver ::1\nnameserver 192.168.0.1\nnameserver 1.1.1.1\n";
        assert_eq!(
            nameservers(config),
            ["100.100.100.100:53", "[::1]:53", "192.168.0.1:53"]
                .map(|s| s.parse::<SocketAddr>().unwrap())
                .to_vec()
        );
    }

    #[test]
    fn an_answer_returns_the_a_record_for_the_asked_name() {
        let mut message = response(7, 0x8180, 5);
        record(&mut message, b"\x05other\x03com\x00", TYPE_A, &[9, 9, 9, 9]);
        record(&mut message, &QUESTION, 28, &[0; 16]);
        record(&mut message, &QUESTION, 16, b"\x03txt");
        // Class CH instead of IN.
        let class = message.len() + 5;
        record(&mut message, &QUESTION, TYPE_A, &[8, 8, 8, 8]);
        message[class] = 3;
        record(&mut message, &QUESTION, TYPE_A, &[104, 16, 1, 2]);
        assert_eq!(answer(&message, 7, &name()), Some(Ok(Ipv4Addr::new(104, 16, 1, 2))));
    }

    #[test]
    fn an_answer_follows_a_cname_chain_in_the_same_answer() {
        let mut message = response(7, 0x8180, 2);
        let alias = message.len() + 12;
        record(&mut message, &QUESTION, TYPE_CNAME, b"\x04edge\xC0\x18");
        record(&mut message, &[0xC0, alias as u8], TYPE_A, &[104, 16, 1, 3]);
        assert_eq!(answer(&message, 7, &name()), Some(Ok(Ipv4Addr::new(104, 16, 1, 3))));

        // An alias without its A record in the answer gives no address.
        let mut message = response(7, 0x8180, 2);
        record(&mut message, &QUESTION, TYPE_CNAME, b"\x04edge\xC0\x18");
        record(&mut message, b"\x05other\x03com\x00", TYPE_A, &[9, 9, 9, 9]);
        assert_eq!(
            answer(&message, 7, &name()).unwrap().unwrap_err().message,
            "The DNS answer has no IPv4 address."
        );
    }

    #[test]
    fn other_datagrams_are_ignored() {
        let mut message = response(7, 0x8180, 1);
        record(&mut message, &QUESTION, TYPE_A, &[104, 16, 1, 2]);
        assert!(answer(&message, 7, &name()).is_some());
        // Another ID, a query instead of a response, another opcode, or another question.
        assert_eq!(answer(&message, 8, &name()), None);
        let mut query_bit = message.clone();
        query_bit[2] &= 0x7F;
        assert_eq!(answer(&query_bit, 7, &name()), None);
        let mut opcode = message.clone();
        opcode[2] |= 0x10;
        assert_eq!(answer(&opcode, 7, &name()), None);
        assert_eq!(answer(&message, 7, &encode_name("other.trycloudflare.com").unwrap()), None);
        let mut kind = message.clone();
        kind[12 + name().len() + 1] = 28;
        assert_eq!(answer(&kind, 7, &name()), None);
        let mut class = message.clone();
        class[12 + name().len() + 3] = 3;
        assert_eq!(answer(&class, 7, &name()), None);
        for count in [0, 2] {
            let mut questions = message.clone();
            questions[5] = count;
            assert_eq!(answer(&questions, 7, &name()), None);
        }
        assert_eq!(answer(&message[..11], 7, &name()), None);
    }

    #[test]
    fn names_in_an_answer_compare_without_case() {
        let upper = name().to_ascii_uppercase();
        let mut message = response(7, 0x8180, 1);
        message[12..12 + upper.len()].copy_from_slice(&upper);
        record(&mut message, &upper, TYPE_A, &[104, 16, 1, 2]);
        assert_eq!(answer(&message, 7, &name()), Some(Ok(Ipv4Addr::new(104, 16, 1, 2))));
    }

    #[test]
    fn failures_name_their_cause() {
        let message = |flags| answer(&response(7, flags, 0), 7, &name()).unwrap().unwrap_err().message;
        assert_eq!(message(0x8183), "The DNS lookup found no such tunnel name.");
        assert_eq!(message(0x8182), "The DNS lookup failed (RCODE 2).");
        assert_eq!(message(0x8380), "The DNS answer was truncated.");
        assert_eq!(message(0x8180), "The DNS answer has no IPv4 address.");
        // A truncated answer is not used, even with an address.
        let mut truncated = response(7, 0x8380, 1);
        record(&mut truncated, &QUESTION, TYPE_A, &[104, 16, 1, 2]);
        assert!(answer(&truncated, 7, &name()).unwrap().is_err());
    }

    /// Read an answer on a thread with a time limit, so a parse that never ends fails instead of hanging.
    fn bounded(message: Vec<u8>) -> String {
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = sender.send(answer(&message, 7, &name()));
        });
        let parsed = receiver.recv_timeout(Duration::from_secs(1)).expect("the parse ends");
        parsed.expect("an answer to the query").expect_err("no address").message
    }

    #[test]
    fn malformed_records_give_no_address() {
        const NONE: &str = "The DNS answer has no IPv4 address.";
        let mut short = response(7, 0x8180, 1);
        record(&mut short, &QUESTION, TYPE_A, &[104, 16, 1, 2]);
        short.pop();
        assert_eq!(bounded(short), NONE);
        let mut wide = response(7, 0x8180, 1);
        record(&mut wide, &QUESTION, TYPE_A, &[104, 16, 1, 2, 0]);
        assert_eq!(bounded(wide), NONE);
        // A pointer to itself or forward never ends a name.
        let mut looped = response(7, 0x8180, 1);
        let at = looped.len() as u8;
        record(&mut looped, &[0xC0, at], TYPE_A, &[104, 16, 1, 2]);
        assert_eq!(bounded(looped), NONE);
        let mut forward = response(7, 0x8180, 1);
        let at = forward.len() as u8 + 2;
        record(&mut forward, &[0xC0, at], TYPE_A, &[104, 16, 1, 2]);
        assert_eq!(bounded(forward), NONE);
        // A label, then a pointer back to that label, stops when the name passes 255 bytes.
        let mut repeated = response(7, 0x8180, 1);
        let at = repeated.len() as u8;
        record(&mut repeated, &[1, b'a', 0xC0, at], TYPE_A, &[104, 16, 1, 2]);
        assert_eq!(bounded(repeated), NONE);
        // Two aliases that name each other stop after eight names.
        let mut cycle = response(7, 0x8180, 2);
        let edge = cycle.len() + 12;
        record(&mut cycle, &QUESTION, TYPE_CNAME, b"\x04edge\xC0\x18");
        record(&mut cycle, &[0xC0, edge as u8], TYPE_CNAME, &QUESTION);
        assert_eq!(bounded(cycle), NONE);
    }

    #[tokio::test]
    async fn the_resolver_leaves_the_port_to_the_url() {
        use tower_service::Service;
        let mut resolver = Resolver::new(|_| Box::pin(async { Ok(Ipv4Addr::new(104, 16, 1, 2)) }));
        let host: Name = HOST.parse().unwrap();
        let addresses: Vec<SocketAddr> = resolver.call(host).await.unwrap().collect();
        // hyper-util replaces port 0 with the URL port, or with 443 when the URL has none.
        assert_eq!(addresses, ["104.16.1.2:0".parse::<SocketAddr>().unwrap()]);
    }

    /// A loopback DNS server that answers each query with `reply(query)` datagrams.
    async fn server(reply: impl Fn(&[u8]) -> Vec<Vec<u8>> + Send + 'static) -> SocketAddr {
        let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let address = socket.local_addr().unwrap();
        tokio::spawn(async move {
            let mut buffer = [0u8; 512];
            while let Ok((n, peer)) = socket.recv_from(&mut buffer).await {
                for datagram in reply(&buffer[..n]) {
                    let _ = socket.send_to(&datagram, peer).await;
                }
            }
        });
        address
    }

    fn reply_to(query: &[u8], flags: u16, address: Option<[u8; 4]>) -> Vec<u8> {
        let mut message = query.to_vec();
        message[2..4].copy_from_slice(&flags.to_be_bytes());
        if let Some(address) = address {
            message[7] = 1;
            record(&mut message, &QUESTION, TYPE_A, &address);
        }
        message
    }

    #[tokio::test]
    async fn a_lookup_skips_spoofed_and_oversized_datagrams() {
        let server = server(|query| {
            let id = u16::from_be_bytes([query[0], query[1]]);
            let mut spoofed = reply_to(query, 0x8180, Some([6, 6, 6, 6]));
            spoofed[..2].copy_from_slice(&id.wrapping_add(1).to_be_bytes());
            let mut oversized = reply_to(query, 0x8180, Some([5, 5, 5, 5]));
            oversized.resize(MAX_MESSAGE + 1, 0);
            vec![spoofed, oversized, reply_to(query, 0x8180, Some([104, 16, 1, 2]))]
        })
        .await;
        assert_eq!(lookup_at(HOST, &[server]).await, Ok(Ipv4Addr::new(104, 16, 1, 2)));
    }

    #[tokio::test]
    async fn a_lookup_takes_an_address_from_any_server() {
        let missing = server(|query| vec![reply_to(query, 0x8183, None)]).await;
        let found = server(|query| vec![reply_to(query, 0x8180, Some([104, 16, 1, 2]))]).await;
        assert_eq!(lookup_at(HOST, &[missing, found]).await, Ok(Ipv4Addr::new(104, 16, 1, 2)));
        assert_eq!(
            lookup_at(HOST, &[missing]).await.unwrap_err().message,
            "The DNS lookup found no such tunnel name."
        );
    }

    #[tokio::test]
    async fn a_silent_server_keeps_the_other_servers_failure() {
        let silent = server(|_| Vec::new()).await;
        let missing = server(|query| vec![reply_to(query, 0x8183, None)]).await;
        assert_eq!(
            lookup_at(HOST, &[silent, missing]).await.unwrap_err().message,
            "The DNS lookup found no such tunnel name."
        );
        assert_eq!(lookup_at(HOST, &[silent]).await.unwrap_err().message, "The DNS lookup timed out.");
        assert_eq!(
            lookup_at(HOST, &[]).await.unwrap_err().message,
            "The DNS configuration has no nameserver."
        );
    }
}
