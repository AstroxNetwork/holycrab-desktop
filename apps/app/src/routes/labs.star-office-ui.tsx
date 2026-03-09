import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@ui/components/badge'
import { Button } from '@ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@ui/components/card'
import { Input } from '@ui/components/input'
import { ChevronLeft, ExternalLink, RefreshCw } from 'lucide-react'
import { RuntimeSessionPanel, type RuntimeSessionLogState } from '@/components/runtime-session-panel'
import { shellArgvForScript, shellKindForPlatform } from '@/lib/bash'
import {
  buildStarOfficeLabScriptUnix,
  buildStarOfficeLabScriptWindows,
  starOfficeLabUiUrl,
  type StarOfficeLabAction,
} from '@/lib/star-office-lab'
import { publishLifecycleTask } from '@/lib/lifecycle-bus'
import { detectRuntimeActionContext, type RuntimeActionContext } from '@/lib/runtime-actions'
import { tauriInvoke } from '@/lib/tauri'
import { useLocale } from '@/lib/locale-context'

export const Route = createFileRoute('/labs/star-office-ui')({
  component: LabsStarOfficeUiPage,
})

type StarOfficeLabStatus = {
  installPath: string
  healthUrl: string
  installed: boolean
  running: boolean
  message?: string | null
  pid?: number | null
  pythonPath?: string | null
  pythonVersion?: string | null
  pipPath?: string | null
  pipVersion?: string | null
  nodePath?: string | null
  nodeVersion?: string | null
  npmPath?: string | null
  npmVersion?: string | null
  pnpmPath?: string | null
  pnpmVersion?: string | null
}

const STAR_OFFICE_RUNTIME_CONFIG_STORAGE_KEY = 'holycrab.starOfficeLab.runtimeConfig.v1'

type StarOfficeRuntimeConfig = {
  geminiApiKey: string
  geminiModel: string
  assetDrawerPass: string
}

const DEFAULT_RUNTIME_CONFIG: StarOfficeRuntimeConfig = {
  geminiApiKey: '',
  geminiModel: 'nanobanana-pro',
  assetDrawerPass: '1234',
}

function readRuntimeConfigFromStorage(): StarOfficeRuntimeConfig {
  if (typeof window === 'undefined') return DEFAULT_RUNTIME_CONFIG
  try {
    const raw = window.localStorage.getItem(STAR_OFFICE_RUNTIME_CONFIG_STORAGE_KEY)
    if (!raw) return DEFAULT_RUNTIME_CONFIG
    const parsed = JSON.parse(raw) as Partial<StarOfficeRuntimeConfig>
    return {
      geminiApiKey: typeof parsed.geminiApiKey === 'string' ? parsed.geminiApiKey : '',
      geminiModel: typeof parsed.geminiModel === 'string' && parsed.geminiModel.trim()
        ? parsed.geminiModel.trim()
        : DEFAULT_RUNTIME_CONFIG.geminiModel,
      assetDrawerPass: typeof parsed.assetDrawerPass === 'string' && parsed.assetDrawerPass.trim()
        ? parsed.assetDrawerPass
        : DEFAULT_RUNTIME_CONFIG.assetDrawerPass,
    }
  } catch {
    return DEFAULT_RUNTIME_CONFIG
  }
}

function formatToolValue(path: string | null | undefined, version: string | null | undefined, tr: (zh: string, en: string) => string) {
  if (!path) return tr('未检测到', 'Not detected')
  return `${version || tr('已安装', 'Installed')} · ${path}`
}

