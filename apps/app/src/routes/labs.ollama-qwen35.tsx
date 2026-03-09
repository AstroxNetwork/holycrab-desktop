import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@ui/components/badge'
import { Button } from '@ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@ui/components/card'
import { Combobox } from '@ui/components/combobox'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import { RuntimeSessionPanel, type RuntimeSessionLogState } from '@/components/runtime-session-panel'
import { shellArgvForScript, shellKindForPlatform } from '@/lib/bash'
import {
  OLLAMA_LAB_QWEN35_MODEL_OPTIONS,
  buildOllamaLabScriptUnix,
  buildOllamaLabScriptWindows,
} from '@/lib/ollama-lab'
import { markProviderProfilesChanged } from '@/lib/provider-profile-events'
import { publishLifecycleTask } from '@/lib/lifecycle-bus'
import { canonicalProviderId, defaultBaseUrl, saveProviderSetup } from '@/lib/provider-setup'
import { getProviderState, type ProviderStateView } from '@/lib/provider-state'
import { detectRuntimeActionContext, type RuntimeActionContext } from '@/lib/runtime-actions'
import { tauriInvoke } from '@/lib/tauri'
import { useLocale } from '@/lib/locale-context'

export const Route = createFileRoute('/labs/ollama-qwen35')({
  component: LabsOllamaQwen35Page,
})

const OLLAMA_PROVIDER_ID = canonicalProviderId('ollama') || 'ollama'
const OLLAMA_BASE_URL = defaultBaseUrl(OLLAMA_PROVIDER_ID) || 'http://127.0.0.1:11434'
const OLLAMA_API_KEY = 'ollama-local'
const DEFAULT_MODEL_ID = OLLAMA_LAB_QWEN35_MODEL_OPTIONS[0]?.id || 'qwen3.5:0.8b'

type OllamaTagsResponse = {
  models?: Array<{
    name?: string | null
  }>
}

type OllamaPsResponse = {
  models?: Array<{
    name?: string | null
    model?: string | null
  }>
}

function dedupeModels(values: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

function normalizeModelId(raw: string | null | undefined) {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  const slash = trimmed.indexOf('/')
  if (slash > -1 && slash < trimmed.length - 1) {
    return trimmed.slice(slash + 1).trim().toLowerCase()
  }
  return trimmed.toLowerCase()
}

function ollamaModelSupportsImageInput(rawModelId: string) {
  const modelId = normalizeModelId(rawModelId)
  if (!modelId) return false
  if (modelId.startsWith('gpt-oss')) return false
  return (
    modelId.startsWith('qwen3.5')
    || modelId.includes('vision')
    || modelId.includes('-vl')
    || modelId.includes('llava')
    || modelId.includes('internvl')
    || modelId.includes('glm-4v')
    || modelId.includes('minicpm-v')
    || modelId.includes('janus')
  )
}

function quoteBashSingle(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function parseJsonObjectSafe(raw: string | null | undefined) {
  if (!raw || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore invalid JSON custom params from older profiles
  }
  return {}
}

function buildOllamaCustomParams(existingRaw: string | null | undefined, modelId: string, modelLabel: string) {
  const existing = parseJsonObjectSafe(existingRaw)
  const input = ollamaModelSupportsImageInput(modelId) ? ['text', 'image'] : ['text']
  const next: Record<string, unknown> = {
    ...existing,
    api: 'ollama',
    name: modelLabel || modelId,
    reasoning: true,
    input,
    contextWindow: 262144,
    maxTokens: 8192 * 10,
  }
  return JSON.stringify(next)
}

async function fetchOllamaJson<T>(path: '/api/tags' | '/api/ps'): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 3500)
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`${path} returned HTTP ${response.status}`)
    }
    return await response.json() as T
  } finally {
    window.clearTimeout(timer)
  }
}

