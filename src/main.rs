use std::time::Instant;

use walleterm::cli::{DEADLINE, Io, run};
use walleterm::platform::{DeadlineReader, agent_socket};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let deadline = Instant::now() + DEADLINE;
    let socket = agent_socket();
    let (mut stdout, mut stderr) = (std::io::stdout().lock(), std::io::stderr().lock());
    let mut io = Io {
        input: &mut DeadlineReader { fd: libc::STDIN_FILENO, deadline },
        out: &mut stdout,
        diagnostic: &mut stderr,
        socket: socket.as_deref(),
        deadline,
    };
    std::process::exit(run(&args, &mut io));
}
