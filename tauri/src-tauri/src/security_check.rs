use crate::config::EnvConfig;
use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
use std::process::Command;
use std::time::Duration;
use url::Url;

#[derive(Debug, Serialize)]
pub struct SecurityCheckResult {
    #[serde(rename = "openclawHooksUrl")]
    pub openclaw_hooks_url: Option<String>,
    pub port: u16,
    #[serde(rename = "isListening")]
    pub is_listening: bool,
    #[serde(rename = "listeningAddresses")]
    pub listening_addresses: Vec<String>,
    // Whether we successfully collected a socket list (lsof/netstat). If false, bind exposure is unknown.
    #[serde(rename = "socketListAvailable")]
    pub socket_list_available: bool,
    // One of: not_listening, unknown, loopback_only, non_loopback, all_interfaces
    #[serde(rename = "bindExposure")]
    pub bind_exposure: String,
    #[serde(rename = "isExposedToAllInterfaces")]
    pub is_exposed_to_all_interfaces: bool,
    #[serde(rename = "evidenceSource")]
    pub evidence_source: String,
    pub advice: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct SecurityFixResult {
    pub ok: bool,
    pub changed: bool,
    pub restarted: bool,
    #[serde(rename = "configPath")]
    pub config_path: Option<String>,
    #[serde(rename = "nextBind")]
    pub next_bind: Option<String>,
    #[serde(rename = "restartOutput")]
    pub restart_output: Option<String>,
    pub error: Option<String>,
    pub advice: Vec<String>,
}

pub fn run(env: &EnvConfig) -> SecurityCheckResult {
    let hooks_url = env
        .openclaw_hooks_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let (host, port) = parse_host_port(hooks_url.as_deref()).unwrap_or((None, 18789));

    let mut listening_addresses = detect_listening_addresses(port);
    listening_addresses.sort();
    listening_addresses.dedup();

    let socket_list_available = !listening_addresses.is_empty();

    let loopback_open_v4 = tcp_connects(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port));
    let loopback_open_v6 = tcp_connects(SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), port));
    let host_open = host
        .as_deref()
        .and_then(parse_ip_host)
        .map(|ip| tcp_connects(SocketAddr::new(ip, port)))
        .unwrap_or(false);

    let is_listening =
        !listening_addresses.is_empty() || loopback_open_v4 || loopback_open_v6 || host_open;
    let evidence_source = if socket_list_available {
        "socket_list".to_string()
    } else {
        "tcp_probe".to_string()
    };

    let is_exposed_to_all_interfaces = listening_addresses.iter().any(|a| is_any_addr(a));

    let mut advice = Vec::new();
    let bind_exposure = if !is_listening {
        "not_listening".to_string()
    } else if !socket_list_available {
        "unknown".to_string()
    } else if is_exposed_to_all_interfaces {
        "all_interfaces".to_string()
    } else if listening_addresses.iter().any(|a| is_non_loopback_addr(a)) {
        "non_loopback".to_string()
    } else if listening_addresses.iter().any(|a| is_loopback_addr(a)) {
        "loopback_only".to_string()
    } else {
        "unknown".to_string()
    };

    match bind_exposure.as_str() {
        "not_listening" => {
            advice.push(format!(
                "OpenClaw inbound port {port} does not appear to be listening (check the gateway is running)."
            ));
        }
        "all_interfaces" => {
            advice.push(format!(
                "OpenClaw inbound port {port} is bound to all interfaces (0.0.0.0 / ::). Avoid exposing this on untrusted networks."
            ));
            advice.push(
                "Bind OpenClaw to loopback (127.0.0.1 / ::1) for local-only access.".to_string(),
            );
            advice.push("Re-check with netstat/lsof after changing the bind setting.".to_string());
        }
        "non_loopback" => {
            advice.push(format!(
                "OpenClaw inbound port {port} is bound to a non-loopback interface (network accessible)."
            ));
            advice.push(
                "Bind OpenClaw to loopback (127.0.0.1 / ::1) for local-only access.".to_string(),
            );
            advice.push(
                "If you need LAN access, keep this intentional and use a firewall/VPN.".to_string(),
            );
        }
        "loopback_only" => {
            advice.push(format!(
                "OpenClaw inbound port {port} appears to be loopback-only (127.0.0.1 / ::1)."
            ));
        }
        _ => {
            advice.push(format!(
                "OpenClaw inbound port {port} appears to be listening, but the bind address could not be determined."
            ));
            advice
                .push("If you intended local-only access, set gateway.bind=loopback.".to_string());
            advice.push(
                "You can verify with `lsof -nP -iTCP:<port> -sTCP:LISTEN` or `netstat -an`."
                    .to_string(),
            );
        }
    }

    SecurityCheckResult {
        openclaw_hooks_url: hooks_url,
        port,
        is_listening,
        listening_addresses,
        socket_list_available,
        bind_exposure,
        is_exposed_to_all_interfaces,
        evidence_source,
        advice,
    }
}