function buildOllamaUninstallScript(shellKind: 'bash' | 'powershell', model: string) {
  if (shellKind === 'powershell') {
    const escapedModel = model.replace(/"/g, '""')
    return [
      '$ErrorActionPreference = "Stop"',
      `$model = "${escapedModel}"`,
      '$ollama = Get-Command ollama -ErrorAction SilentlyContinue',
      'if (-not $ollama) { throw "Ollama command not found." }',
      'Write-Host ("[ollama-lab] Uninstalling model: " + $model)',
      '& $ollama.Source rm $model',
      'Write-Host "[ollama-lab] Uninstall completed."',
    ].join('\n')
  }

  return [
    'set -euo pipefail',
    `model=${quoteBashSingle(model)}`,
    'if ! command -v ollama >/dev/null 2>&1; then',
    '  echo "[ollama-lab] ERROR: Ollama command not found." >&2',
    '  exit 1',
    'fi',
    'echo "[ollama-lab] Uninstalling model: ${model}"',
    'ollama rm "${model}"',
    'echo "[ollama-lab] Uninstall completed."',
  ].join('\n')
}

function buildOllamaMaintenanceScript(shellKind: 'bash' | 'powershell', action: 'upgrade' | 'restart') {
  if (shellKind === 'powershell') {
    if (action === 'upgrade') {
      return [
        '$ErrorActionPreference = "Stop"',
        '$winget = Get-Command winget -ErrorAction SilentlyContinue',
        'if ($winget) {',
        '  Write-Host "[ollama-lab] Upgrading Ollama..."',
        '  try {',
        '    & $winget.Source upgrade --id Ollama.Ollama -e --accept-package-agreements --accept-source-agreements',
        '  } catch {',
        '    & $winget.Source install --id Ollama.Ollama -e --accept-package-agreements --accept-source-agreements',
        '  }',
        '} else {',
        '  throw "winget not found. Please update Ollama manually from https://ollama.com/download"',
        '}',
        'Write-Host "[ollama-lab] Upgrade completed."',
      ].join('\n')
    }
    return [
      '$ErrorActionPreference = "Stop"',
      '$ollama = Get-Command ollama -ErrorAction SilentlyContinue',
      'if (-not $ollama) { throw "Ollama command not found." }',
      'Write-Host "[ollama-lab] Restarting Ollama service..."',
      'Get-Process -Name ollama -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue',
      'Start-Sleep -Seconds 1',
      'Start-Process -FilePath $ollama.Source -ArgumentList "serve" -WindowStyle Hidden',
      'Write-Host "[ollama-lab] Restart completed."',
    ].join('\n')
  }

  if (action === 'upgrade') {
    return [
      'set -euo pipefail',
      'export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"',
      'if command -v brew >/dev/null 2>&1; then',
      '  echo "[ollama-lab] Upgrading Ollama via Homebrew..."',
      '  HOMEBREW_NO_AUTO_UPDATE=1 brew upgrade ollama || HOMEBREW_NO_AUTO_UPDATE=1 brew install ollama',
      'else',
      '  echo "[ollama-lab] Upgrading Ollama via official installer..."',
      '  curl -fsSL https://ollama.com/install.sh | sh',
      'fi',
      'echo "[ollama-lab] Upgrade completed."',
    ].join('\n')
  }

  return [
    'set -euo pipefail',
    'if ! command -v ollama >/dev/null 2>&1; then',
    '  echo "[ollama-lab] ERROR: Ollama command not found." >&2',
    '  exit 1',
    'fi',
    'echo "[ollama-lab] Restarting Ollama service..."',
    'pkill -x ollama >/dev/null 2>&1 || true',
    'sleep 1',
    'mkdir -p "$HOME/.ollama/logs" >/dev/null 2>&1 || true',
    'nohup ollama serve >>"$HOME/.ollama/logs/ollama-serve.log" 2>&1 &',
    'echo "[ollama-lab] Restart completed."',
  ].join('\n')
}

function LabsOllamaQwen35Page() {
  const { locale } = useLocale()
  const tr = (zh: string, en: string) => (locale === 'zh' ? zh : en)
  const navigate = useNavigate()

  const [runtimeActionContext, setRuntimeActionContext] = useState<RuntimeActionContext>({
    platform: 'any',
    arch: 'any',
  })
  const [checkingStatus, setCheckingStatus] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [ollamaReachable, setOllamaReachable] = useState(false)
  const [installedModels, setInstalledModels] = useState<string[]>([])
  const [runningModels, setRunningModels] = useState<string[]>([])
  const [providerState, setProviderState] = useState<ProviderStateView | null>(null)
  const [modelInput, setModelInput] = useState(DEFAULT_MODEL_ID)

  const [installing, setInstalling] = useState(false)
  const [configuring, setConfiguring] = useState(false)
  const [configuringPrimaryModel, setConfiguringPrimaryModel] = useState<string | null>(null)
  const [installingModel, setInstallingModel] = useState<string | null>(null)
  const [runtimeSessionPanelOpen, setRuntimeSessionPanelOpen] = useState(false)
  const [runtimeActionLog, setRuntimeActionLog] = useState<RuntimeSessionLogState | null>(null)
  const [ptySessionId, setPtySessionId] = useState<string | null>(null)
  const [uninstallingModel, setUninstallingModel] = useState<string | null>(null)
  const runtimeTaskKeyRef = useRef<string | null>(null)

  const openclawConfig = providerState?.openclawConfig ?? null
  const openclawUsingOllama = canonicalProviderId(openclawConfig?.providerId || '') === OLLAMA_PROVIDER_ID
  const openclawPrimaryModelId = normalizeModelId(openclawConfig?.model || '')

  const installedModelSet = useMemo(
    () => new Set(installedModels.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0)),
    [installedModels],
  )
  const modelOptions = useMemo(() => {
    const options = OLLAMA_LAB_QWEN35_MODEL_OPTIONS.map((item) => {
      const installed = installedModelSet.has(item.id.toLowerCase())
      return {
        value: item.id,
        label: installed ? `✅ ${item.label}` : item.label,
        installed,
      }
    })
    options.sort((a, b) => Number(b.installed) - Number(a.installed))
    return options.map(({ value, label }) => ({ value, label }))
  }, [installedModelSet])
  const selectedModelInstalled = installedModelSet.has(modelInput.trim().toLowerCase())

  const refreshStatus = useCallback(async () => {
    setCheckingStatus(true)
    setStatusError(null)

    const [tagsResult, psResult, providerResult] = await Promise.allSettled([
      fetchOllamaJson<OllamaTagsResponse>('/api/tags'),
      fetchOllamaJson<OllamaPsResponse>('/api/ps'),
      getProviderState(),
    ])

    const tagsOk = tagsResult.status === 'fulfilled'
    const psOk = psResult.status === 'fulfilled'
    const providerOk = providerResult.status === 'fulfilled'

    if (tagsOk || psOk) {
      setOllamaReachable(true)
    } else {
      setOllamaReachable(false)
    }

    const nextInstalled = tagsOk
      ? dedupeModels((tagsResult.value.models ?? []).map((item) => item.name || ''))
      : []
    setInstalledModels(nextInstalled)

    const nextRunning = psOk
      ? dedupeModels((psResult.value.models ?? []).map((item) => item.name || item.model || ''))
      : []
    setRunningModels(nextRunning)

    if (providerOk) {
      setProviderState(providerResult.value)
    }

    const errors: string[] = []
    if (tagsResult.status === 'rejected' && psResult.status === 'rejected') {
      errors.push(tr('未能连接到 Ollama（/api/tags 与 /api/ps 均不可用）', 'Cannot connect to Ollama (/api/tags and /api/ps are unavailable)'))
    }
    if (providerResult.status === 'rejected') {
      errors.push(`${tr('读取 ProviderState 失败', 'Failed to read ProviderState')}: ${String(providerResult.reason)}`)
    }

    setStatusError(errors.length ? errors.join('；') : null)
    setCheckingStatus(false)
  }, [])

  const configureToOpenClaw = useCallback(async (targetModel: string, fromAutoInstall: boolean) => {
    const requestedModel = targetModel.trim()
    const selectedModel = requestedModel || runningModels[0] || installedModels[0] || DEFAULT_MODEL_ID
    if (!selectedModel) {
      setStatusError(tr('请选择模型后再配置到 OpenClaw。', 'Choose a model before configuring OpenClaw.'))
      return
    }

    setConfiguring(true)
    setConfiguringPrimaryModel(selectedModel)
    setStatusError(null)
    setMessage(null)
    const taskKey = 'labs:ollama:configure-primary'
    void publishLifecycleTask({
      key: taskKey,
      scope: 'labs',
      status: 'running',
      message: `configure ollama primary ${selectedModel}`,
      source: 'labs-ollama',
    }).catch(() => {})

    try {
      const latestState = await getProviderState()
      const existingProfile = latestState.profiles.find(
        (profile) => canonicalProviderId(profile.provider) === OLLAMA_PROVIDER_ID,
      )
      const selectedLabel = OLLAMA_LAB_QWEN35_MODEL_OPTIONS.find((item) => item.id === selectedModel)?.label || selectedModel

      await saveProviderSetup({
        profileId: existingProfile?.id,
        name: existingProfile?.name?.trim() || 'ollama-local',
        mode: 'custom',
        provider: OLLAMA_PROVIDER_ID,
        baseUrl: OLLAMA_BASE_URL,
        apiKey: OLLAMA_API_KEY,
        model: selectedModel,
        customParams: buildOllamaCustomParams(existingProfile?.customParams, selectedModel, selectedLabel),
        setActive: true,
      })
      markProviderProfilesChanged()

      setMessage(
        fromAutoInstall
          ? `${tr('一键安装完成，并已自动配置到 OpenClaw', 'One-click install completed and auto-configured to OpenClaw')} (${selectedModel}).`
          : `${tr('已将模型设为 OpenClaw Primary', 'Model set as OpenClaw Primary')}: ${selectedModel}.`,
      )
      await refreshStatus()
      void publishLifecycleTask({
        key: taskKey,
        scope: 'labs',
        status: 'completed',
        message: `configured ollama primary ${selectedModel}`,
        source: 'labs-ollama',
      }).catch(() => {})
    } catch (error) {
      console.error(error)
      setStatusError(`${tr('设置 Primary 失败', 'Failed to set Primary')} (${selectedModel}): ${String(error)}`)
      void publishLifecycleTask({
        key: taskKey,
        scope: 'labs',
        status: 'error',
        message: String(error),
        source: 'labs-ollama',
      }).catch(() => {})
    } finally {
      setConfiguring(false)
      setConfiguringPrimaryModel(null)
    }
  }, [installedModels, refreshStatus, runningModels])

  const startOneClickInstall = async () => {
    const requestedModel = modelInput.trim() || DEFAULT_MODEL_ID
    const taskKey = 'labs:ollama:install'

    setInstalling(true)
    setStatusError(null)
    setMessage(null)
    setInstallingModel(requestedModel)
    setRuntimeSessionPanelOpen(true)
    setUninstallingModel(null)
    setRuntimeActionLog({
      runtimeId: 'ollama-labs',
      action: 'install',
      running: true,
      success: null,
      lines: [`target model: ${requestedModel}`],
    })
    runtimeTaskKeyRef.current = taskKey
    void publishLifecycleTask({
      key: taskKey,
      scope: 'labs',
      status: 'running',
      message: `installing ollama model ${requestedModel}`,
      source: 'labs-ollama',
    }).catch(() => {})
    if (ptySessionId) {
      void tauriInvoke('pty_close', { session_id: ptySessionId }).catch(() => {})
      setPtySessionId(null)
    }

    try {
      const context = await detectRuntimeActionContext().catch(() => runtimeActionContext)
      setRuntimeActionContext(context)
      const shellKind = shellKindForPlatform(context.platform)
      const script = shellKind === 'powershell'
        ? buildOllamaLabScriptWindows({ modelIds: [requestedModel] })
        : buildOllamaLabScriptUnix({ modelIds: [requestedModel] })

      const result = await tauriInvoke<{ sessionId: string }>('pty_start', {
        argv: shellArgvForScript(script, shellKind),
        cols: 100,
        rows: 30,
      })

      setPtySessionId(result.sessionId)
    } catch (error) {
      console.error(error)
      setStatusError(`${tr('启动一键安装失败', 'Failed to start one-click install')}: ${String(error)}`)
      setRuntimeActionLog({
        runtimeId: 'ollama-labs',
        action: 'install',
        running: false,
        success: false,
        lines: [],
      })
      setInstalling(false)
      setInstallingModel(null)
      void publishLifecycleTask({
        key: taskKey,
        scope: 'labs',
        status: 'error',
        message: String(error),
        source: 'labs-ollama',
      }).catch(() => {})
    }
  }

  const startUninstallModel = async (model: string) => {
    const targetModel = model.trim()
    if (!targetModel) return
    const taskKey = `labs:ollama:uninstall:${targetModel}`

    setInstalling(true)
    setConfiguring(false)
    setInstallingModel(null)
    setStatusError(null)
    setMessage(null)
    setUninstallingModel(targetModel)
    setRuntimeSessionPanelOpen(true)
    setRuntimeActionLog({
      runtimeId: 'ollama-labs',
      action: 'uninstall',
      running: true,
      success: null,
      lines: [`target model: ${targetModel}`],
    })
    runtimeTaskKeyRef.current = taskKey
    void publishLifecycleTask({
      key: taskKey,
      scope: 'labs',
      status: 'running',
      message: `uninstalling ollama model ${targetModel}`,
      source: 'labs-ollama',
    }).catch(() => {})
    if (ptySessionId) {
      void tauriInvoke('pty_close', { session_id: ptySessionId }).catch(() => {})
      setPtySessionId(null)
    }

    try {
      const context = await detectRuntimeActionContext().catch(() => runtimeActionContext)
      setRuntimeActionContext(context)
      const shellKind = shellKindForPlatform(context.platform)
      const script = buildOllamaUninstallScript(shellKind, targetModel)
      const result = await tauriInvoke<{ sessionId: string }>('pty_start', {
        argv: shellArgvForScript(script, shellKind),
        cols: 100,
        rows: 30,
      })
      setPtySessionId(result.sessionId)
    } catch (error) {
      console.error(error)
      setStatusError(`${tr('启动卸载失败', 'Failed to start uninstall')}: ${String(error)}`)
      setRuntimeActionLog({
        runtimeId: 'ollama-labs',
        action: 'uninstall',
        running: false,
        success: false,
        lines: [],
      })
      setInstalling(false)
      setUninstallingModel(null)
      void publishLifecycleTask({
        key: taskKey,
        scope: 'labs',
        status: 'error',
        message: String(error),
        source: 'labs-ollama',
      }).catch(() => {})
    }
  }

  const startMaintenanceAction = async (action: 'upgrade' | 'restart') => {
    const taskKey = `labs:ollama:${action}`
    setInstalling(true)
    setConfiguring(false)
    setInstallingModel(null)
    setStatusError(null)
    setMessage(null)
    setUninstallingModel(null)
    setRuntimeSessionPanelOpen(true)
    setRuntimeActionLog({
      runtimeId: 'ollama-labs',
      action,
      running: true,
      success: null,
      lines: [],
    })
    runtimeTaskKeyRef.current = taskKey
    void publishLifecycleTask({
      key: taskKey,
      scope: 'labs',
      status: 'running',
      message: `ollama ${action}`,
      source: 'labs-ollama',
    }).catch(() => {})
    if (ptySessionId) {
      void tauriInvoke('pty_close', { session_id: ptySessionId }).catch(() => {})
      setPtySessionId(null)
    }

    try {
      const context = await detectRuntimeActionContext().catch(() => runtimeActionContext)
      setRuntimeActionContext(context)
      const shellKind = shellKindForPlatform(context.platform)
      const script = buildOllamaMaintenanceScript(shellKind, action)
      const result = await tauriInvoke<{ sessionId: string }>('pty_start', {
        argv: shellArgvForScript(script, shellKind),
        cols: 100,
        rows: 30,
      })
      setPtySessionId(result.sessionId)
    } catch (error) {
      console.error(error)
      setStatusError(`${action === 'upgrade' ? tr('升级失败', 'Upgrade failed') : tr('重启失败', 'Restart failed')}: ${String(error)}`)
      setRuntimeActionLog({
        runtimeId: 'ollama-labs',
        action,
        running: false,
        success: false,
        lines: [],
      })
      setInstalling(false)
      void publishLifecycleTask({
        key: taskKey,
        scope: 'labs',
        status: 'error',
        message: String(error),
        source: 'labs-ollama',
      }).catch(() => {})
    }
  }

  const onPtyDone = async (exitCode: number) => {
    const success = exitCode === 0
    const action = runtimeActionLog?.action || 'install'
    const taskKey = runtimeTaskKeyRef.current || `labs:ollama:${action}`
    void publishLifecycleTask({
      key: taskKey,
      scope: 'labs',
      status: success ? 'completed' : 'error',
      message: success ? `ollama ${action} completed` : `ollama ${action} failed (${exitCode})`,
      source: 'labs-ollama',
    }).catch(() => {})
    runtimeTaskKeyRef.current = null
    setInstalling(false)
    setRuntimeActionLog((previous) => {
      if (!previous) return previous
      return { ...previous, running: false, success }
    })

    if (!success) {
      if (action === 'uninstall') {
        const model = uninstallingModel || tr('目标模型', 'target model')
        setStatusError(`${tr('卸载失败', 'Uninstall failed')} (${model}), ${tr('退出码', 'exit code')} ${exitCode}.`)
      } else {
        setStatusError(`${tr('一键安装失败', 'One-click install failed')}, ${tr('退出码', 'exit code')} ${exitCode}.`)
      }
      setInstallingModel(null)
      setUninstallingModel(null)
      return
    }

    await refreshStatus()
    if (action === 'uninstall') {
      setMessage(`${tr('已卸载模型', 'Model uninstalled')}: ${uninstallingModel || '-'}`)
      setUninstallingModel(null)
      return
    }
    if (action === 'upgrade') {
      setMessage(tr('Ollama 升级完成（或已是最新版本）。', 'Ollama upgrade completed (or already latest).'))
      return
    }
    if (action === 'restart') {
      setMessage(tr('Ollama 服务已重启。', 'Ollama service restarted.'))
      return
    }
    const installedTarget = (installingModel || modelInput).trim() || DEFAULT_MODEL_ID
    setInstallingModel(null)
    await configureToOpenClaw(installedTarget, true)
  }

  const closeRuntimeSessionPanel = (nextOpen: boolean) => {
    setRuntimeSessionPanelOpen(nextOpen)
    if (!nextOpen && ptySessionId) {
      void tauriInvoke('pty_close', { session_id: ptySessionId }).catch(() => {})
      setPtySessionId(null)
    }
    if (!nextOpen) {
      runtimeTaskKeyRef.current = null
    }
  }

  useEffect(() => {
    void detectRuntimeActionContext()
      .then((context) => setRuntimeActionContext(context))
      .catch(() => {})
    void refreshStatus()
  }, [refreshStatus])

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={() => {
            void navigate({ to: '/labs' })
          }}
        >
          <ChevronLeft className="mr-2 h-4 w-4" />
          {tr('返回实验区', 'Back to Labs')}
        </Button>
        <p className="text-xs text-muted-foreground">{tr('实验区 / Ollama + Qwen3.5 本地模型', 'Labs / Ollama + Qwen3.5 Local Models')}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-2xl">{tr('Ollama 配置面板', 'Ollama Configuration Panel')}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{tr('状态查询来自本地 Ollama API 与 ProviderState 组合。', 'Status is composed from local Ollama API and ProviderState.')}</p>
            </div>
            <Button variant="outline" onClick={() => void refreshStatus()} disabled={checkingStatus}>
              <RefreshCw className={checkingStatus ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} />
              {tr('刷新状态', 'Refresh Status')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            <StatusItem
              label={tr('Ollama 运行状态', 'Ollama Runtime')}
              value={ollamaReachable ? tr('运行中 / 可访问', 'Running / reachable') : tr('未运行或不可访问', 'Stopped or unreachable')}
              tone={ollamaReachable ? 'ok' : 'error'}
            />
            <StatusItem
              label={tr('已安装模型', 'Installed models')}
              value={installedModels.length ? installedModels.join(locale === 'zh' ? '，' : ', ') : tr('暂无', 'None')}
              tone={installedModels.length ? 'ok' : 'neutral'}
            />
            <StatusItem
              label={tr('当前运行模型', 'Running models')}
              value={runningModels.length ? runningModels.join(locale === 'zh' ? '，' : ', ') : tr('暂无', 'None')}
              tone={runningModels.length ? 'ok' : 'neutral'}
            />
          </div>

          <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
            <div className="text-sm font-semibold">{tr('OpenClaw 当前 Ollama 配置', 'OpenClaw Ollama Configuration')}</div>
            {!openclawConfig ? (
              <p className="mt-2 text-sm text-muted-foreground">{tr('尚未读取到 OpenClaw 配置状态。', 'OpenClaw config state not loaded yet.')}</p>
            ) : (
              <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                <StatusLine k={tr('配置状态', 'Config status')} v={openclawConfig.configured ? tr('已配置', 'Configured') : tr('未配置', 'Not configured')} />
                <StatusLine k={tr('当前 Provider', 'Current provider')} v={openclawConfig.providerId || '-'} />
                <StatusLine k={tr('当前 Model', 'Current model')} v={openclawConfig.model || '-'} />
                <StatusLine k="API Key" v={openclawConfig.apiKeySet ? tr('已设置', 'Set') : tr('未设置', 'Not set')} />
                <StatusLine k={tr('Provider 命中 Ollama', 'Provider is Ollama')} v={openclawUsingOllama ? tr('是', 'Yes') : tr('否', 'No')} />
                <StatusLine k={tr('提示信息', 'Hint')} v={openclawConfig.message || '-'} />
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4 rounded-2xl border border-border/70 bg-background/30 p-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold">{tr('安装与配置区', 'Install & Configure')}</div>
                <div className="text-xs text-muted-foreground">{tr('已安装模型会显示为 ✅；Primary 设置请在右侧已下载模型中直接点击。', 'Installed models show as ✅; set Primary from the installed model list on the right.')}</div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold">{tr('模型选择（默认 4 项，可自定义输入）', 'Model selection (4 defaults, custom allowed)')}</div>
                <Combobox
                  value={modelInput}
                  onValueChange={setModelInput}
                  options={modelOptions}
                  placeholder={tr('选择或输入模型', 'Select or enter model')}
                  allowCustom
                />
                <p className="text-xs text-muted-foreground">
                  {tr('将保存到 OpenClaw', 'Will save to OpenClaw')}: provider={OLLAMA_PROVIDER_ID}, baseUrl={OLLAMA_BASE_URL}, apiKey={OLLAMA_API_KEY}
                </p>
              </div>
              <div className="grid gap-2">
                <Button
                  variant="brand"
                  onClick={() => void startOneClickInstall()}
                  disabled={installing || configuring || selectedModelInstalled || uninstallingModel !== null}
                >
                  {selectedModelInstalled
                    ? tr('该模型已安装（无需重复安装）', 'Model already installed')
                    : installing
                      ? tr('安装中...', 'Installing...')
                      : tr('按钮A：运行一键安装脚本', 'Run one-click install script')}
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={installing || configuring || uninstallingModel !== null}
                    onClick={() => { void startMaintenanceAction('upgrade') }}
                  >
                    {tr('升级 Ollama', 'Upgrade Ollama')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={installing || configuring || uninstallingModel !== null}
                    onClick={() => { void startMaintenanceAction('restart') }}
                  >
                    {tr('重启 Ollama 服务', 'Restart Ollama Service')}
                  </Button>
                </div>
              </div>
            </div>
            <div className="space-y-4 rounded-2xl border border-border/70 bg-background/30 p-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold">{tr('卸载区', 'Uninstall')}</div>
                <div className="text-xs text-muted-foreground">{tr('仅显示当前已安装模型，按需卸载。', 'Only installed models are shown here.')}</div>
              </div>
              {installedModels.length ? (
                <div className="grid gap-2">
                  {installedModels.map((installedModel) => (
                    <div key={installedModel.toLowerCase()} className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2">
                      <span className="truncate text-sm">{installedModel}</span>
                      <div className="flex items-center gap-2">
                        {normalizeModelId(installedModel) === openclawPrimaryModelId ? (
                          <Badge variant="secondary">{tr('主模型', 'Primary')}</Badge>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            installing
                            || uninstallingModel !== null
                            || configuring
                            || normalizeModelId(installedModel) === openclawPrimaryModelId
                          }
                          onClick={() => { void configureToOpenClaw(installedModel, false) }}
                        >
                          {configuringPrimaryModel && normalizeModelId(configuringPrimaryModel) === normalizeModelId(installedModel)
                            ? tr('设置中...', 'Setting...')
                            : tr('设为主模型', 'Set as Primary')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={installing || configuring || uninstallingModel !== null}
                          onClick={() => { void startUninstallModel(installedModel) }}
                        >
                          {uninstallingModel === installedModel ? tr('卸载中...', 'Uninstalling...') : tr('卸载', 'Uninstall')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
                  {tr('暂无已安装模型可卸载。', 'No installed models available for uninstall.')}
                </div>
              )}
            </div>
          </div>

          {message ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
              {message}
            </div>
          ) : null}

          {statusError ? (
            <div className="rounded-xl border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {statusError}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <RuntimeSessionPanel
        key={ptySessionId ? `pty:${ptySessionId}` : `labs:${runtimeActionLog?.running ? '1' : '0'}:${runtimeActionLog?.success ?? 'null'}`}
        open={runtimeSessionPanelOpen}
        onOpenChange={closeRuntimeSessionPanel}
        log={runtimeActionLog}
        ptySessionId={ptySessionId}
        onPtyDone={(exitCode) => { void onPtyDone(exitCode) }}
        autoCloseOnSuccess
        autoCloseDelayMs={900}
      />
    </div>
  )
}

function StatusItem({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'neutral' | 'ok' | 'error'
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/50 p-3">
      <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="text-sm font-medium leading-5">{value}</div>
        {tone === 'ok' ? <Badge variant="secondary">OK</Badge> : null}
        {tone === 'error' ? <Badge variant="destructive">Error</Badge> : null}
        {tone === 'neutral' ? <Badge variant="outline">-</Badge> : null}
      </div>
    </div>
  )
}

function StatusLine({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-background/40 px-3 py-2">
      <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{k}</div>
      <div className="mt-1 text-sm">{v}</div>
    </div>
  )
}
