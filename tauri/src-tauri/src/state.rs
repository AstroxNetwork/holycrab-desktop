use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::path::PathBuf;
use tokio::sync::Mutex;

const DEFAULT_DICTATION_MODEL_ID: &str = "base";
const DEFAULT_DICTATION_HOLD_KEY: &str = "alt";
const DEFAULT_CHAT_DISPLAY_MODE: &str = "full";
const DEFAULT_CHAT_COPY_MODE: &str = "markdown";
const DEFAULT_CHAT_BOT_AVATAR: &str = "default";

pub fn default_dictation_model_id() -> String {
    DEFAULT_DICTATION_MODEL_ID.to_string()
}

pub fn default_dictation_hold_key() -> String {
    DEFAULT_DICTATION_HOLD_KEY.to_string()
}

pub fn default_chat_display_mode() -> String {
    DEFAULT_CHAT_DISPLAY_MODE.to_string()
}

pub fn default_chat_copy_mode() -> String {
    DEFAULT_CHAT_COPY_MODE.to_string()
}

pub fn default_chat_bot_avatar() -> String {
    DEFAULT_CHAT_BOT_AVATAR.to_string()
}

fn normalize_dictation_model_id(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        default_dictation_model_id()
    } else {
        trimmed.to_string()
    }
}

fn normalize_dictation_hold_key(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        default_dictation_hold_key()
    } else {
        trimmed.to_string()
    }
}

fn normalize_optional_language(raw: Option<&str>) -> Option<String> {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppSettings {
    pub dictation_enabled: bool,
    pub dictation_model_id: String,
    pub dictation_language: Option<String>,
    pub dictation_hold_key: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            dictation_enabled: false,
            dictation_model_id: default_dictation_model_id(),
            dictation_language: None,
            dictation_hold_key: default_dictation_hold_key(),
        }
    }
}

impl AppSettings {
    pub fn from_daemon_state(state: &DaemonState) -> Self {
        Self {
            dictation_enabled: state.dictation_enabled,
            dictation_model_id: normalize_dictation_model_id(state.dictation_model_id.as_str()),
            dictation_language: normalize_optional_language(state.dictation_language.as_deref()),
            dictation_hold_key: normalize_dictation_hold_key(state.dictation_hold_key.as_str()),
        }
    }

    pub fn apply_to_daemon_state(&self, state: &mut DaemonState) {
        state.dictation_enabled = self.dictation_enabled;
        state.dictation_model_id = normalize_dictation_model_id(self.dictation_model_id.as_str());
        state.dictation_language = normalize_optional_language(self.dictation_language.as_deref());
        state.dictation_hold_key = normalize_dictation_hold_key(self.dictation_hold_key.as_str());
    }
}

pub struct AppState {
    pub app_settings: Mutex<AppSettings>,
    pub dictation: Mutex<crate::dictation::DictationState>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            app_settings: Mutex::new(AppSettings::default()),
            dictation: Mutex::new(crate::dictation::DictationState::default()),
        }
    }
}

