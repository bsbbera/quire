// Quire desktop shell.
//
// Owns two child processes for the lifetime of the window:
//   * the model shim   (node <resource>/cli-shim/server.mjs)  — port 8787
//   * Quire Studio     (node <resource>/cli-shim/studio.mjs)  — port 4567
//
// Everything the UI needs is served by the shim over HTTP, so this file stays
// small on purpose: spawn, wait for the ports, hand the window a URL, and make
// absolutely sure nothing survives the window closing.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{create_dir_all, File};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
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

/// The build stamped onto every child we launch, so a later launch can tell
/// its own servers from ones an older install left behind on the ports.
///
/// The version alone was not enough to tell two builds apart. It changes once
/// per release; the UI changes every build. So a dev build that was
/// force-killed left a server holding the port, the next launch compared
/// 0.1.22 against 0.1.22, concluded its own server was already running, and
/// reused it - serving the previous build's UI from a binary that had just
/// been replaced. Nothing looked wrong, which is the worst part: it makes
/// every test result a claim about whichever build happened to boot first.
///
/// The suffix is a hash of Studio's index.html, whose asset names are content
/// hashes, so it moves when and only when the served UI moves. See build.rs.
const BUILD: &str = concat!(env!("CARGO_PKG_VERSION"), "+", env!("QUIRE_UI_BUILD"));

/// One-shot HTTP GET on loopback. Two calls at boot do not justify pulling a
/// whole HTTP client into the build.
fn http_get(port: u16, path: &str) -> Option<String> {
    use std::io::{Read, Write};
    let addr = format!("127.0.0.1:{port}").parse().ok()?;
    let mut sock = TcpStream::connect_timeout(&addr, Duration::from_millis(600)).ok()?;
    sock.set_read_timeout(Some(Duration::from_millis(2000))).ok()?;
    // HTTP/1.0 + close so the server ends the body by ending the connection.
    write!(sock, "GET {path} HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").ok()?;
    let mut raw = String::new();
    sock.read_to_string(&mut raw).ok()?;
    Some(raw)
}

/// `(build, pid)` of whoever answers `path` on `port`. `None` covers every
/// "not one of ours": no route (an older build), a non-200, anything unparsable.
fn server_identity(port: u16, path: &str) -> Option<(String, u32)> {
    let raw = http_get(port, path)?;
    let (head, body) = raw.split_once("\r\n\r\n")?;
    if !head.starts_with("HTTP/1.1 200") && !head.starts_with("HTTP/1.0 200") {
        return None;
    }
    let json: serde_json::Value = serde_json::from_str(body.trim()).ok()?;
    let build = json.get("build")?.as_str()?.to_string();
    let pid = json.get("pid")?.as_u64()? as u32;
    Some((build, pid))
}

