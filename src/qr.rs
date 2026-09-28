//! Terminal QR codes: half-block characters on an explicit white background, so any terminal theme scans.

use qrcode::{Color, QrCode};

const QUIET: usize = 2;
const START: &str = "\x1b[47m\x1b[30m";
const END: &str = "\x1b[0m";

/// The QR code as terminal lines, two modules per character row.
pub fn terminal(text: &str) -> String {
    let code = QrCode::new(text.as_bytes()).expect("a short URL or pairing payload fits a QR code");
    let width = code.width();
    let colors = code.to_colors();
    let dark = |x: usize, y: usize| {
        let (x, y) = (x.wrapping_sub(QUIET), y.wrapping_sub(QUIET));
        x < width && y < width && colors[y * width + x] == Color::Dark
    };
    let size = width + 2 * QUIET;
    let mut out = String::new();
    for y in (0..size).step_by(2) {
        out.push_str(START);
        for x in 0..size {
            out.push(match (dark(x, y), dark(x, y + 1)) {
                (false, false) => ' ',
                (true, false) => '▀',
                (false, true) => '▄',
                (true, true) => '█',
            });
        }
        out.push_str(END);
        out.push('\n');
    }
    out
}

/// The visible width of rendered lines, without ANSI color sequences.
pub fn width(rendered: &str) -> usize {
    rendered.lines().map(|l| l.replace(START, "").replace(END, "").chars().count()).max().unwrap_or(0)
}

/// The QR code, or a note when the terminal is too narrow for it.
pub fn for_terminal(text: &str, columns: Option<usize>) -> String {
    let rendered = terminal(text);
    let needed = width(&rendered);
    match columns {
        Some(columns) if columns < needed => format!(
            "This QR code needs {needed} terminal columns. Widen this terminal or use the printed URL and code.\n"
        ),
        _ => rendered,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qr_codes_render_with_a_quiet_zone_and_explicit_colors() {
        let text =
            terminal(r#"{"walleterm":3,"url":"https://bridge-name.trycloudflare.com","code":"01234567"}"#);
        let lines: Vec<&str> = text.lines().collect();
        assert!(lines.iter().all(|l| l.starts_with(START) && l.ends_with(END)));
        let w = width(&text);
        assert!(w > 29 && w % 2 == 1, "{w}");
        assert_eq!(lines.len(), w.div_ceil(2));
        let narrow = for_terminal("https://bridge-name.trycloudflare.com", Some(19));
        assert!(narrow.starts_with("This QR code needs ") && !narrow.contains('\x1b'));
        assert_eq!(for_terminal("x", None), terminal("x"));
    }
}