impl AppState {
    pub fn with_settings(settings: AppSettings) -> Self {
        Self {
            app_settings: Mutex::new(settings),
            dictation: Mutex::new(crate::dictation::DictationState::default()),
        }
    }
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BridgeMode {
    OpenClaw,
    ClaudeCode,
    Codex,
}

impl Default for BridgeMode {
    fn default() -> Self {
        Self::OpenClaw
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderProfile {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub custom_params: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DaemonState {
    #[serde(default)]
    pub auth: Option<AuthState>,
    #[serde(default)]
    pub bridge_mode: BridgeMode,
    /// Local RPC address (host:port) for agent integrations (OpenClaw plugin, etc).
    /// Persisted so Finder launches still expose the RPC server.
    #[serde(default)]
    pub rpc_addr: Option<String>,
    /// Local RPC bearer token for agent integrations.
    /// Persisted so Finder launches still expose the RPC server.
    #[serde(default)]
    pub rpc_token: Option<String>,
    /// Optional control plane URL override (persisted via settings UI).
    #[serde(default)]
    pub control_plane_url: Option<String>,
    /// Optional gateway URL override (persisted via settings UI).
    #[serde(default)]
    pub gateway_url: Option<String>,
    /// Dictation toggle.
    #[serde(default)]
    pub dictation_enabled: bool,
    /// Dictation model id.
    #[serde(default = "default_dictation_model_id")]
    pub dictation_model_id: String,
    /// Dictation preferred language (BCP-47-ish short code, e.g. `en`/`zh`).
    #[serde(default)]
    pub dictation_language: Option<String>,
    /// Hold-to-dictate hotkey.
    #[serde(default = "default_dictation_hold_key")]
    pub dictation_hold_key: String,
    /// Chat message display mode (`collapsed` / `content_only` / `full`).
    #[serde(default = "default_chat_display_mode")]
    pub chat_display_mode: String,
    /// Chat copy format preference (`markdown` / `full` / `text`).
    #[serde(default = "default_chat_copy_mode")]
    pub chat_copy_mode: String,
    /// Bot avatar mode (`default` / `holycrab` / `upload`).
    #[serde(default = "default_chat_bot_avatar")]
    pub chat_bot_avatar: String,
    /// User-uploaded bot avatar data URL (when `chat_bot_avatar=upload`).
    #[serde(default)]
    pub chat_bot_avatar_data_url: Option<String>,
    /// Whether companion (Live2D/TTS) mode is enabled.
    #[serde(default)]
    pub companion_enabled: bool,
    /// Active Live2D model id (if any).
    #[serde(default)]
    pub companion_live2d_active_model: Option<String>,
    /// Companion TTS provider (`volcano` / `qwen`).
    #[serde(default)]
    pub companion_tts_provider: Option<String>,
    /// Companion TTS endpoint.
    #[serde(default)]
    pub companion_tts_endpoint: Option<String>,
    /// Companion TTS model identifier.
    #[serde(default)]
    pub companion_tts_model: Option<String>,
    /// Companion TTS voice identifier.
    #[serde(default)]
    pub companion_tts_voice: Option<String>,
    /// Companion TTS namespace (required by Volcano namespace mode).
    #[serde(default)]
    pub companion_tts_namespace: Option<String>,
    /// Companion TTS API key (or token for Volcano HTTP API).
    #[serde(default)]
    pub companion_tts_api_key: Option<String>,
    /// Companion TTS app key (Volcano auth parameter).
    #[serde(default)]
    pub companion_tts_app_key: Option<String>,
    pub device_id: Option<String>,
    /// Device X25519 private key (URL-safe base64, no padding).
    #[serde(default)]
    pub e2ee_device_priv_b64: Option<String>,
    /// Device X25519 public key (URL-safe base64, no padding).
    #[serde(default)]
    pub e2ee_device_pub_b64: Option<String>,
    /// Pinned server key id for broker-blind E2EE.
    #[serde(default)]
    pub e2ee_server_kid: Option<String>,
    /// Pinned server X25519 public key (URL-safe base64, no padding).
    #[serde(default)]
    pub e2ee_server_pub_b64: Option<String>,
    pub private_key_pem: Option<String>,
    pub client_cert_pem: Option<String>,
    pub ca_cert_pem: Option<String>,
    pub pending_enrollment: Option<PendingEnrollment>,
    /// OpenClaw webhook base URL or full hook URL (persisted so Finder launches work).
    #[serde(default)]
    pub openclaw_hooks_url: Option<String>,
    /// OpenClaw webhook bearer token (persisted so Finder launches work).
    #[serde(default)]
    pub openclaw_hooks_token: Option<String>,
    /// OpenClaw Gateway WS auth token (only used when WS transport is forced).
    /// Kept separate from hooks token since they can differ (runtime overrides).
    #[serde(default)]
    pub openclaw_ws_token: Option<String>,
    /// OpenClaw hook name (used when `openclaw_hooks_url` is a base URL).
    #[serde(default)]
    pub openclaw_hook: Option<String>,
    /// OpenClaw hook name for agent/task messages (defaults to `openclaw_hook`).
    #[serde(default)]
    pub openclaw_agent_hook: Option<String>,
    /// OpenClaw wake mode (`now` | `next-heartbeat`).
    #[serde(default)]
    pub openclaw_wake_mode: Option<String>,
    /// Provider setup mode (`managed` | `custom`).
    #[serde(default)]
    pub llm_provider_mode: Option<String>,
    /// Provider id/name (`openai` | `anthropic` | `google` | `custom`).
    #[serde(default)]
    pub llm_provider_name: Option<String>,
    /// Provider base URL.
    #[serde(default)]
    pub llm_base_url: Option<String>,
    /// Provider API key.
    #[serde(default)]
    pub llm_api_key: Option<String>,
    /// Preferred model id.
    #[serde(default)]
    pub llm_model: Option<String>,
    /// Custom JSON parameters for advanced mode.
    #[serde(default)]
    pub llm_custom_params: Option<String>,
    /// Local-first provider profiles.
    #[serde(default)]
    pub provider_profiles: Vec<ProviderProfile>,
    /// Active provider profile id.
    #[serde(default)]
    pub active_provider_profile_id: Option<String>,
    /// Local-cloud memory sync status (backup/restore timestamps and last error).
    #[serde(default)]
    pub memory_sync: Option<MemorySyncState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthState {
    pub tenant_base_url: String,
    pub refresh_token: String,
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub access_expires_at_unix: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingEnrollment {
    #[serde(alias = "id")]
    pub enrollment_id: String,
    pub pairing_code: String,
    #[serde(default, deserialize_with = "deserialize_expires_at_unix_opt")]
    pub expires_at: Option<i64>,
    pub started_unix_ts: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MemorySyncState {
    #[serde(default)]
    pub last_backup_at_unix: Option<i64>,
    #[serde(default)]
    pub last_restore_at_unix: Option<i64>,
    #[serde(default)]
    pub last_error: Option<String>,
}

fn deserialize_expires_at_unix_opt<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error as _;

    let v = Option::<serde_json::Value>::deserialize(deserializer)?;
    let Some(v) = v else { return Ok(None) };

    match v {
        serde_json::Value::Number(n) => Ok(n.as_i64()),
        serde_json::Value::String(s) => {
            let s = s.trim();
            if s.is_empty() {
                return Ok(None);
            }
            if let Ok(ts) = s.parse::<i64>() {
                return Ok(Some(ts));
            }

            // Best-effort RFC3339 parsing ("2026-01-29T00:00:00Z").
            Ok(
                time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339)
                    .ok()
                    .map(|dt| dt.unix_timestamp()),
            )
        }
        other => Err(D::Error::custom(format!(
            "expires_at must be number|string|null, got {other:?}"
        ))),
    }
}

impl DaemonState {
    pub fn has_mtls_material(&self) -> bool {
        self.device_id.is_some()
            && self.private_key_pem.is_some()
            && self.client_cert_pem.is_some()
            && self.ca_cert_pem.is_some()
    }
}

#[derive(Clone, Debug)]
pub struct StateStore {
    path: PathBuf,
}

impl StateStore {
    pub fn new(app_config_dir: PathBuf) -> Self {
        Self {
            path: app_config_dir.join("state.json"),
        }
    }

    pub fn app_config_dir(&self) -> anyhow::Result<&Path> {
        self.path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("state path has no parent"))
    }

    pub fn load(&self) -> anyhow::Result<DaemonState> {
        let mut f = match fs::File::open(&self.path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(DaemonState::default()),
            Err(e) => return Err(e.into()),
        };

        let mut buf = String::new();
        f.read_to_string(&mut buf)?;
        match serde_json::from_str(&buf) {
            Ok(state) => Ok(state),
            Err(_e) => {
                // Don't brick the app if the state file is corrupted.
                let bad_name = format!(
                    "state.json.bad-{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs()
                );
                if let Some(dir) = self.path.parent() {
                    let bad_path = dir.join(bad_name);
                    let _ = fs::rename(&self.path, bad_path);
                }
                Ok(DaemonState::default())
            }
        }
    }

    pub fn save(&self, state: &DaemonState) -> anyhow::Result<()> {
        let dir = self
            .path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("state path has no parent"))?;
        fs::create_dir_all(dir)?;

        let tmp = self.path.with_extension("json.tmp");
        let json = serde_json::to_string_pretty(state)?;

        {
            let mut opts = fs::OpenOptions::new();
            opts.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                // Best-effort: keep key material readable only by the current user.
                opts.mode(0o600);
            }
            let mut f = opts.open(&tmp)?;
            f.write_all(json.as_bytes())?;
            f.sync_all()?;
        }

        // Windows can't atomically rename over existing file. Best-effort.
        let _ = fs::remove_file(&self.path);
        fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> StateStore {
        let dir = std::env::temp_dir().join(format!("sac-state-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        StateStore::new(dir)
    }

    #[test]
    fn load_returns_default_and_quarantines_corrupt_state_json() {
        let store = temp_store();

        // Write corrupted JSON.
        std::fs::write(&store.path, "{not valid json").unwrap();

        // Desired behavior: don't brick startup on corrupted state.
        let st = store.load().unwrap();
        assert_eq!(st.device_id, None);
        assert!(store.path.exists() == false);

        // Ensure the corrupt file was moved aside for debugging.
        let parent = store.path.parent().unwrap();
        let mut found = false;
        for entry in std::fs::read_dir(parent).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("state.json.bad-") {
                found = true;
                break;
            }
        }
        assert!(found, "expected quarantined state.json.bad-* file");
    }

    #[test]
    fn load_defaults_bridge_mode_to_openclaw_for_older_state_files() {
        let store = temp_store();

        // Simulate an older state.json that predates bridge_mode.
        std::fs::write(&store.path, r#"{ "device_id": "dev_1" }"#).unwrap();

        let st = store.load().unwrap();
        assert_eq!(st.device_id.as_deref(), Some("dev_1"));
        assert_eq!(st.bridge_mode, BridgeMode::OpenClaw);
        assert!(!st.dictation_enabled);
        assert_eq!(st.dictation_model_id, "base");
        assert!(st.dictation_language.is_none());
        assert_eq!(st.dictation_hold_key, "alt");
        assert_eq!(st.chat_display_mode, "full");
        assert_eq!(st.chat_copy_mode, "markdown");
        assert_eq!(st.chat_bot_avatar, "default");
        assert!(st.chat_bot_avatar_data_url.is_none());
        assert!(!st.companion_enabled);
        assert!(st.companion_tts_provider.is_none());
        assert!(st.companion_tts_model.is_none());
        assert!(st.companion_tts_voice.is_none());
        assert!(st.companion_tts_namespace.is_none());
        assert!(st.companion_tts_api_key.is_none());
        assert!(st.companion_tts_app_key.is_none());
    }

    #[test]
    fn save_and_load_persists_dictation_settings() {
        let store = temp_store();
        let mut st = DaemonState::default();
        st.dictation_enabled = true;
        st.dictation_model_id = "small".to_string();
        st.dictation_language = Some("zh".to_string());
        st.dictation_hold_key = "shift".to_string();

        store.save(&st).unwrap();

        let loaded = store.load().unwrap();
        assert!(loaded.dictation_enabled);
        assert_eq!(loaded.dictation_model_id, "small");
        assert_eq!(loaded.dictation_language.as_deref(), Some("zh"));
        assert_eq!(loaded.dictation_hold_key, "shift");
    }

    #[cfg(unix)]
    #[test]
    fn save_hardens_state_file_permissions_on_unix() {
        use std::os::unix::fs::PermissionsExt;

        let store = temp_store();
        let st = DaemonState {
            auth: None,
            bridge_mode: BridgeMode::OpenClaw,
            rpc_addr: None,
            rpc_token: None,
            control_plane_url: None,
            gateway_url: None,
            dictation_enabled: false,
            dictation_model_id: default_dictation_model_id(),
            dictation_language: None,
            dictation_hold_key: default_dictation_hold_key(),
            chat_display_mode: default_chat_display_mode(),
            chat_copy_mode: default_chat_copy_mode(),
            chat_bot_avatar: default_chat_bot_avatar(),
            chat_bot_avatar_data_url: None,
            companion_enabled: false,
            companion_live2d_active_model: None,
            companion_tts_provider: None,
            companion_tts_endpoint: None,
            companion_tts_model: None,
            companion_tts_voice: None,
            companion_tts_namespace: None,
            companion_tts_api_key: None,
            companion_tts_app_key: None,
            device_id: Some("dev_1".to_string()),
            e2ee_device_priv_b64: None,
            e2ee_device_pub_b64: None,
            e2ee_server_kid: None,
            e2ee_server_pub_b64: None,
            private_key_pem: Some("key".to_string()),
            client_cert_pem: Some("client".to_string()),
            ca_cert_pem: Some("ca".to_string()),
            pending_enrollment: None,
            openclaw_hooks_url: None,
            openclaw_hooks_token: None,
            openclaw_ws_token: None,
            openclaw_hook: None,
            openclaw_agent_hook: None,
            openclaw_wake_mode: None,
            llm_provider_mode: None,
            llm_provider_name: None,
            llm_base_url: None,
            llm_api_key: None,
            llm_model: None,
            llm_custom_params: None,
            provider_profiles: Vec::new(),
            active_provider_profile_id: None,
            memory_sync: None,
        };

        store.save(&st).unwrap();

        let mode = std::fs::metadata(&store.path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