function LabsStarOfficeUiPage() {
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
  const [status, setStatus] = useState<StarOfficeLabStatus | null>(null)
  const [runningAction, setRunningAction] = useState<StarOfficeLabAction | null>(null)
  const [runtimeConfig, setRuntimeConfig] = useState<StarOfficeRuntimeConfig>(() => readRuntimeConfigFromStorage())
  const [savingRuntimeConfig, setSavingRuntimeConfig] = useState(false)

  const [runtimeSessionPanelOpen, setRuntimeSessionPanelOpen] = useState(false)
  const [runtimeActionLog, setRuntimeActionLog] = useState<RuntimeSessionLogState | null>(null)
  const [ptySessionId, setPtySessionId] = useState<string | null>(null)
  const runtimeTaskKeyRef = useRef<string | null>(null)

  const persistRuntimeConfig = useCallback(async (raw: StarOfficeRuntimeConfig) => {
    const normalized: StarOfficeRuntimeConfig = {
      geminiApiKey: raw.geminiApiKey.trim(),
      geminiModel: raw.geminiModel.trim() || DEFAULT_RUNTIME_CONFIG.geminiModel,
      assetDrawerPass: raw.assetDrawerPass.trim() || DEFAULT_RUNTIME_CONFIG.assetDrawerPass,
    }
    const saved = await tauriInvoke<StarOfficeRuntimeConfig>('save_star_office_lab_runtime_config', {
      input: normalized,
    })
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STAR_OFFICE_RUNTIME_CONFIG_STORAGE_KEY, JSON.stringify(saved))
    }
    return saved
  }, [])

  const refreshStatus = useCallback(async () => {
    setCheckingStatus(true)
    setStatusError(null)
    try {
      const nextStatus = await tauriInvoke<StarOfficeLabStatus>('get_star_office_lab_status')
      setStatus(nextStatus)
    } catch (error) {
      console.error(error)
      setStatusError(`${tr('读取 Star Office 状态失败', 'Failed to read Star Office status')}: ${String(error)}`)
    } finally {
      setCheckingStatus(false)
    }
  }, [])

  const startAction = useCallback(async (action: StarOfficeLabAction) => {
    const effectiveAction: StarOfficeLabAction = action === 'start' && Boolean(status?.running) ? 'restart' : action
    setRunningAction(effectiveAction)
    setStatusError(null)
    setMessage(null)
    setRuntimeSessionPanelOpen(true)
    setRuntimeActionLog({
      runtimeId: 'star-office-labs',
      action: effectiveAction,
      running: true,
      success: null,
      lines: [tr('将自动检查并补齐 node/npm/python/pip/pnpm 环境', 'Will auto-check and install node/npm/python/pip/pnpm if missing')],
    })

    const taskKey = `labs:star-office:${effectiveAction}`
    runtimeTaskKeyRef.current = taskKey
    void publishLifecycleTask({
      key: taskKey,
      scope: 'labs',
      status: 'running',
      message: `star-office ${effectiveAction}`,
      source: 'labs-star-office',
    }).catch(() => {})

    if (ptySessionId) {
      void tauriInvoke('pty_close', { session_id: ptySessionId }).catch(() => {})
      setPtySessionId(null)
    }

    try {
      const context = await detectRuntimeActionContext().catch(() => runtimeActionContext)
      setRuntimeActionContext(context)
      let effectiveRuntimeConfig = runtimeConfig
      try {
        const savedRuntimeConfig = await persistRuntimeConfig(runtimeConfig)
        effectiveRuntimeConfig = savedRuntimeConfig
        setRuntimeConfig(savedRuntimeConfig)
      } catch (error) {
        setStatusError(`${tr('保存运行参数失败', 'Failed to save runtime parameters')}: ${String(error)}`)
      }
      const shellKind = shellKindForPlatform(context.platform)
      const script = shellKind === 'powershell'
        ? buildStarOfficeLabScriptWindows(effectiveAction)
        : buildStarOfficeLabScriptUnix(effectiveAction)

      const env: Record<string, string> = {
        HOLYCRAB_STAR_OFFICE_GEMINI_MODEL: effectiveRuntimeConfig.geminiModel.trim() || DEFAULT_RUNTIME_CONFIG.geminiModel,
        HOLYCRAB_STAR_OFFICE_ASSET_DRAWER_PASS: effectiveRuntimeConfig.assetDrawerPass || DEFAULT_RUNTIME_CONFIG.assetDrawerPass,
      }
      if (effectiveRuntimeConfig.geminiApiKey.trim()) {
        env.HOLYCRAB_STAR_OFFICE_GEMINI_API_KEY = effectiveRuntimeConfig.geminiApiKey.trim()
      }

      const result = await tauriInvoke<{ sessionId: string }>('pty_start', {
        argv: shellArgvForScript(script, shellKind),
        env,
        cols: 110,
        rows: 30,
      })
      setPtySessionId(result.sessionId)
    } catch (error) {
      console.error(error)
      setStatusError(`${tr('启动失败', 'Failed to start action')} (${effectiveAction}): ${String(error)}`)
      setRuntimeActionLog({
        runtimeId: 'star-office-labs',
        action: effectiveAction,
        running: false,
        success: false,
        lines: [],
      })
      setRunningAction(null)
      void publishLifecycleTask({
        key: taskKey,
        scope: 'labs',
        status: 'error',
        message: String(error),
        source: 'labs-star-office',
      }).catch(() => {})
    }
  }, [persistRuntimeConfig, ptySessionId, runtimeActionContext, runtimeConfig, status?.running])

  const onPtyDone = useCallback(async (exitCode: number) => {
    const action = runningAction || 'install'
    const success = exitCode === 0
    const taskKey = runtimeTaskKeyRef.current || `labs:star-office:${action}`

    void publishLifecycleTask({
      key: taskKey,
      scope: 'labs',
      status: success ? 'completed' : 'error',
      message: success ? `star-office ${action} completed` : `star-office ${action} failed (${exitCode})`,
      source: 'labs-star-office',
    }).catch(() => {})
    runtimeTaskKeyRef.current = null

    setRunningAction(null)
    setRuntimeActionLog((previous) => {
      if (!previous) return previous
      return { ...previous, running: false, success }
    })

    if (!success) {
      setStatusError(`${tr('执行失败', 'Execution failed')} (${action}), ${tr('退出码', 'exit code')} ${exitCode}.`)
      return
    }

    const labels: Record<StarOfficeLabAction, string> = {
      install: tr('已完成安装并启动 Star Office UI。', 'Install completed and Star Office UI started.'),
      start: tr('Star Office UI 已启动。', 'Star Office UI started.'),
      stop: tr('Star Office UI 已停止。', 'Star Office UI stopped.'),
      restart: tr('Star Office UI 已重启。', 'Star Office UI restarted.'),
    }
    setMessage(labels[action])
    await refreshStatus()
  }, [refreshStatus, runningAction])

  const closeRuntimeSessionPanel = (nextOpen: boolean) => {
    setRuntimeSessionPanelOpen(nextOpen)
    if (!nextOpen && runningAction) {
      setMessage(
        `${tr('已切到后台继续执行', 'Moved to background and still running')} (${runningAction}). ${tr('可稍后回到本页点“刷新状态”查看结果。', 'Come back and click "Refresh Status" later.')}`,
      )
    }
  }

  useEffect(() => {
    void detectRuntimeActionContext()
      .then((context) => setRuntimeActionContext(context))
      .catch(() => {})
    const cached = readRuntimeConfigFromStorage()
    setRuntimeConfig(cached)
    void tauriInvoke<StarOfficeRuntimeConfig>('get_star_office_lab_runtime_config')
      .then((saved) => {
        const normalized: StarOfficeRuntimeConfig = {
          geminiApiKey: typeof saved.geminiApiKey === 'string' ? saved.geminiApiKey : '',
          geminiModel: typeof saved.geminiModel === 'string' && saved.geminiModel.trim()
            ? saved.geminiModel.trim()
            : DEFAULT_RUNTIME_CONFIG.geminiModel,
          assetDrawerPass: typeof saved.assetDrawerPass === 'string' && saved.assetDrawerPass.trim()
            ? saved.assetDrawerPass
            : DEFAULT_RUNTIME_CONFIG.assetDrawerPass,
        }
        const hasSavedValue = Boolean(
          normalized.geminiApiKey.trim()
          || normalized.geminiModel !== DEFAULT_RUNTIME_CONFIG.geminiModel
          || normalized.assetDrawerPass !== DEFAULT_RUNTIME_CONFIG.assetDrawerPass,
        )
        if (hasSavedValue) {
          setRuntimeConfig(normalized)
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(STAR_OFFICE_RUNTIME_CONFIG_STORAGE_KEY, JSON.stringify(normalized))
          }
          return
        }
        if (cached.geminiApiKey.trim() || cached.geminiModel.trim() || cached.assetDrawerPass.trim()) {
          void persistRuntimeConfig(cached).catch(() => {})
        }
      })
      .catch(() => {})
    void refreshStatus()
  }, [persistRuntimeConfig, refreshStatus])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STAR_OFFICE_RUNTIME_CONFIG_STORAGE_KEY, JSON.stringify(runtimeConfig))
  }, [runtimeConfig])

  const handleSaveRuntimeConfig = useCallback(async () => {
    setSavingRuntimeConfig(true)
    setStatusError(null)
    try {
      const saved = await persistRuntimeConfig(runtimeConfig)
      setRuntimeConfig(saved)
      setMessage(tr('运行参数已保存。', 'Runtime parameters saved.'))
    } catch (error) {
      setStatusError(`${tr('保存运行参数失败', 'Failed to save runtime parameters')}: ${String(error)}`)
    } finally {
      setSavingRuntimeConfig(false)
    }
  }, [persistRuntimeConfig, runtimeConfig])

  const busy = runningAction !== null

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
        <p className="text-xs text-muted-foreground">{tr('实验区 / Star Office UI', 'Labs / Star Office UI')}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-2xl">{tr('Star Office UI 安装面板', 'Star Office UI Setup Panel')}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {tr('安装脚本会自动检查并补齐 node/npm/python/pip/pnpm，再完成安装与启动。', 'The installer auto-checks node/npm/python/pip/pnpm, then installs and starts Star Office UI.')}
              </p>
            </div>
            <Button variant="outline" onClick={() => void refreshStatus()} disabled={checkingStatus || busy}>
              <RefreshCw className={checkingStatus ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} />
              {tr('刷新状态', 'Refresh Status')}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,1fr)]">
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-3">
              <StatusItem label={tr('安装状态', 'Install status')} value={status?.installed ? tr('已安装', 'Installed') : tr('未安装', 'Not installed')} tone={status?.installed ? 'ok' : 'neutral'} />
              <StatusItem label={tr('运行状态', 'Runtime status')} value={status?.running ? tr('运行中', 'Running') : tr('未运行', 'Stopped')} tone={status?.running ? 'ok' : 'error'} />
              <StatusItem label={tr('健康检查', 'Health check')} value={status?.healthUrl || 'http://127.0.0.1:18791/health'} tone={status?.running ? 'ok' : 'neutral'} />
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
              <div className="text-sm font-semibold">{tr('运行信息', 'Runtime info')}</div>
              <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                <StatusLine k={tr('安装路径', 'Install path')} v={status?.installPath || '~/.holycrab/labs/star-office-ui'} />
                <StatusLine k="PID" v={status?.pid ? String(status.pid) : '-'} />
                <StatusLine k={tr('消息', 'Message')} v={status?.message || '-'} />
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/30 p-4">
              <div className="text-sm font-semibold">{tr('环境探测', 'Environment probes')}</div>
              <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                <ToolProbeLine k="python" v={formatToolValue(status?.pythonPath, status?.pythonVersion, tr)} />
                <ToolProbeLine k="pip" v={formatToolValue(status?.pipPath, status?.pipVersion, tr)} />
                <ToolProbeLine k="node" v={formatToolValue(status?.nodePath, status?.nodeVersion, tr)} />
                <ToolProbeLine k="npm" v={formatToolValue(status?.npmPath, status?.npmVersion, tr)} />
                <ToolProbeLine k="pnpm" v={formatToolValue(status?.pnpmPath, status?.pnpmVersion, tr)} />
              </div>
            </div>
          </div>

          <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
              <div className="mb-3 text-sm font-semibold">{tr('运行参数', 'Runtime parameters')}</div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">GEMINI_API_KEY</div>
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={tr('留空则仅使用基础功能', 'Leave empty to use basic features only')}
                    value={runtimeConfig.geminiApiKey}
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      setRuntimeConfig((previous) => ({ ...previous, geminiApiKey: value }))
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">GEMINI_MODEL</div>
                  <Input
                    placeholder={tr('nanobanana-pro 或 nanobanana-2', 'nanobanana-pro or nanobanana-2')}
                    value={runtimeConfig.geminiModel}
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      setRuntimeConfig((previous) => ({ ...previous, geminiModel: value }))
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">ASSET_DRAWER_PASS</div>
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={tr('默认 1234', 'Default 1234')}
                    value={runtimeConfig.assetDrawerPass}
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      setRuntimeConfig((previous) => ({ ...previous, assetDrawerPass: value }))
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {tr('保存后会在安装/启动/重启时注入到 Star Office 进程环境。', 'Saved values will be injected during install/start/restart.')}
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={busy || savingRuntimeConfig}
                  onClick={() => void handleSaveRuntimeConfig()}
                >
                  {savingRuntimeConfig ? tr('保存中...', 'Saving...') : tr('保存参数', 'Save parameters')}
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
              <div className="mb-3 text-sm font-semibold">{tr('操作区', 'Actions')}</div>
              <div className="grid gap-2">
                <Button variant="brand" disabled={busy} onClick={() => void startAction('install')}>
                  {runningAction === 'install' ? tr('安装中...', 'Installing...') : tr('一键安装并启动', 'Install and Start')}
                </Button>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button variant="outline" disabled={busy} onClick={() => void startAction('start')}>
                    {runningAction === 'start' ? tr('启动中...', 'Starting...') : tr('启动服务', 'Start Service')}
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => void startAction('restart')}>
                    {runningAction === 'restart' ? tr('重启中...', 'Restarting...') : tr('重启服务', 'Restart Service')}
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => void startAction('stop')}>
                    {runningAction === 'stop' ? tr('停止中...', 'Stopping...') : tr('停止服务', 'Stop Service')}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      const uiUrl = (status?.healthUrl || '')
                        .replace(/\/health\/?$/, '')
                        .trim() || starOfficeLabUiUrl()
                      void tauriInvoke('open_external_url', { url: uiUrl }).catch((error) => {
                        setStatusError(`${tr('打开 Star Office UI 失败', 'Failed to open Star Office UI')}: ${String(error)}`)
                      })
                    }}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {tr('打开 Star Office UI', 'Open Star Office UI')}
                  </Button>
                </div>
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
          </div>
        </CardContent>
      </Card>

      <RuntimeSessionPanel
        key={ptySessionId ? `pty:${ptySessionId}` : `labs:star-office:${runtimeActionLog?.running ? '1' : '0'}:${runtimeActionLog?.success ?? 'null'}`}
        open={runtimeSessionPanelOpen}
        onOpenChange={closeRuntimeSessionPanel}
        log={runtimeActionLog}
        ptySessionId={ptySessionId}
        onPtyDone={(exitCode) => { void onPtyDone(exitCode) }}
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
      <div className="mt-1 break-all text-sm">{v}</div>
    </div>
  )
}

function ToolProbeLine({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 px-3 py-2">
      <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{k}</div>
      <div className="mt-1 break-all text-sm">{v}</div>
    </div>
  )
}