/// The PID listening on `port`, and only when it is a Node process. Both ports
/// belong to our own Node servers; nothing else on the machine gets killed to
/// take one back.
fn node_pid_on_port(port: u16) -> Option<u32> {
    #[cfg(windows)]
    {
        let out = Command::new("netstat").args(["-ano", "-p", "TCP"]).output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        let suffix = format!(":{port}");
        let pid: u32 = text
            .lines()
            .filter(|line| line.contains("LISTENING"))
            .find(|line| {
                line.split_whitespace().nth(1).is_some_and(|a| a.ends_with(&suffix))
            })
            .and_then(|line| line.split_whitespace().last())
            .and_then(|pid| pid.parse().ok())?;
        let listed = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
            .output()
            .ok()?;
        let name = String::from_utf8_lossy(&listed.stdout).to_lowercase();
        if name.contains("node.exe") { Some(pid) } else { None }
    }
    #[cfg(not(windows))]
    {
        let out = Command::new("lsof")
            .args([&format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t", "-nP"])
            .output()
            .ok()?;
        let pid: u32 = String::from_utf8_lossy(&out.stdout).trim().lines().next()?.parse().ok()?;
        let comm = Command::new("ps").args(["-p", &pid.to_string(), "-o", "comm="]).output().ok()?;
        if String::from_utf8_lossy(&comm.stdout).contains("node") { Some(pid) } else { None }
    }
}

fn kill_pid(pid: u32) {
    #[cfg(windows)]
    let mut cmd = Command::new("taskkill");
    #[cfg(windows)]
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
    #[cfg(not(windows))]
    let mut cmd = Command::new("kill");
    #[cfg(not(windows))]
    cmd.args(["-9", &pid.to_string()]);
    let _ = cmd.stdout(Stdio::null()).stderr(Stdio::null()).status();
}

/// Whether the server already on `port` is this build's, and so may be reused.
///
/// This used to be a bare `port_open` check. A Studio left running by an older
/// install holds the same port, so an updated app reused the previous version's
/// server: the binary was replaced, the code being served was not, and
/// reinstalling could not fix it because reinstalling does not kill an orphan.
/// A foreign server is now killed so our own can have the port.
fn claim_port(port: u16, ident: &str, label: &str, notes: &mut Vec<String>) -> bool {
    if !port_open(port) { return false; }

    let found = server_identity(port, ident);
    if let Some((build, _)) = &found {
        if build == BUILD {
            notes.push(format!("{label} already running on port {port} — reusing it"));
            return true;
        }
    }

    let was = found.as_ref().map_or("an unknown build".to_string(), |(b, _)| format!("build {b}"));
    let pid = found.map(|(_, pid)| pid).or_else(|| node_pid_on_port(port));
    let Some(pid) = pid else {
        notes.push(format!("port {port} held by {was} that will not identify itself — reusing it"));
        return true;
    };

    notes.push(format!("port {port} held by {label} from {was} — replacing it"));
    kill_pid(pid);
    for _ in 0..20 {
        if !port_open(port) { return false; }
        std::thread::sleep(Duration::from_millis(250));
    }
    notes.push(format!("port {port} did not free up — reusing what is on it"));
    true
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

/// Where a child's stdout/stderr is kept. Truncated per launch: this is for
/// diagnosing the run that just failed, not an archive.
fn child_log(dir: Option<&Path>, name: &str) -> Option<(Stdio, Stdio)> {
    let dir = dir?;
    create_dir_all(dir).ok()?;
    let path = dir.join(format!("{name}.log"));
    let out = File::create(&path).ok()?;
    let err = out.try_clone().ok()?;
    Some((Stdio::from(out), Stdio::from(err)))
}

fn spawn_child(mut cmd: Command, log_dir: Option<&Path>, name: &str) -> Option<Child> {
    clean_env(&mut cmd);
    // Discarding child output meant that when the shim died mid-run, the only
    // symptom was Studio reporting "cannot reach the API service" and there was
    // nothing anywhere to say why. Keep the output.
    let (out, err) = child_log(log_dir, name).unwrap_or((Stdio::null(), Stdio::null()));
    cmd.stdin(Stdio::null()).stdout(out).stderr(err);
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

    let log_dir = app.path().app_log_dir().ok();
    match log_dir.as_deref() {
        Some(dir) => notes.push(format!("child logs: {}", dir.display())),
        None => notes.push("no writable log directory — child output is discarded".into()),
    }

    // The shim ships inside the bundle; in `tauri dev` it sits next to the repo.
    let shim: PathBuf = app
        .path()
        .resolve("cli-shim/server.mjs", tauri::path::BaseDirectory::Resource)
        .ok()
        .map(plain_path)
        .filter(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from("../../cli-shim/server.mjs"));

    if claim_port(SHIM_PORT, "/build", "the model shim", &mut notes) {
        // Nothing to start: what is on the port is this build's own shim.
    } else if shim.exists() {
        let mut c = command_for("node", &[]);
        c.arg(&shim)
            .env("QUIRE_BUILD", BUILD)
            .env("SHIM_PORT", SHIM_PORT.to_string())
            .env("STUDIO_PORT", STUDIO_PORT.to_string());
        match spawn_child(c, log_dir.as_deref(), "shim") {
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

    if claim_port(STUDIO_PORT, "/api/v1/build", "Quire Studio", &mut notes) {
        // Nothing to start: what is on the port is this build's own Studio.
    } else if studio_launcher.exists() {
        let mut c = command_for("node", &[]);
        c.arg(&studio_launcher)
            .env("QUIRE_BUILD", BUILD)
            .env("STUDIO_PORT", STUDIO_PORT.to_string())
            // Studio needs it too: the CLI providers build their base URL from
            // it, and a dev build beside the release one would otherwise send
            // every CLI request to the other app's shim.
            .env("SHIM_PORT", SHIM_PORT.to_string());
        // Quire already scans ~/.openclaw/skills, ~/.agents/skills and the
        // workspace, but not ~/.claude/skills, which is where Claude Code
        // keeps them — so skills the user already wrote were invisible here.
        // A directory that does not exist is reported as a diagnostic, not an
        // error, so naming it unconditionally is safe.
        if let Ok(home) = app.path().home_dir() {
            c.env("INKOS_SKILL_DIRS", home.join(".claude").join("skills"));
        }
        match spawn_child(c, log_dir.as_deref(), "studio") {
            Some(ch) => children.0.lock().unwrap().push(ch),
            None => notes.push("could not start Quire Studio — is `inkos` installed?".into()),
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
