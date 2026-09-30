use sha2::{Digest, Sha256};

pub fn sha256(data: &[u8]) -> [u8; 32] {
    Sha256::digest(data).into()
}

/// Lowercase hexadecimal.
pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 15) as usize] as char);
    }
    out
}

/// Decode exactly `N` bytes from lowercase hexadecimal. Uppercase and other lengths fail.
pub fn lower_hex<const N: usize>(text: &str) -> Option<[u8; N]> {
    let digits = text.as_bytes();
    if digits.len() != N * 2 {
        return None;
    }
    let value = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    };
    let mut out = [0u8; N];
    for (byte, [high, low]) in out.iter_mut().zip(digits.as_chunks::<2>().0) {
        *byte = value(*high)? << 4 | value(*low)?;
    }
    Some(out)
}

/// JavaScript `String#length`: UTF-16 code units.
pub fn js_length(text: &str) -> usize {
    text.encode_utf16().count()
}

/// JavaScript `String#trim` whitespace: Unicode White_Space plus U+FEFF, without U+0085.
pub fn js_blank(text: &str) -> bool {
    text.chars().all(|c| (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}')
}

/// The network passphrase check shared by every signing path.
pub fn valid_passphrase(text: &str) -> bool {
    !js_blank(text) && js_length(text) <= 256
}

/// Fill a buffer from the operating system's random source. There is no fallback.
pub fn random<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    getrandom::fill(&mut out).expect("the operating system random source is available");
    out
}

/// An unbiased integer in `0..bound`, by rejection sampling.
pub fn random_below(bound: u32) -> u32 {
    let zone = u32::MAX - (u32::MAX % bound);
    loop {
        let value = u32::from_be_bytes(random::<4>());
        if value < zone {
            return value % bound;
        }
    }
}

/// A 256-bit bearer credential in unpadded Base64url.
pub fn token() -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random::<32>())
}

/// A random version 4 UUID in lowercase text form.
pub fn uuid() -> String {
    let mut b = random::<16>();
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h = hex(&b);
    format!("{}-{}-{}-{}-{}", &h[..8], &h[8..12], &h[12..16], &h[16..20], &h[20..])
}

/// Unix milliseconds as `YYYY-MM-DDTHH:MM:SS.sssZ`, like `Date#toISOString` for years 0000-9999.
/// Days to civil date: Howard Hinnant, https://howardhinnant.github.io/date_algorithms.html#civil_from_days
pub fn iso_millis(ms: i64) -> String {
    let (days, rem) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    let (h, m, s, milli) = (rem / 3_600_000, rem / 60_000 % 60, rem / 1000 % 60, rem % 1000);
    format!("{year:04}-{month:02}-{day:02}T{h:02}:{m:02}:{s:02}.{milli:03}Z")
}

/// `YYYY-MM-DDTHH:MM:SS.sssZ`, as `iso_millis` writes it, as Unix milliseconds.
/// Civil date to days: Howard Hinnant, https://howardhinnant.github.io/date_algorithms.html#days_from_civil
pub fn parse_iso_millis(text: &str) -> Option<i64> {
    let b = text.as_bytes();
    let shape = b.len() == 24
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            10 => *c == b'T',
            13 | 16 => *c == b':',
            19 => *c == b'.',
            23 => *c == b'Z',
            _ => c.is_ascii_digit(),
        });
    if !shape {
        return None;
    }
    let n = |from: usize, to: usize| text[from..to].parse::<i64>().ok();
    let (year, month, day) = (n(0, 4)?, n(5, 7)?, n(8, 10)?);
    let (h, m, s, milli) = (n(11, 13)?, n(14, 16)?, n(17, 19)?, n(20, 23)?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || h > 23 || m > 59 || s > 59 {
        return None;
    }
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    Some(days * 86_400_000 + h * 3_600_000 + m * 60_000 + s * 1000 + milli)
}

/// The local hour, minute, and second of Unix milliseconds. UTC when the local time is unavailable.
fn local_parts(ms: i64) -> (i64, i64, i64) {
    let seconds = ms.div_euclid(1000) as libc::time_t;
    // SAFETY: `localtime_r` reads `seconds` and writes only into `tm`, which it fully owns.
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    let local = unsafe { !libc::localtime_r(&seconds, &mut tm).is_null() };
    if local {
        (tm.tm_hour as i64, tm.tm_min as i64, tm.tm_sec as i64)
    } else {
        let day = ms.rem_euclid(86_400_000);
        (day / 3_600_000, day / 60_000 % 60, day / 1000 % 60)
    }
}

/// A local wall-clock time for the terminal, such as `3:04 PM`.
pub fn local_clock(ms: i64) -> String {
    let (hour, minute, _) = local_parts(ms);
    clock(hour, minute)
}

/// A 12-hour clock time, such as `3:04 PM`.
pub fn clock(hour: i64, minute: i64) -> String {
    let twelve = if hour % 12 == 0 { 12 } else { hour % 12 };
    format!("{twelve}:{minute:02} {}", if hour < 12 { "AM" } else { "PM" })
}

