use std::path::Path;

/// A fingerprint of the UI this binary is about to ship.
///
/// The app stamps `BUILD` onto every server it launches so a later launch can
/// tell its own servers from orphans left on the ports. That stamp used to be
/// the package version alone, which is the wrong grain: a version changes once
/// per release, and the payload changes every build. Two different builds of
/// 0.1.22 were indistinguishable, so a force-killed app left a server holding
/// the port, the next launch decided it was "already running" and reused it,
/// and the app served the previous build's UI while looking perfectly healthy.
///
/// Studio's index.html names its assets by content hash, so hashing that one
/// file is a precise answer to "is the UI being served different from the UI on
/// disk". It is also stable: an unchanged bundle produces an unchanged id, so
/// this does not force a rebuild on every invocation the way a timestamp would.
fn ui_fingerprint() -> String {
    let index = Path::new("../../cli-shim/engine/studio/dist/index.html");
    println!("cargo:rerun-if-changed=../../cli-shim/engine/studio/dist/index.html");

    let Ok(bytes) = std::fs::read(index) else {
        // A checkout that has not staged the runtime yet still has to compile.
        return "nostage".to_string();
    };

    // FNV-1a. A build id needs to change when the input changes, not to resist
    // an attacker, and that does not justify pulling a hash crate into the
    // build graph.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")[..12].to_string()
}

fn main() {
    println!("cargo:rustc-env=QUIRE_UI_BUILD={}", ui_fingerprint());
    tauri_build::build()
}
