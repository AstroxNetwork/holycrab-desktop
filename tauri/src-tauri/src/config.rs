#[derive(Clone, Debug)]
pub struct EnvConfig {
    pub mqtt_addr: String,
    pub mqtt_tls_addr: String,
    pub control_plane_url: String,
    pub gateway_url: String,
    /// How to handle incoming `cmd` messages.
    pub cmd_mode: CmdMode,
    /// Optional localhost RPC address for agent integrations (OpenClaw plugin, etc).
    pub rpc_addr: Option<String>,
    /// Bearer token required for the local RPC server.
    pub rpc_token: Option<String>,
    /// OpenClaw webhooks base URL (example: `http://127.0.0.1:3000/hooks`).
    pub openclaw_hooks_url: Option<String>,
    /// OpenClaw webhooks bearer token.
    pub openclaw_hooks_token: Option<String>,
    /// OpenClaw Gateway WS auth token (used only by the WS transport).
    pub openclaw_ws_token: Option<String>,
    /// OpenClaw hook name (used when `openclaw_hooks_url` is a base URL; default: `wake`).
    pub openclaw_hook: String,
    /// OpenClaw hook name for agent/task messages (default: `OPENCLAW_HOOK` / `wake`).
    pub openclaw_agent_hook: String,
    /// OpenClaw wake mode (`now` | `next-heartbeat`).
    pub openclaw_wake_mode: String,
    /// Dev escape hatch. If false, the daemon refuses to run commands over plaintext MQTT.
    pub allow_insecure_plaintext_mqtt: bool,
    /// How often to poll device status from the control plane (seconds).
    pub device_status_poll_secs: u64,
    /// How often to publish MQTT status heartbeats (seconds).
    pub status_heartbeat_secs: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CmdMode {
    RunShell,
    OpenClaw,
}

pub fn default_rpc_addr() -> String {
    "127.0.0.1:32199".to_string()
}

pub fn generate_rpc_token() -> String {
    // Avoid new deps: use v4 UUID entropy and strip dashes (hex-ish).
    // This is used only as a local bearer token for loopback RPC.
    let a = uuid::Uuid::new_v4().to_string().replace('-', "");
    let b = uuid::Uuid::new_v4().to_string().replace('-', "");
    format!("{a}{b}")
}

fn user_home_dir() -> Option<std::path::PathBuf> {
    if let Some(home) = std::env::var_os("HOME") {
        if !home.is_empty() {
            return Some(std::path::PathBuf::from(home));
        }
    }
    if let Some(home) = std::env::var_os("USERPROFILE") {
        if !home.is_empty() {
            return Some(std::path::PathBuf::from(home));
        }
    }
    let drive = std::env::var_os("HOMEDRIVE");
    let path = std::env::var_os("HOMEPATH");
    match (drive, path) {
        (Some(drive), Some(path)) if !drive.is_empty() && !path.is_empty() => {
            Some(std::path::PathBuf::from(format!(
                "{}{}",
                drive.to_string_lossy(),
                path.to_string_lossy()
            )))
        }
        _ => None,
    }
}

pub fn detect_local_openclaw_hooks_config() -> Option<(String, String)> {
    let enabled = match std::env::var("OPENCLAW_AUTOCONFIG") {
        Ok(v) if v == "0" || v.eq_ignore_ascii_case("false") => false,
        _ => true,
    };
    if !enabled {
        return None;
    }

    let home = user_home_dir()?;
    let path = std::path::Path::new(&home)
        .join(".openclaw")
        .join("openclaw.json");

    let raw = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;

    let port = v
        .pointer("/gateway/port")
        .and_then(|p| p.as_u64())
        .unwrap_or(18789);

    // Hooks auth token can differ from gateway WS auth token (runtime overrides).
    // Prefer hooks.token for SAC's HTTP hook integration.
    let token = v
        .pointer("/hooks/token")
        .and_then(|t| t.as_str())
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .or_else(|| {
            v.pointer("/gateway/auth/token")
                .and_then(|t| t.as_str())
                .map(str::trim)
                .filter(|t| !t.is_empty())
        })?
        .to_string();

    Some((format!("http://127.0.0.1:{port}"), token))
}

#[allow(dead_code)]
pub fn detect_local_openclaw_ws_token() -> Option<String> {
    let enabled = match std::env::var("OPENCLAW_AUTOCONFIG") {
        Ok(v) if v == "0" || v.eq_ignore_ascii_case("false") => false,
        _ => true,
    };
    if !enabled {
        return None;
    }

    let home = user_home_dir()?;
    let path = std::path::Path::new(&home)
        .join(".openclaw")
        .join("openclaw.json");

    let raw = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;

    v.pointer("/gateway/auth/token")
        .and_then(|t| t.as_str())
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
}

fn openclaw_config_path() -> Option<std::path::PathBuf> {
    Some(user_home_dir()?.join(".openclaw").join("openclaw.json"))
}

pub fn detect_local_openclaw_plugin_rpc_config() -> Option<(String, String)> {
    let home = user_home_dir()?;
    let path = std::path::Path::new(&home)
        .join(".openclaw")
        .join("openclaw.json");

    let raw = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;

    let url = v
        .pointer("/plugins/entries/sac-openclaw/config/rpcUrl")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();

    let token = v
        .pointer("/plugins/entries/sac-openclaw/config/rpcToken")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();

    Some((url, token))
}

pub fn rpc_addr_from_url_or_addr(s: &str) -> anyhow::Result<String> {
    let s = s.trim();
    if s.is_empty() {
        anyhow::bail!("rpc url is empty");
    }
    if s.contains("://") {
        let url = url::Url::parse(s)?;
        let host = url
            .host_str()
            .ok_or_else(|| anyhow::anyhow!("rpc url missing host"))?;
        let port = url
            .port_or_known_default()
            .ok_or_else(|| anyhow::anyhow!("rpc url missing port"))?;
        return Ok(format!("{host}:{port}"));
    }
    // Already an address like 127.0.0.1:32199
    Ok(s.to_string())
}

fn normalize_rpc_url(rpc_addr_or_url: &str) -> anyhow::Result<String> {
    let s = rpc_addr_or_url.trim();
    if s.is_empty() {
        anyhow::bail!("rpc address is empty");
    }
    if s.contains("://") {
        // Already a URL.
        let _ = url::Url::parse(s)?;
        return Ok(s.to_string());
    }
    Ok(format!("http://{s}"))
}

fn set_string_path(root: &mut serde_json::Value, path: &[&str], value: &str) -> anyhow::Result<()> {
    use serde_json::Value;

    if path.is_empty() {
        anyhow::bail!("empty json path");
    }

    let mut cur = root;
    for key in &path[..path.len() - 1] {
        match cur {
            Value::Object(map) => {
                cur = map
                    .entry((*key).to_string())
                    .or_insert_with(|| Value::Object(Default::default()));
            }
            _ => {
                *cur = Value::Object(Default::default());
                if let Value::Object(map) = cur {
                    cur = map
                        .entry((*key).to_string())
                        .or_insert_with(|| Value::Object(Default::default()));
                }
            }
        }
    }

    let leaf = path[path.len() - 1];
    match cur {
        Value::Object(map) => {
            map.insert(leaf.to_string(), Value::String(value.to_string()));
            Ok(())
        }
        _ => anyhow::bail!("invalid json structure while setting leaf"),
    }
}

pub fn ensure_openclaw_plugin_rpc_config(rpc_addr: &str, rpc_token: &str) -> anyhow::Result<bool> {
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    let path = match openclaw_config_path() {
        Some(p) => p,
        None => return Ok(false),
    };

    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            tracing::debug!("openclaw config not readable at {}: {e:?}", path.display());
            return Ok(false);
        }
    };

    let mut v: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(
                "openclaw config is not valid json at {}: {e:?}",
                path.display()
            );
            return Ok(false);
        }
    };

    let desired_url = normalize_rpc_url(rpc_addr)?;
    let desired_token = rpc_token.trim();
    if desired_token.is_empty() {
        anyhow::bail!("rpc token is empty");
    }

    let cur_url = v
        .pointer("/plugins/entries/sac-openclaw/config/rpcUrl")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .unwrap_or("");
    let cur_token = v
        .pointer("/plugins/entries/sac-openclaw/config/rpcToken")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .unwrap_or("");

    if cur_url == desired_url && cur_token == desired_token {
        return Ok(false);
    }

    set_string_path(
        &mut v,
        &["plugins", "entries", "sac-openclaw", "config", "rpcUrl"],
        &desired_url,
    )?;
    set_string_path(
        &mut v,
        &["plugins", "entries", "sac-openclaw", "config", "rpcToken"],
        desired_token,
    )?;

    let now = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "unknown-time".to_string());
    let _ = set_string_path(&mut v, &["meta", "lastTouchedAt"], &now);

    let out = serde_json::to_string_pretty(&v)? + "\n";
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, out)?;
    #[cfg(unix)]
    let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    std::fs::rename(&tmp, &path)?;
    #[cfg(unix)]
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));

    Ok(true)
}

