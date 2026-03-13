use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter as _;
use uuid::Uuid;

const PTY_EVENT_OUTPUT: &str = "pty:output";
const PTY_OUTPUT_BUFFER_MAX_BYTES: usize = 1024 * 1024;
const PTY_SESSION_TTL_AFTER_DONE: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyOutputEvent {
    pub session_id: String,
    pub data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, Arc<PtySession>>>,
}

struct PtySession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send>>,
    output: Mutex<VecDeque<u8>>,
    exit_code: Mutex<Option<i32>>,
}

pub struct PtyOpen {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub reader: Box<dyn Read + Send>,
    pub child: Box<dyn portable_pty::Child + Send>,
}

pub fn open_pty(
    argv: &[String],
    cwd: Option<&Path>,
    env: &HashMap<String, String>,
    size: PtySize,
) -> anyhow::Result<PtyOpen> {
    anyhow::ensure!(!argv.is_empty(), "argv must not be empty");
    let program = argv[0].as_str();

    let mut builder = CommandBuilder::new(program);
    if argv.len() > 1 {
        builder.args(&argv[1..]);
    }
    if let Some(cwd) = cwd {
        builder.cwd(cwd);
    }
    for (k, v) in env {
        builder.env(k, v);
    }

    let pty_system = native_pty_system();
    let pair = pty_system.openpty(size)?;
    let child = pair.slave.spawn_command(builder)?;

    let reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;

    Ok(PtyOpen {
        master: pair.master,
        writer,
        reader,
        child,
    })
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn start(
        self: &Arc<Self>,
        app: tauri::AppHandle,
        argv: Vec<String>,
        cwd: Option<PathBuf>,
        env: HashMap<String, String>,
        cols: u16,
        rows: u16,
    ) -> anyhow::Result<String> {
        let session_id = Uuid::new_v4().to_string();

        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        let opened = open_pty(&argv, cwd.as_deref(), &env, size)?;

        let initial_banner = "[holycrab] PTY session started\r\n";
        let session = Arc::new(PtySession {
            master: Mutex::new(opened.master),
            writer: Mutex::new(opened.writer),
            child: Mutex::new(opened.child),
            output: Mutex::new({
                let mut q = VecDeque::new();
                q.extend(initial_banner.as_bytes());
                q
            }),
            exit_code: Mutex::new(None),
        });

        self.sessions
            .lock()
            .unwrap()
            .insert(session_id.clone(), Arc::clone(&session));

        // Emit a first line immediately so the UI never looks "stuck" even if the spawned
        // command takes a while before producing output.
        let _ = app.emit(
            PTY_EVENT_OUTPUT,
            PtyOutputEvent {
                session_id: session_id.clone(),
                data: initial_banner.to_string(),
                done: None,
                exit_code: None,
            },
        );

        // Stream output.
        let app_output = app.clone();
        let session_id_output = session_id.clone();
        let reader = Mutex::new(opened.reader);
        let session_output = Arc::clone(&session);
        tauri::async_runtime::spawn_blocking(move || {
            let mut buf = vec![0u8; 8192];
            loop {
                let n = {
                    let mut reader = reader.lock().unwrap();
                    match reader.read(&mut buf) {
                        Ok(0) => return,
                        Ok(n) => n,
                        Err(_) => return,
                    }
                };

                {
                    let mut out = session_output.output.lock().unwrap();
                    for &b in &buf[..n] {
                        out.push_back(b);
                    }
                    while out.len() > PTY_OUTPUT_BUFFER_MAX_BYTES {
                        out.pop_front();
                    }
                }

                let data = String::from_utf8_lossy(&buf[..n]).to_string();
                let _ = app_output.emit(
                    PTY_EVENT_OUTPUT,
                    PtyOutputEvent {
                        session_id: session_id_output.clone(),
                        data,
                        done: None,
                        exit_code: None,
                    },
                );
            }
        });

        // Emit done + cleanup.
        let manager = Arc::clone(self);
        let app_done = app.clone();
        let session_id_done = session_id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let session = {
                let sessions = manager.sessions.lock().unwrap();
                sessions.get(&session_id_done).cloned()
            };
            let Some(session) = session else { return };

            let exit_code = {
                let mut child = session.child.lock().unwrap();
                child
                    .wait()
                    .ok()
                    .map(|s| s.exit_code() as i32)
                    .unwrap_or(-1)
            };
            *session.exit_code.lock().unwrap() = Some(exit_code);

            let _ = app_done.emit(
                PTY_EVENT_OUTPUT,
                PtyOutputEvent {
                    session_id: session_id_done.clone(),
                    data: String::new(),
                    done: Some(true),
                    exit_code: Some(exit_code),
                },
            );

            // Keep the session around briefly so the frontend can drain any late output.
            // Then drop the session to avoid leaking PTY resources across runs/tests.
            let manager_cleanup = Arc::clone(&manager);
            let session_id_cleanup = session_id_done.clone();
            tauri::async_runtime::spawn_blocking(move || {
                std::thread::sleep(PTY_SESSION_TTL_AFTER_DONE);
                let _ = manager_cleanup
                    .sessions
                    .lock()
                    .unwrap()
                    .remove(&session_id_cleanup);
            });
        });

        Ok(session_id)
    }

    pub fn drain_output(&self, session_id: &str) -> anyhow::Result<String> {
        let session = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("unknown PTY session"))?;
        let mut out = session.output.lock().unwrap();
        if out.is_empty() {
            return Ok(String::new());
        }
        let bytes: Vec<u8> = out.drain(..).collect();
        Ok(String::from_utf8_lossy(bytes.as_slice()).to_string())
    }

    pub fn write(&self, session_id: &str, data: &str) -> anyhow::Result<()> {
        let session = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("unknown PTY session"))?;
        let mut writer = session.writer.lock().unwrap();
        writer.write_all(data.as_bytes())?;
        writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> anyhow::Result<()> {
        let session = self
            .sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("unknown PTY session"))?;
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        session.master.lock().unwrap().resize(size)?;
        Ok(())
    }

    pub fn close(&self, session_id: &str) -> anyhow::Result<()> {
        let session = self
            .sessions
            .lock()
            .unwrap()
            .remove(session_id)
            .ok_or_else(|| anyhow::anyhow!("unknown PTY session"))?;

        let mut child = session.child.lock().unwrap();
        let _ = child.kill();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_pty_echo_works() {
        let argv = vec![
            "/bin/bash".to_string(),
            "--noprofile".to_string(),
            "--norc".to_string(),
            "-c".to_string(),
            "echo hello".to_string(),
        ];
        let env = HashMap::new();
        let opened = match open_pty(
            &argv,
            None,
            &env,
            PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            },
        ) {
            Ok(v) => v,
            Err(e) => {
                // Some test environments intermittently fail to allocate a PTY (e.g. missing
                // /dev/ptmx). This is an environment issue, not a logic issue; skip the test.
                let msg = format!("{e:#}");
                if msg.contains("No such file or directory") {
                    eprintln!("skipping PTY test due to environment error: {msg}");
                    return;
                }
                panic!("open pty: {msg}");
            }
        };

        let mut reader = opened.reader;
        let mut out = String::new();
        let mut buf = [0u8; 1024];
        loop {
            let n = reader.read(&mut buf).expect("read");
            if n == 0 {
                break;
            }
            out.push_str(&String::from_utf8_lossy(&buf[..n]));
            if out.contains("hello") {
                break;
            }
        }
        assert!(out.contains("hello"), "output={out:?}");
    }
}
