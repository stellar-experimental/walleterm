//! The few operating system calls that std does not provide. Every `unsafe` block lives here.

use std::ffi::CStr;
use std::io::{self, Read};
use std::os::fd::RawFd;
use std::path::PathBuf;
use std::time::Instant;

/// The 1Password SSH agent socket for the current account, or `None` off macOS.
/// The path comes from the account database for the real user ID, never from `HOME` or `SSH_AUTH_SOCK`.
pub fn agent_socket() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let home = home_dir(current_uid())?;
    Some(home.join("Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"))
}

/// The home directory of the real user, from the account database. `HOME` does not change it.
pub fn account_home() -> Option<PathBuf> {
    home_dir(current_uid())
}

pub fn current_uid() -> u32 {
    // SAFETY: getuid has no preconditions and cannot fail.
    unsafe { libc::getuid() }
}

fn home_dir(uid: u32) -> Option<PathBuf> {
    let mut buffer = vec![0u8; 4096];
    loop {
        // SAFETY: passwd is plain data; getpwuid_r writes it and the strings into `buffer`, whose length we pass.
        let mut entry: libc::passwd = unsafe { std::mem::zeroed() };
        let mut result: *mut libc::passwd = std::ptr::null_mut();
        let status = unsafe {
            libc::getpwuid_r(uid, &mut entry, buffer.as_mut_ptr().cast(), buffer.len(), &mut result)
        };
        if status == libc::ERANGE && buffer.len() < 1 << 20 {
            buffer.resize(buffer.len() * 2, 0);
            continue;
        }
        if status != 0 || result.is_null() || entry.pw_dir.is_null() {
            return None;
        }
        // SAFETY: on success pw_dir points to a NUL-terminated string inside `buffer`, which is still alive.
        let dir = unsafe { CStr::from_ptr(entry.pw_dir) }.to_str().ok()?;
        return (!dir.is_empty()).then(|| PathBuf::from(dir));
    }
}

/// The terminal width of standard output, or `None` when it is not a terminal.
pub fn terminal_columns() -> Option<usize> {
    // SAFETY: winsize is plain data; TIOCGWINSZ fills it for a terminal and fails otherwise.
    let mut size: libc::winsize = unsafe { std::mem::zeroed() };
    let ok = unsafe { libc::ioctl(libc::STDOUT_FILENO, libc::TIOCGWINSZ, &mut size) } == 0;
    (ok && size.ws_col > 0).then_some(usize::from(size.ws_col))
}

/// Wait until `fd` is readable or `deadline` passes. Returns `false` on timeout.
/// A hang-up or error also counts as ready; the next read or write reports it.
pub fn wait_readable(fd: RawFd, deadline: Instant) -> io::Result<bool> {
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Ok(false);
        }
        let millis = i32::try_from(left.as_millis().max(1)).unwrap_or(i32::MAX);
        let mut poll = libc::pollfd { fd, events: libc::POLLIN, revents: 0 };
        // SAFETY: one valid pollfd for the duration of the call.
        let ready = unsafe { libc::poll(&mut poll, 1, millis) };
        match ready {
            -1 if io::Error::last_os_error().kind() == io::ErrorKind::Interrupted => continue,
            -1 => return Err(io::Error::last_os_error()),
            0 => continue,
            _ => return Ok(true),
        }
    }
}

/// A descriptor (standard input in the CLI) with one absolute deadline across every read.
pub struct DeadlineReader {
    pub fd: RawFd,
    pub deadline: Instant,
}

impl Read for DeadlineReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if !wait_readable(self.fd, self.deadline)? {
            return Err(io::ErrorKind::TimedOut.into());
        }
        loop {
            // SAFETY: `buf` is valid for `buf.len()` writable bytes.
            let n = unsafe { libc::read(self.fd, buf.as_mut_ptr().cast(), buf.len()) };
            if n >= 0 {
                return Ok(n as usize);
            }
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::Interrupted {
                return Err(error);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn home_comes_from_the_account_database() {
        let home = home_dir(current_uid()).expect("the test user has a home directory");
        assert!(home.is_absolute());
        if cfg!(target_os = "macos") {
            assert!(agent_socket().unwrap().ends_with("2BUA8C4S2C.com.1password/t/agent.sock"));
        }
    }

    #[test]
    fn wait_readable_times_out_on_a_silent_pipe() {
        let mut fds = [0; 2];
        // SAFETY: pipe writes two descriptors into the array.
        assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
        let start = Instant::now();
        assert!(!wait_readable(fds[0], start + Duration::from_millis(50)).unwrap());
        assert!(start.elapsed() >= Duration::from_millis(50));
        // SAFETY: both descriptors came from pipe and are closed once.
        unsafe {
            assert_eq!(libc::write(fds[1], b"x".as_ptr().cast(), 1), 1);
        }
        assert!(wait_readable(fds[0], Instant::now() + Duration::from_secs(1)).unwrap());
        unsafe {
            libc::close(fds[0]);
            libc::close(fds[1]);
        }
    }
}