pub fn apply_fix_loopback(env: &EnvConfig) -> SecurityFixResult {
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    let mut advice = Vec::new();

    let profile = std::env::var("OPENCLAW_PROFILE")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != "default");

    let Some(cfg_path) = openclaw_config_path(profile.as_deref()) else {
        return SecurityFixResult {
            ok: false,
            changed: false,
            restarted: false,
            config_path: None,
            next_bind: None,
            restart_output: None,
            error: Some("could not resolve OpenClaw config path".to_string()),
            advice: vec![
                "Ensure HOME is set and OpenClaw config exists under ~/.openclaw/openclaw.json."
                    .to_string(),
            ],
        };
    };

    let raw = match std::fs::read_to_string(&cfg_path) {
        Ok(v) => v,
        Err(e) => {
            return SecurityFixResult {
                ok: false,
                changed: false,
                restarted: false,
                config_path: Some(cfg_path.display().to_string()),
                next_bind: None,
                restart_output: None,
                error: Some(format!("failed to read OpenClaw config: {e:?}")),
                advice: vec![
                    "Create OpenClaw config by running the gateway once, then retry.".to_string(),
                ],
            };
        }
    };

    let mut v: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            return SecurityFixResult {
                ok: false,
                changed: false,
                restarted: false,
                config_path: Some(cfg_path.display().to_string()),
                next_bind: None,
                restart_output: None,
                error: Some(format!("OpenClaw config is not valid JSON: {e:?}")),
                advice: vec!["Fix ~/.openclaw/openclaw.json JSON, then retry.".to_string()],
            };
        }
    };

    let cur_bind = v
        .pointer("/gateway/bind")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .unwrap_or("");

    let next_bind = "loopback";
    let changed = cur_bind != next_bind;
    if changed {
        if let Err(e) = set_string_path(&mut v, &["gateway", "bind"], next_bind) {
            return SecurityFixResult {
                ok: false,
                changed: false,
                restarted: false,
                config_path: Some(cfg_path.display().to_string()),
                next_bind: Some(next_bind.to_string()),
                restart_output: None,
                error: Some(format!("failed to update OpenClaw config: {e:?}")),
                advice: vec!["Try editing gateway.bind manually to \"loopback\".".to_string()],
            };
        }

        let out = match serde_json::to_string_pretty(&v) {
            Ok(s) => s + "\n",
            Err(e) => {
                return SecurityFixResult {
                    ok: false,
                    changed: false,
                    restarted: false,
                    config_path: Some(cfg_path.display().to_string()),
                    next_bind: Some(next_bind.to_string()),
                    restart_output: None,
                    error: Some(format!("failed to serialize OpenClaw config: {e:?}")),
                    advice: vec!["Try editing gateway.bind manually to \"loopback\".".to_string()],
                };
            }
        };

        let tmp = cfg_path.with_extension("json.tmp");
        if let Err(e) = std::fs::write(&tmp, out) {
            return SecurityFixResult {
                ok: false,
                changed: false,
                restarted: false,
                config_path: Some(cfg_path.display().to_string()),
                next_bind: Some(next_bind.to_string()),
                restart_output: None,
                error: Some(format!("failed to write temp OpenClaw config: {e:?}")),
                advice: vec!["Check file permissions for ~/.openclaw/openclaw.json.".to_string()],
            };
        }
        #[cfg(unix)]
        {
            let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
        }
        if let Err(e) = std::fs::rename(&tmp, &cfg_path) {
            return SecurityFixResult {
                ok: false,
                changed: false,
                restarted: false,
                config_path: Some(cfg_path.display().to_string()),
                next_bind: Some(next_bind.to_string()),
                restart_output: None,
                error: Some(format!("failed to replace OpenClaw config: {e:?}")),
                advice: vec!["Check file permissions for ~/.openclaw/openclaw.json.".to_string()],
            };
        }
        #[cfg(unix)]
        {
            let _ = std::fs::set_permissions(&cfg_path, std::fs::Permissions::from_mode(0o600));
        }
    }

    // Restart the gateway service if possible.
    let restart = Command::new("openclaw")
        .args(["gateway", "restart"])
        .output();

    let (restarted, restart_output, restart_error) = match restart {
        Ok(out) => {
            let mut combined = String::new();
            if !out.stdout.is_empty() {
                combined.push_str(&String::from_utf8_lossy(&out.stdout));
            }
            if !out.stderr.is_empty() {
                if !combined.is_empty() {
                    combined.push('\n');
                }
                combined.push_str(&String::from_utf8_lossy(&out.stderr));
            }
            let restarted = out.status.success();
            (
                restarted,
                Some(combined.trim().to_string()).filter(|s| !s.is_empty()),
                None,
            )
        }
        Err(e) => (false, None, Some(format!("{e:?}"))),
    };

    if restart_error.is_some() {
        advice.push("OpenClaw CLI not found or not runnable. Install OpenClaw CLI and restart the gateway manually.".to_string());
    }
    if !restarted {
        advice.push("If restart failed, run `openclaw gateway restart` in a terminal to see the full error.".to_string());
    }

    // If the daemon is configured to talk to OpenClaw via a non-loopback URL, call that out.
    if let Some(url) = env.openclaw_hooks_url.as_deref() {
        if let Ok(parsed) = Url::parse(url) {
            if let Some(host) = parsed.host_str() {
                if host != "127.0.0.1" && host != "::1" && !host.eq_ignore_ascii_case("localhost") {
                    advice.push(format!(
                        "Your OpenClaw Hooks URL is set to '{host}'. Consider using 127.0.0.1 for local-only access."
                    ));
                }
            }
        }
    }

    let ok = changed && restarted || (!changed && restarted);
    SecurityFixResult {
        ok,
        changed,
        restarted,
        config_path: Some(cfg_path.display().to_string()),
        next_bind: Some(next_bind.to_string()),
        restart_output,
        error: restart_error,
        advice,
    }
}

