//! Embed the demo website that `bun run build` (or the package tool) produced.
//! This script never runs Bun or reaches a network. Missing, stale, or malformed assets fail the build.

#[path = "build/manifest.rs"]
mod manifest;

use std::collections::HashMap;
use std::fmt::Write as _;
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-env-changed=WALLETERM_ASSETS");
    println!("cargo:rerun-if-changed=build/manifest.rs");
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let dir = std::env::var_os("WALLETERM_ASSETS").map_or_else(|| root.join("dist"), PathBuf::from);
    let manifest = dir.join("routes.tsv");
    println!("cargo:rerun-if-changed={}", manifest.display());
    let text = std::fs::read_to_string(&manifest).unwrap_or_else(|_| {
        panic!("The demo assets are missing at {}. Run `bun run build` first.", manifest.display())
    });
    for line in text.lines() {
        if let Some(path) = line.split('\t').nth(3) {
            println!("cargo:rerun-if-changed={path}");
        }
    }
    let entries = manifest::verify(&text, |path| std::fs::read(path)).unwrap_or_else(|e| panic!("{e}"));
    // Embed the verified bytes from a private copy, so a later change to the source cannot enter the binary.
    let mut out = String::new();
    let mut files: HashMap<String, usize> = HashMap::new();
    let mut listing = String::new();
    for (entry, bytes) in entries {
        let next = files.len();
        let index = *files.entry(entry.path.clone()).or_insert_with(|| {
            let copy = out_dir.join(format!("asset-{next}"));
            std::fs::write(&copy, &bytes).unwrap();
            writeln!(out, "static F{next}: &[u8] = include_bytes!({copy:?});").unwrap();
            next
        });
        writeln!(
            listing,
            "    Asset {{ route: {:?}, mime: {:?}, sha256: {:?}, bytes: F{index} }},",
            entry.route, entry.mime, entry.sha256
        )
        .unwrap();
    }
    writeln!(out, "pub static ASSETS: &[Asset] = &[\n{listing}];").unwrap();
    std::fs::write(out_dir.join("assets.rs"), out).unwrap();
}