fn addr_is_loopback(addr: &str) -> bool {
    // Accept:
    // - 127.0.0.1:1883
    // - localhost:1883
    // - [::1]:1883
    // - ::1:1883 (best-effort)
    let host = addr.rsplit_once(':').map(|(h, _)| h).unwrap_or(addr).trim();

    let host = host.strip_prefix('[').unwrap_or(host);
    let host = host.strip_suffix(']').unwrap_or(host);

    host == "127.0.0.1" || host == "::1" || host.eq_ignore_ascii_case("localhost")
}

impl EnvConfig {
    pub fn from_env_with_state(state: &crate::state::DaemonState) -> anyhow::Result<Self> {
        let mqtt_addr = std::env::var("MQTT_ADDR").unwrap_or_else(|_| "127.0.0.1:1883".to_string());
        let mqtt_tls_addr =
            std::env::var("MQTT_TLS_ADDR").unwrap_or_else(|_| "127.0.0.1:8883".to_string());
        // Precedence:
        // - process env vars (explicit; useful in dev and launchers)
        // - persisted state.json (settings UI)
        // - defaults
        let control_plane_url = std::env::var("CONTROL_PLANE_URL")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                state
                    .control_plane_url
                    .clone()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            })
            .unwrap_or_else(|| "http://127.0.0.1:18080".to_string());
        let gateway_url = std::env::var("GATEWAY_URL")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                state
                    .gateway_url
                    .clone()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            })
            .unwrap_or_else(|| control_plane_url.clone());

        let cmd_mode = match std::env::var("SAC_CMD_MODE") {
            Ok(v) if v.eq_ignore_ascii_case("openclaw") => CmdMode::OpenClaw,
            Ok(v) if v.eq_ignore_ascii_case("run_shell") => CmdMode::RunShell,
            Ok(v) if v.eq_ignore_ascii_case("shell") => CmdMode::RunShell,
            Ok(v) if v.trim().is_empty() => CmdMode::OpenClaw,
            Ok(v) => {
                tracing::warn!(
                    "unknown SAC_CMD_MODE '{v}' (expected run_shell|openclaw); defaulting to openclaw"
                );
                CmdMode::OpenClaw
            }
            Err(_) => CmdMode::OpenClaw,
        };

        // Single source of truth: persisted daemon state.
        // (Avoid env-based overrides; scripts should edit state.json explicitly when needed.)
        let rpc_addr = state.rpc_addr.clone().filter(|s| !s.trim().is_empty());
        let rpc_token = state.rpc_token.clone().filter(|s| !s.trim().is_empty());

        let (autourl, autohooks) = detect_local_openclaw_hooks_config()
            .unwrap_or_else(|| ("".to_string(), "".to_string()));
        let openclaw_hooks_url = state
            .openclaw_hooks_url
            .clone()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| (!autourl.is_empty()).then_some(autourl));
        let openclaw_hooks_token = state
            .openclaw_hooks_token
            .clone()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| (!autohooks.is_empty()).then_some(autohooks));
        let openclaw_ws_token = state
            .openclaw_ws_token
            .clone()
            .filter(|s| !s.trim().is_empty());

        let openclaw_hook = state
            .openclaw_hook
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "wake".to_string());

        let openclaw_agent_hook = state
            .openclaw_agent_hook
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "agent".to_string());

        let openclaw_wake_mode = state
            .openclaw_wake_mode
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "next-heartbeat".to_string());

        let allow_insecure_plaintext_mqtt = match std::env::var("ALLOW_INSECURE_PLAINTEXT_MQTT") {
            Ok(v) if v == "1" || v.eq_ignore_ascii_case("true") => true,
            Ok(v) if v == "0" || v.eq_ignore_ascii_case("false") => false,
            _ => addr_is_loopback(&mqtt_addr),
        };

        let device_status_poll_secs = std::env::var("DEVICE_STATUS_POLL_SECS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(5);
        let status_heartbeat_secs = std::env::var("SAC_STATUS_HEARTBEAT_SECS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(10)
            .max(1);

        let normalize_provider = |raw: String| -> Option<String> {
            let lower = raw.trim().to_ascii_lowercase();
            if lower.is_empty() {
                None
            } else {
                Some(lower)
            }
        };

        Ok(Self {
            mqtt_addr,
            mqtt_tls_addr,
            control_plane_url,
            gateway_url,
            cmd_mode,
            rpc_addr,
            rpc_token,
            openclaw_hooks_url,
            openclaw_hooks_token,
            openclaw_ws_token,
            openclaw_hook,
            openclaw_agent_hook,
            openclaw_wake_mode,
            allow_insecure_plaintext_mqtt,
            device_status_poll_secs,
            status_heartbeat_secs,
        })
    }
}

pub fn env_changed_for_runtime(prev: &EnvConfig, next: &EnvConfig) -> bool {
    prev.control_plane_url != next.control_plane_url
        || prev.gateway_url != next.gateway_url
        || prev.openclaw_hooks_url != next.openclaw_hooks_url
        || prev.openclaw_hooks_token != next.openclaw_hooks_token
        || prev.openclaw_ws_token != next.openclaw_ws_token
}

pub fn init_tracing() {
    use std::sync::Once;
    static INIT: Once = Once::new();

    INIT.call_once(|| {
        // Use AGENT_DAEMON_LOG first, fall back to RUST_LOG, then a safe default.
        let filter = std::env::var("AGENT_DAEMON_LOG")
            .or_else(|_| std::env::var("RUST_LOG"))
            .unwrap_or_else(|_| "info".to_string());

        let env_filter = tracing_subscriber::EnvFilter::try_new(&filter)
            .or_else(|_| tracing_subscriber::EnvFilter::try_new("info"))
            .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

        // Never panic during app startup just because logging was already set up
        // (or because the filter string was malformed).
        let _ = tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .with_target(true)
            .try_init();
    });
}

pub fn unix_ts() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