/// The time prefix of each tunnel and demo event line, such as `5:24:07 PM  `.
pub fn stamp(ms: i64) -> String {
    let (hour, minute, second) = local_parts(ms);
    let twelve = if hour % 12 == 0 { 12 } else { hour % 12 };
    format!("{twelve}:{minute:02}:{second:02} {}  ", if hour < 12 { "AM" } else { "PM" })
}

/// The time left until a deadline, in whole minutes rounded up, such as `in 5 minutes`. A passed deadline is `now`.
pub fn minutes_left(ms: i64) -> String {
    let minutes = (ms + 59_999) / 60_000;
    match minutes {
        ..=0 => "now".to_owned(),
        1 => "in 1 minute".to_owned(),
        _ => format!("in {minutes} minutes"),
    }
}

/// Unix time in milliseconds.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trips_every_byte() {
        let all: Vec<u8> = (0..=255).collect();
        let text = hex(&all);
        assert_eq!(text.len(), 512);
        for (i, chunk) in text.as_bytes().chunks(2).enumerate() {
            assert_eq!(lower_hex::<1>(std::str::from_utf8(chunk).unwrap()), Some([i as u8]));
        }
    }

    #[test]
    fn lower_hex_rejects_other_forms() {
        assert_eq!(lower_hex::<1>("AB"), None);
        assert_eq!(lower_hex::<1>("a"), None);
        assert_eq!(lower_hex::<1>("abc"), None);
        assert_eq!(lower_hex::<1>("zz"), None);
        assert_eq!(lower_hex::<1>("é"), None);
        assert_eq!(lower_hex::<2>("00ff"), Some([0, 255]));
    }

    #[test]
    fn iso_millis_matches_date_to_iso_string() {
        for (ms, expected) in [
            (0, "1970-01-01T00:00:00.000Z"),
            (-1, "1969-12-31T23:59:59.999Z"),
            (951_782_400_123, "2000-02-29T00:00:00.123Z"),
            (-2_203_891_200_000, "1900-03-01T00:00:00.000Z"),
            (4_107_542_400_000, "2100-03-01T00:00:00.000Z"),
            (1_800_000_000_000, "2027-01-15T08:00:00.000Z"),
            (253_402_300_799_999, "9999-12-31T23:59:59.999Z"),
        ] {
            assert_eq!(iso_millis(ms), expected);
        }
    }

    #[test]
    fn iso_text_parses_back_to_its_milliseconds() {
        for ms in [0, 951_782_400_123, 1_800_000_000_000, 4_107_542_400_000, 253_402_300_799_999] {
            assert_eq!(parse_iso_millis(&iso_millis(ms)), Some(ms));
        }
        for bad in ["", "2026-09-29T15:04:05Z", "2026-13-01T00:00:00.000Z", "2026-09-29 15:04:05.000Z"] {
            assert_eq!(parse_iso_millis(bad), None, "{bad}");
        }
    }

    #[test]
    fn clock_text_is_twelve_hour_with_a_rounded_up_minute_hint() {
        assert_eq!(clock(0, 5), "12:05 AM");
        assert_eq!(clock(11, 59), "11:59 AM");
        assert_eq!(clock(12, 0), "12:00 PM");
        assert_eq!(clock(15, 4), "3:04 PM");
        assert_eq!(minutes_left(300_000), "in 5 minutes");
        assert_eq!(minutes_left(299_001), "in 5 minutes");
        assert_eq!(minutes_left(60_000), "in 1 minute");
        assert_eq!(minutes_left(1), "in 1 minute");
        assert_eq!(minutes_left(0), "now");
        assert_eq!(minutes_left(-5_000), "now");
        assert!(local_clock(1_800_000_000_000).ends_with('M'));
        let prefix = stamp(1_800_000_000_000);
        assert!(prefix.ends_with("M  ") && prefix.matches(':').count() == 2, "{prefix}");
        assert!(prefix.starts_with(local_clock(1_800_000_000_000).split(' ').next().unwrap()));
    }

    #[test]
    fn random_values_have_the_expected_forms() {
        let t = token();
        assert_eq!(t.len(), 43);
        assert!(t.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
        let u = uuid();
        assert_eq!(u.len(), 36);
        assert_eq!(&u[14..15], "4");
        assert!(matches!(&u[19..20], "8" | "9" | "a" | "b"));
        assert!((0..1000).all(|_| random_below(100_000_000) < 100_000_000));
        assert_ne!(token(), token());
    }

    #[test]
    fn passphrase_uses_javascript_rules() {
        assert!(!valid_passphrase(""));
        assert!(!valid_passphrase(" \t\n\u{feff}\u{a0}\u{2028}\u{3000}"));
        assert!(valid_passphrase("\u{85}"));
        assert!(valid_passphrase("Test SDF Network ; September 2015"));
        assert!(valid_passphrase(&"a".repeat(256)));
        assert!(!valid_passphrase(&"a".repeat(257)));
        // One astral character counts as two UTF-16 units.
        assert!(valid_passphrase(&"😀".repeat(128)));
        assert!(!valid_passphrase(&format!("{}a", "😀".repeat(128))));
    }
}