fn parse_host_port(hooks_url: Option<&str>) -> Option<(Option<String>, u16)> {
    let hooks_url = hooks_url?;
    let parsed = Url::parse(hooks_url).ok()?;
    let host = parsed.host_str().map(|s| s.to_string());
    let port = parsed.port_or_known_default().unwrap_or(18789) as u16;
    Some((host, port))
}

fn openclaw_config_path(profile: Option<&str>) -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME")?;
    let base = std::path::PathBuf::from(home);
    let dir = match profile {
        Some(p) if !p.trim().is_empty() => base.join(format!(".openclaw-{}", p.trim())),
        _ => base.join(".openclaw"),
    };
    Some(dir.join("openclaw.json"))
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

fn parse_ip_host(host: &str) -> Option<IpAddr> {
    let host = host.trim();
    if host.is_empty() {
        return None;
    }
    host.parse::<IpAddr>().ok()
}

fn tcp_connects(addr: SocketAddr) -> bool {
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

fn detect_listening_addresses(port: u16) -> Vec<String> {
    if let Some(addrs) = try_lsof(port) {
        return addrs;
    }
    if cfg!(target_os = "windows") {
        if let Some(addrs) = try_netstat_windows(port) {
            return addrs;
        }
    } else {
        if let Some(addrs) = try_netstat_unix(port) {
            return addrs;
        }
    }
    Vec::new()
}

fn try_lsof(port: u16) -> Option<Vec<String>> {
    let out = Command::new("lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut addrs = Vec::new();
    for line in stdout.lines() {
        if line.starts_with("COMMAND ") || line.trim().is_empty() {
            continue;
        }
        let toks: Vec<&str> = line.split_whitespace().collect();
        let Some(tcp_i) = toks.iter().position(|t| *t == "TCP") else {
            continue;
        };
        if tcp_i + 1 >= toks.len() {
            continue;
        }
        let addr = toks[tcp_i + 1].trim().to_string();
        if !addr.is_empty() {
            addrs.push(addr);
        }
    }
    Some(addrs)
}

fn try_netstat_windows(port: u16) -> Option<Vec<String>> {
    let out = Command::new("netstat").arg("-ano").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut addrs = Vec::new();
    for line in stdout.lines() {
        let s = line.trim();
        if s.is_empty() || !s.to_ascii_uppercase().contains("LISTENING") {
            continue;
        }
        let cols: Vec<&str> = s.split_whitespace().collect();
        if cols.len() < 4 {
            continue;
        }
        let local = cols[1];
        if local.ends_with(&format!(":{port}")) {
            addrs.push(local.to_string());
        }
    }
    Some(addrs)
}

fn try_netstat_unix(port: u16) -> Option<Vec<String>> {
    // Best-effort: portable-ish netstat output parsing.
    let out = Command::new("netstat").args(["-an"]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut addrs = Vec::new();
    for line in stdout.lines() {
        let s = line.trim();
        if s.is_empty() {
            continue;
        }
        let upper = s.to_ascii_uppercase();
        if !upper.contains("LISTEN") {
            continue;
        }
        // Usually: proto recvq sendq local foreign (state)
        let cols: Vec<&str> = s.split_whitespace().collect();
        if cols.len() < 4 {
            continue;
        }
        let local = cols[3];
        if port_matches_local(local, port) {
            addrs.push(local.to_string());
        }
    }
    Some(addrs)
}

fn port_matches_local(local: &str, port: u16) -> bool {
    let local = local.trim();
    if local.is_empty() {
        return false;
    }
    if let Some((_, p)) = local.rsplit_once(':') {
        return p.parse::<u16>().ok() == Some(port);
    }
    // macOS often shows *.18789
    if let Some(p) = local.rsplit_once('.').map(|(_, p)| p) {
        return p.parse::<u16>().ok() == Some(port);
    }
    false
}

fn is_any_addr(addr: &str) -> bool {
    let a = addr.trim();
    // lsof: *:18789
    if a.starts_with("*:") {
        return true;
    }
    // common forms
    if a.starts_with("0.0.0.0:") {
        return true;
    }
    // netstat macOS sometimes uses dots: 0.0.0.0.18789
    if a.starts_with("0.0.0.0.") {
        return true;
    }
    if a.starts_with("[::]:") {
        return true;
    }
    // macOS netstat: *.18789
    if a.starts_with("*.") {
        return true;
    }
    // Some tools emit :::18789 (ipv6 any).
    if a.starts_with(":::") {
        return true;
    }
    false
}

fn is_loopback_addr(addr: &str) -> bool {
    match extract_ip(addr) {
        Some(ip) => ip.is_loopback(),
        None => false,
    }
}

fn is_non_loopback_addr(addr: &str) -> bool {
    match extract_ip(addr) {
        Some(ip) => !ip.is_loopback(),
        None => false,
    }
}

fn extract_ip(addr: &str) -> Option<IpAddr> {
    let a = addr.trim();
    if a.is_empty() || is_any_addr(a) {
        return None;
    }

    // lsof typically yields numeric addresses because we pass -n.
    // Examples:
    // - 127.0.0.1:18789
    // - [::1]:18789
    // - 127.0.0.1.18789 (netstat on macOS)
    // - ::1.18789 (netstat on macOS)
    let host = if let Some(rest) = a.strip_prefix('[') {
        rest.split(']').next().unwrap_or("").trim().to_string()
    } else if a.contains(':') {
        // Prefer last ':' split for IPv4; IPv6 here is ambiguous, but if it's bracketed we'll have already handled it.
        a.rsplit_once(':').map(|(h, _)| h.trim().to_string())?
    } else if a.contains('.') {
        // netstat macOS: 127.0.0.1.18789
        a.rsplit_once('.').map(|(h, _)| h.trim().to_string())?
    } else {
        return None;
    };

    if host.is_empty() {
        return None;
    }

    host.parse::<IpAddr>().ok()
}
