// Quire desktop shell.
//
// Owns two child processes for the lifetime of the window:
//   * the model shim   (node <resource>/cli-shim/server.mjs)  — port 8787
//   * InkOS Studio     (node <resource>/cli-shim/studio.mjs)  — port 4567
//
// Everything the UI needs is served by the shim over HTTP, so this file stays
// small on purpose: spawn, wait for the ports, hand the window a URL, and make
// absolutely sure nothing survives the window closing.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, RunEvent, State};

// Ports are baked in at compile time so a dev build can be installed
// alongside the release one. They must differ: both builds treat an open port
// as "already running, reuse it", so on shared ports the second app to launch
// silently drives the first app's shim and workbench.
const fn port(from_env: Option<&str>, fallback: u16) -> u16 {
    // u16::from_str is not const, so parse the ASCII digits directly.
    let Some(s) = from_env else { return fallback };
    let b = s.as_bytes();
    let mut n: u16 = 0;
    let mut i = 0;
    while i < b.len() {
        assert!(b[i] >= b'0' && b[i] <= b'9', "port must be digits");
        n = n * 10 + (b[i] - b'0') as u16;
        i += 1;
    }
    n
}
const SHIM_PORT: u16 = port(option_env!("QUIRE_SHIM_PORT"), 8787);
const STUDIO_PORT: u16 = port(option_env!("QUIRE_STUDIO_PORT"), 4567);

#[derive(Default)]
struct Children(Mutex<Vec<Child>>);

#[derive(serde::Serialize)]
struct Boot {
    shim_url: String,
    studio_url: String,
    shim_ready: bool,
    studio_ready: bool,
    notes: Vec<String>,
}

fn port_open(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}").parse().unwrap(),
        Duration::from_millis(400),
    )
    .is_ok()
}


/// Windows will not spawn a `.cmd` shim (npm installs `inkos.cmd`) directly, so
/// those must go through `cmd /C`. A real `.exe` must not, or quoting breaks.
fn command_for(program: &str, args: &[&str]) -> Command {
    #[cfg(windows)]
    {
        // Only batch shims need a shell. Routing a real .exe (node) through cmd
        // breaks on arguments cmd reinterprets — notably the \\?\ paths below.
        if program.ends_with(".cmd") || program.ends_with(".bat") {
            let mut c = Command::new("cmd");
            c.arg("/C").arg(program).args(args);
            return c;
        }
    }
    let mut c = Command::new(program);
    c.args(args);
    c
}

/// Tauri resolves resources through `canonicalize`, which on Windows returns a
/// `\\?\C:\...` extended-length path. Node and cmd both choke on that prefix.
fn plain_path(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy().to_string();
    match s.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => p,
    }
}

/// Strip a host agent's session env. A parent Claude Code / Codex leaks
/// ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL and hijacks the child CLI's auth.
fn clean_env(cmd: &mut Command) {
    for (k, _) in std::env::vars() {
        if k.starts_with("CLAUDE_CODE_")
            || k.starts_with("ANTHROPIC_")
            || k.starts_with("CODEX_")
            || k.starts_with("DEVIN_")
        {
            cmd.env_remove(k);
        }
    }
}

fn spawn_child(mut cmd: Command) -> Option<Child> {
    clean_env(&mut cmd);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn().ok()
}

#[tauri::command]
fn boot(app: tauri::AppHandle, children: State<Children>) -> Boot {
    let mut notes = Vec::new();

    // The shim ships inside the bundle; in `tauri dev` it sits next to the repo.
    let shim: PathBuf = app
        .path()
        .resolve("cli-shim/server.mjs", tauri::path::BaseDirectory::Resource)
        .ok()
        .map(plain_path)
        .filter(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from("../../cli-shim/server.mjs"));

    if port_open(SHIM_PORT) {
        notes.push(format!("port {SHIM_PORT} already in use — reusing it"));
    } else if shim.exists() {
        let mut c = command_for("node", &[]);
        c.arg(&shim)
            .env("SHIM_PORT", SHIM_PORT.to_string())
            .env("STUDIO_PORT", STUDIO_PORT.to_string());
        match spawn_child(c) {
            Some(ch) => children.0.lock().unwrap().push(ch),
            None => notes.push("could not start the model shim — is Node installed?".into()),
        }
    } else {
        notes.push(format!("shim not found at {}", shim.display()));
    }

    // Deliberately NOT `inkos studio`: that command also spawns the user's
    // default browser, which drags the workbench out of this window.
    let studio_launcher: PathBuf = app
        .path()
        .resolve("cli-shim/studio.mjs", tauri::path::BaseDirectory::Resource)
        .ok()
        .map(plain_path)
        .filter(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from("../../cli-shim/studio.mjs"));

    if port_open(STUDIO_PORT) {
        notes.push(format!("port {STUDIO_PORT} already in use — reusing it"));
    } else if studio_launcher.exists() {
        let mut c = command_for("node", &[]);
        c.arg(&studio_launcher)
            .env("STUDIO_PORT", STUDIO_PORT.to_string())
            // Studio needs it too: the CLI providers build their base URL from
            // it, and a dev build beside the release one would otherwise send
            // every CLI request to the other app's shim.
            .env("SHIM_PORT", SHIM_PORT.to_string());
        match spawn_child(c) {
            Some(ch) => children.0.lock().unwrap().push(ch),
            None => notes.push("could not start InkOS Studio — is `inkos` installed?".into()),
        }
    } else {
        notes.push(format!("studio launcher not found at {}", studio_launcher.display()));
    }

    // Deliberately does NOT wait for the ports. Blocking here for up to 165s
    // meant the window sat on a motionless "starting..." for the whole of a
    // cold start with no way to tell a slow boot from a hung one. The frontend
    // polls `status` instead and can show progress while this returns at once.
    Boot {
        shim_url: format!("http://127.0.0.1:{SHIM_PORT}"),
        studio_url: format!("http://127.0.0.1:{STUDIO_PORT}"),
        shim_ready: port_open(SHIM_PORT),
        studio_ready: port_open(STUDIO_PORT),
        notes,
    }
}

/// Cheap readiness poll for the boot cover. Both ports are local, so a failed
/// connect returns in well under the 400ms timeout.
#[tauri::command]
fn status() -> Boot {
    Boot {
        shim_url: format!("http://127.0.0.1:{SHIM_PORT}"),
        studio_url: format!("http://127.0.0.1:{STUDIO_PORT}"),
        shim_ready: port_open(SHIM_PORT),
        studio_ready: port_open(STUDIO_PORT),
        notes: Vec::new(),
    }
}

fn reap(children: &Children) {
    if let Ok(mut list) = children.0.lock() {
        for mut child in list.drain(..) {
            // `inkos.cmd` runs under cmd.exe, which spawns node as a grandchild;
            // killing only the direct child would leave the port held. taskkill
            // /T is the one reliable way to take the whole tree down on Windows.
            #[cfg(windows)]
            {
                let _ = Command::new("taskkill")
                    .args(["/PID", &child.id().to_string(), "/T", "/F"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn main() {
    tauri::Builder::default()
        // Launching a second time used to open a second window, which then
        // found the ports already open, took the "reusing it" path and drove
        // the first window's shim and workbench — two windows, one backend,
        // identical content and no clue why. Focus the live window instead.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        // Updates are checked and applied from the UI, not here: the shim and
        // Studio are child processes, and restarting under them mid-write is
        // how a half-written book happens.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Children::default())
        .invoke_handler(tauri::generate_handler![boot, status])
        .build(tauri::generate_context!())
        .expect("failed to build Quire")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                reap(&app.state::<Children>());
            }
        });
}
