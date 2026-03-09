import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@ui/components/badge'
import { Button } from '@ui/components/button'
import { Card, CardContent } from '@ui/components/card'
import { Eye, EyeOff, RefreshCw } from 'lucide-react'
import { tauriInvoke } from '@/lib/tauri'
import { checkOpenClawReadiness, openExternalUrl } from '@/lib/openclaw-handoff'
import { RuntimeSessionPanel, type RuntimeSessionLogState } from '@/components/runtime-session-panel'
import { refreshChatRuntime } from '@/lib/chat-runtime'
import { publishLifecycleTask } from '@/lib/lifecycle-bus'
import {
  getOpenClawAgentsOverview,
  getOpenClawChannelConfigStatus,
  getOpenClawProviderConfigStatus,
  saveOpenClawAgentPrimaryModel,
  type OpenClawAgentsOverviewSnapshot,
  type OpenClawChannelConfigStatus,
  type OpenClawProviderConfigStatus,
} from '@/lib/openclaw-config'
import {
  bashNodeRuntimeProbeSnippet,
  bashRuntimeProbePrelude,
  shellArgvForScript,
  shellKindForPlatform,
} from '@/lib/bash'
import {
  buildOpenClawInstallScriptUnix,
  buildOpenClawInstallScriptWindows,
} from '@/lib/openclaw-installer'
import {
  detectRuntimeActionContext,
  resolveRuntimeAction,
  validateRuntimeAction,
  type RuntimeActionContext,
} from '@/lib/runtime-actions'
import {
  fetchRuntimeOverview,
  readRuntimeOverviewCache,
  type RuntimeViewModel,
} from '@/lib/runtimes'
import {
  getProviderProfilesVersion,
  subscribeProviderProfilesChanged,
} from '@/lib/provider-profile-events'
import { emitSetupStateChanged } from '@/lib/setup-events'
import { openSetupWizardWindow } from '@/lib/setup-wizard-window'
import { useLocale } from '@/lib/locale-context'

const OPENCLAW_UNINSTALL_SCRIPT_UNIX = [
  'export PATH="$HOME/.local/bin:$PATH"',
  'echo "[openclaw] stopping gateway/daemon..."',
  'openclaw gateway stop >/dev/null 2>&1 || true',
  'openclaw daemon stop >/dev/null 2>&1 || true',
  'pkill -x openclaw-gateway >/dev/null 2>&1 || true',
  'pkill -x openclaw-daemon >/dev/null 2>&1 || true',
  'pkill -x openclaw >/dev/null 2>&1 || true',
  'openclaw_bin="$(type -P openclaw || true)"',
  'npm_candidates=""',
  'if command -v npm >/dev/null 2>&1; then npm_candidates="$(type -P npm)"; fi',
  'if [ -n "${openclaw_bin}" ] && [ -x "$(dirname "${openclaw_bin}")/npm" ]; then',
  '  candidate_from_openclaw="$(dirname "${openclaw_bin}")/npm"',
  '  case " ${npm_candidates} " in',
  '    *" ${candidate_from_openclaw} "*) ;;',
  '    *) npm_candidates="${npm_candidates} ${candidate_from_openclaw}" ;;',
  '  esac',
  'fi',
  'for npm_bin in ${npm_candidates}; do',
  '  echo "$ ${npm_bin} uninstall -g openclaw"',
  '  "${npm_bin}" uninstall -g openclaw >/dev/null 2>&1 || true',
  'done',
  'if [ -e "$HOME/.local/bin/openclaw" ]; then',
  '  rm -f "$HOME/.local/bin/openclaw"',
  '  echo "Removed wrapper: $HOME/.local/bin/openclaw"',
  'fi',
  'hash -r || true',
  'remaining_openclaw="$(type -P openclaw || true)"',
  'if [ -n "${remaining_openclaw}" ]; then',
  '  echo "OpenClaw is still on PATH: ${remaining_openclaw}"',
  '  echo "If this is a source checkout, remove it manually from your shell PATH."',
  'else',
  '  echo "OpenClaw uninstall cleanup complete."',
  'fi',
  'echo "Config dir left untouched: $HOME/.openclaw"',
].join('\n')

const OPENCLAW_UNINSTALL_SCRIPT_WINDOWS = [
  '$ErrorActionPreference = "Continue"',
  '$openclaw = Get-Command openclaw -ErrorAction SilentlyContinue',
  'if ($openclaw) {',
  '  & $openclaw.Source gateway stop *> $null',
  '  & $openclaw.Source daemon stop *> $null',
  '}',
  '$npm = Get-Command npm -ErrorAction SilentlyContinue',
  'if ($npm) {',
  '  & $npm.Source uninstall -g openclaw',
  '}',
  '$schtasks = Get-Command schtasks -ErrorAction SilentlyContinue',
  'if ($schtasks) {',
  '  schtasks /Delete /TN "OpenClaw Gateway" /F *> $null',
  '}',
  '$openclawWrapper = Join-Path $HOME ".local/bin/openclaw"',
  'if (Test-Path $openclawWrapper) {',
  '  Remove-Item $openclawWrapper -Force -ErrorAction SilentlyContinue',
  '}',
  'Write-Host "OpenClaw uninstall cleanup complete."',
].join('\n')

const OPENCLAW_GATEWAY_RESTART_SCRIPT_UNIX = [
  'export PATH="$HOME/.local/bin:$PATH"',
  'openclaw_bin="$(type -P openclaw || true)"',
  'if [ -z "${openclaw_bin}" ]; then',
  '  echo "OpenClaw is not available in PATH."',
  '  exit 1',
  'fi',
  'echo "$ ${openclaw_bin} gateway install --force"',
  '"${openclaw_bin}" gateway install --force',
  'echo "$ ${openclaw_bin} gateway restart"',
  '"${openclaw_bin}" gateway restart',
].join('\n')

const OPENCLAW_GATEWAY_RESTART_SCRIPT_WINDOWS = [
  '$ErrorActionPreference = "Stop"',
  '$openclaw = Get-Command openclaw -ErrorAction Stop',
  'Write-Host ("$ " + $openclaw.Source + " gateway install --force")',
  '& $openclaw.Source gateway install --force',
  'Write-Host ("$ " + $openclaw.Source + " gateway restart")',
  '& $openclaw.Source gateway restart',
].join('\n')

function deriveOverviewUrlFromDashboardUrl(dashboardUrl: string) {
  const raw = dashboardUrl.trim()
  if (!raw) return 'http://127.0.0.1:18789/overview'
  try {
    const parsed = new URL(raw)
    const basePath = parsed.pathname.replace(/\/+$/, '')
    parsed.pathname = basePath ? `${basePath}/overview` : '/overview'
    return parsed.toString()
  } catch {
    const base = raw.replace(/\/+$/, '')
    return `${base}/overview`
  }
}

function deriveGatewayWsUrlFromDashboardUrl(dashboardUrl: string, chatUrl?: string) {
  const raw = dashboardUrl.trim()
  if (raw) {
    try {
      const parsed = new URL(raw)
      parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
      parsed.pathname = '/'
      parsed.search = ''
      parsed.hash = ''
      return parsed.toString().replace(/\/$/, '')
    } catch {
      // ignore and try chat url
    }
  }
  const chatRaw = (chatUrl || '').trim()
  if (!chatRaw) return ''
  try {
    const parsed = new URL(chatRaw)
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
    parsed.pathname = '/'
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

function extractPortFromGatewayWsUrl(wsUrl: string) {
  const raw = wsUrl.trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.port) return parsed.port
    if (parsed.protocol === 'wss:') return '443'
    if (parsed.protocol === 'ws:') return '80'
    return ''
  } catch {
    return ''
  }
}

function extractGatewayTokenFromUrl(urlValue: string | null | undefined) {
  if (!urlValue) return ''
  try {
    const parsed = new URL(urlValue)
    return (
      parsed.searchParams.get('token')
      || parsed.searchParams.get('gatewayToken')
      || ''
    ).trim()
  } catch {
    return ''
  }
}

function maskGatewayToken(token: string) {
  if (!token) return ''
  if (token.length <= 8) return '••••••••'
  return `${token.slice(0, 4)}••••••••${token.slice(-4)}`
}

type OpenClawReadinessSnapshot = {
  ok: boolean
  openclawBin?: string | null
  gatewayInstalled?: boolean
  gatewayRunning: boolean
  portListening: boolean
  chatReachable: boolean
  gatewayLogPath?: string | null
  advice?: string[]
}

type OpenClawOverviewSnapshot = {
  dashboardUrl: string
  overviewUrl: string
  chatUrl: string
  provider: OpenClawProviderConfigStatus
  channels: Record<'telegram' | 'feishu' | 'discord', OpenClawChannelConfigStatus>
  readiness: OpenClawReadinessSnapshot | null
}

let overviewSessionSnapshotCache: OpenClawOverviewSnapshot | null = null
let overviewSessionAgentsCache: OpenClawAgentsOverviewSnapshot | null = null
let overviewSessionErrorCache: string | null = null
let overviewSessionSelectedAgentIdCache: string | null = null
let overviewSessionLoaded = false
let overviewSessionLoadPromise: Promise<void> | null = null
let overviewSessionProviderProfilesVersion = 0

function invalidateOverviewSessionCache() {
  overviewSessionSnapshotCache = null
  overviewSessionAgentsCache = null
  overviewSessionErrorCache = null
  overviewSessionLoaded = false
}

function resolveOverviewSelectedAgentId(
  agentsOverview: OpenClawAgentsOverviewSnapshot | null,
  preferredId: string | null,
) {
  if (!agentsOverview?.agents?.length) return null
  if (preferredId && agentsOverview.agents.some((agent) => agent.id === preferredId)) {
    return preferredId
  }
  return agentsOverview.defaultAgentId || agentsOverview.agents[0]?.id || null
}

export const Route = createFileRoute('/dashboard')({
  component: SoftwareCenterPage,
})

function SoftwareCenterPage() {
  const { t } = useLocale()
  const navigate = useNavigate()

  const [runtimeUpdates, setRuntimeUpdates] = useState<Record<string, {
    id: string
    name: string
    package: string
    currentVersion: string
    latestVersion: string
  }>>({})
  const [runtimes, setRuntimes] = useState<RuntimeViewModel[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [upgradingRuntimeId, setUpgradingRuntimeId] = useState<string | null>(null)
  const [uninstallingRuntimeId, setUninstallingRuntimeId] = useState<string | null>(null)
  const [restartingGateway, setRestartingGateway] = useState(false)
  const [isRetryingGateway, setIsRetryingGateway] = useState(false)
  const [isFixingGateway, setIsFixingGateway] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updateMessage, setUpdateMessage] = useState<string | null>(null)
  const [runtimeActionLog, setRuntimeActionLog] = useState<RuntimeSessionLogState | null>(null)
  const [runtimeSessionPanelOpen, setRuntimeSessionPanelOpen] = useState(false)
  const [ptySessionId, setPtySessionId] = useState<string | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [overviewSnapshot, setOverviewSnapshot] = useState<OpenClawOverviewSnapshot | null>(null)
  const [agentsOverviewSnapshot, setAgentsOverviewSnapshot] = useState<OpenClawAgentsOverviewSnapshot | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [agentModelDraft, setAgentModelDraft] = useState<string>('')
  const [savingAgentModel, setSavingAgentModel] = useState(false)
  const [agentModelSaveMessage, setAgentModelSaveMessage] = useState<string | null>(null)
  const [showGatewayToken, setShowGatewayToken] = useState(false)
  const [runtimeActionContext, setRuntimeActionContext] = useState<RuntimeActionContext>({
    platform: 'any',
    arch: 'any',
  })
  const refreshRunningRef = useRef(false)
  const refreshQueuedRef = useRef(false)
  const refreshQueuedShowLoadingRef = useRef(false)
  const previousRuntimeActionRef = useRef<RuntimeSessionLogState | null>(null)
  const ptyActionRef = useRef<{ runtimeId: string; action: string; command: string; taskKey: string } | null>(null)
  const openclawRuntime = useMemo(
    () => runtimes.find((runtime) => runtime.id === 'openclaw') || null,
    [runtimes],
  )
  const agentOptions = useMemo(() => agentsOverviewSnapshot?.agents ?? [], [agentsOverviewSnapshot])
  const selectedAgentOverview = useMemo(() => {
    if (!agentOptions.length) return null
    if (!selectedAgentId) return agentOptions[0]
    return agentOptions.find((agent) => agent.id === selectedAgentId) || agentOptions[0]
  }, [agentOptions, selectedAgentId])
  const localizedWorkspace = useMemo(() => {
    const raw = selectedAgentOverview?.workspace?.trim() || ''
    if (!raw) return ''
    if (raw.toLowerCase() === 'default') return t('softwareCenter.overview.value.defaultWorkspace')
    return raw
  }, [selectedAgentOverview, t])
  const localizedSkillsSummary = useMemo(() => {
    const raw = selectedAgentOverview?.skillsSummary?.trim() || ''
    if (!raw) return ''
    if (raw.toLowerCase() === 'all skills') return t('softwareCenter.overview.value.allSkills')
    return raw
  }, [selectedAgentOverview, t])
  const modelOptions = useMemo(() => {
    const configured = agentsOverviewSnapshot?.modelOptions ?? []
    if (!selectedAgentOverview?.primaryModel) return configured
    if (configured.some((item) => item.modelId === selectedAgentOverview.primaryModel)) return configured
    return [
      {
        id: `openclaw:${selectedAgentOverview.primaryModel}`,
        label: `${t('softwareCenter.overview.agent.currentPrefix')} (${selectedAgentOverview.primaryModel})`,
        source: 'openclaw',
        modelId: selectedAgentOverview.primaryModel,
        profileId: null,
      },
      ...configured,
    ]
  }, [agentsOverviewSnapshot, selectedAgentOverview, t])
  const openclawModelOptions = useMemo(
    () => modelOptions.filter((item) => item.source !== 'keyHub'),
    [modelOptions],
  )
  const keyHubModelOptions = useMemo(
    () => modelOptions.filter((item) => item.source === 'keyHub'),
    [modelOptions],
  )

  useEffect(() => {
    if (!selectedAgentOverview) {
      setAgentModelDraft('')
      return
    }
    const preferredOpenclaw = modelOptions.find(
      (option) => option.source !== 'keyHub' && option.modelId === selectedAgentOverview.primaryModel,
    )
    const fallbackMatch = modelOptions.find(
      (option) => option.modelId === selectedAgentOverview.primaryModel,
    )
    const next = preferredOpenclaw || fallbackMatch || modelOptions[0]
    setAgentModelDraft(next?.id || '')
  }, [selectedAgentOverview, modelOptions])

  useEffect(() => {
    let alive = true
    void detectRuntimeActionContext()
      .then((context) => {
        if (alive) setRuntimeActionContext(context)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const loadOverviewSnapshot = useCallback(async () => {
    const currentProviderProfilesVersion = getProviderProfilesVersion()
    if (overviewSessionProviderProfilesVersion !== currentProviderProfilesVersion) {
      invalidateOverviewSessionCache()
    }

    const applyCachedOverview = () => {
      setOverviewSnapshot(overviewSessionSnapshotCache)
      setAgentsOverviewSnapshot(overviewSessionAgentsCache)
      setOverviewError(overviewSessionErrorCache)
      setSelectedAgentId((previous) => {
        const next = resolveOverviewSelectedAgentId(
          overviewSessionAgentsCache,
          previous || overviewSessionSelectedAgentIdCache,
        )
        overviewSessionSelectedAgentIdCache = next
        return next
      })
    }

    const loadOnce = async () => {
      if (overviewSessionLoaded) {
        applyCachedOverview()
        return
      }
      if (overviewSessionLoadPromise) {
        await overviewSessionLoadPromise
        applyCachedOverview()
        return
      }

      setOverviewError(null)
      const requestProviderProfilesVersion = getProviderProfilesVersion()
      const currentRequest = (async () => {
        try {
          const [
            dashboardUrl,
            chatUrl,
            provider,
            telegram,
            feishu,
            discord,
            readiness,
          ] = await Promise.all([
            tauriInvoke<string>('get_openclaw_dashboard_url'),
            tauriInvoke<string>('get_openclaw_chat_url'),
            getOpenClawProviderConfigStatus(),
            getOpenClawChannelConfigStatus('telegram'),
            getOpenClawChannelConfigStatus('feishu'),
            getOpenClawChannelConfigStatus('discord'),
            tauriInvoke<OpenClawReadinessSnapshot>('check_openclaw_readiness', {
              input: { attemptFix: false },
            }).catch(() => null),
          ])
          const agentsOverview = await getOpenClawAgentsOverview().catch((err) => {
            console.error(err)
            return null
          })
          overviewSessionSnapshotCache = {
            dashboardUrl,
            overviewUrl: deriveOverviewUrlFromDashboardUrl(dashboardUrl),
            chatUrl,
            provider,
            channels: { telegram, feishu, discord },
            readiness,
          }
          overviewSessionAgentsCache = agentsOverview
          overviewSessionErrorCache = null
          overviewSessionProviderProfilesVersion = requestProviderProfilesVersion
        } catch (err) {
          console.error(err)
          overviewSessionSnapshotCache = null
          overviewSessionAgentsCache = null
          overviewSessionSelectedAgentIdCache = null
          overviewSessionErrorCache = String(err)
        } finally {
          overviewSessionLoaded = true
        }
      })()

      overviewSessionLoadPromise = currentRequest
      try {
        await currentRequest
      } finally {
        if (overviewSessionLoadPromise === currentRequest) {
          overviewSessionLoadPromise = null
        }
      }
      applyCachedOverview()
    }

    return loadOnce()
  }, [])

  const refreshOverviewSnapshot = useCallback(async () => {
    invalidateOverviewSessionCache()
    await loadOverviewSnapshot()
  }, [loadOverviewSnapshot])

  const saveAgentPrimaryModel = async () => {
    if (!selectedAgentOverview) return
    const selectedOption = modelOptions.find((item) => item.id === agentModelDraft) || null
    if (!selectedOption) return
    if (selectedOption.source !== 'keyHub' && selectedOption.modelId === selectedAgentOverview.primaryModel) return
    setSavingAgentModel(true)
    setOverviewError(null)
    setAgentModelSaveMessage(null)
    try {
      const result = await saveOpenClawAgentPrimaryModel({
        agentId: selectedAgentOverview.id,
        modelId: selectedOption.modelId,
        source: selectedOption.source,
        profileId: selectedOption.profileId || undefined,
      })
      setAgentModelSaveMessage(result.message)
      await refreshOverviewSnapshot()
    } catch (err) {
      console.error(err)
      setOverviewError(String(err))
    } finally {
      setSavingAgentModel(false)
    }
  }

  const closeRuntimeSessionPanel = (nextOpen: boolean) => {
    setRuntimeSessionPanelOpen(nextOpen)
    if (!nextOpen && ptySessionId) {
      void tauriInvoke('pty_close', { session_id: ptySessionId }).catch(() => {})
      setPtySessionId(null)
    }
  }

  const startPtyAction = async (runtimeId: string, action: string, command: string) => {
    const taskKey = `dashboard:${runtimeId}:${action}`
    const shellKind = shellKindForPlatform(runtimeActionContext.platform)
    const isOpenClawInstallLike = runtimeId === 'openclaw' && (action === 'install' || action === 'upgrade')
    let commandToRun = command

    if (runtimeId === 'openclaw' && action === 'uninstall') {
      commandToRun = shellKind === 'powershell'
        ? OPENCLAW_UNINSTALL_SCRIPT_WINDOWS
        : OPENCLAW_UNINSTALL_SCRIPT_UNIX
    }

    const script = (() => {
      if (isOpenClawInstallLike) {
        return shellKind === 'powershell'
          ? buildOpenClawInstallScriptWindows()
          : buildOpenClawInstallScriptUnix()
      }

      if (shellKind === 'powershell') {
        const stopOpenclaw = runtimeId === 'openclaw' && (action === 'install' || action === 'upgrade' || action === 'uninstall')
          ? [
            '$openclaw = Get-Command openclaw -ErrorAction SilentlyContinue',
            'if ($openclaw) {',
            '  & $openclaw.Source gateway stop *> $null',
            '}',
          ].join('\n')
          : ''
        const postAction = runtimeId === 'openclaw'
          ? [
            '$openclaw = Get-Command openclaw -ErrorAction SilentlyContinue',
            'if ($openclaw) {',
            '  Write-Host ("OpenClaw: " + $openclaw.Source)',
            '} else {',
            '  Write-Host "OpenClaw: (not found)"',
            '}',
          ].join('\n')
          : ''
        return [
          '$ErrorActionPreference = "Stop"',
          'Write-Host "[holycrab] preparing environment..."',
          stopOpenclaw,
          `Write-Host '$ ${commandToRun}'`,
          commandToRun,
          postAction,
        ]
          .filter(Boolean)
          .join('\n')
      }

      const prelude = bashRuntimeProbePrelude()
      const nodeProbe = runtimeId === 'openclaw' && action === 'uninstall' ? bashNodeRuntimeProbeSnippet() : ''
      const stopOpenclaw = runtimeId === 'openclaw' && (action === 'install' || action === 'upgrade' || action === 'uninstall')
        ? [
          'openclaw gateway stop >/dev/null 2>&1 || true',
          'pkill -x openclaw-gateway >/dev/null 2>&1 || true',
          'pkill -x openclaw >/dev/null 2>&1 || true',
        ].join('\n')
        : ''
      const postAction = (() => {
        if (runtimeId !== 'openclaw') return ''

        const verifyFound = [
          'export PATH="$HOME/.local/bin:$PATH"',
          'hash -r || true',
          'openclaw_bin="$(type -P openclaw || true)"',
          'if [ -n "${openclaw_bin}" ]; then echo "OpenClaw: ${openclaw_bin}"; else echo "OpenClaw: (not found)"; fi',
        ].join('\n')

        if (action === 'install' || action === 'upgrade') {
          return [
            verifyFound,
            'if [ -z "${openclaw_bin}" ]; then',
            '  echo "Install finished, but openclaw is not available in this shell PATH."',
            '  exit 1',
            'fi',
            'echo "$ ${openclaw_bin} gateway install"',
            '"${openclaw_bin}" gateway install || true',
            'echo "$ ${openclaw_bin} gateway restart (background)"',
            'mkdir -p /tmp/openclaw >/dev/null 2>&1 || true',
            'nohup "${openclaw_bin}" gateway restart >>/tmp/openclaw/holycrab-openclaw-gateway-restart.log 2>&1 &',
            'echo "[holycrab] done."',
          ].join('\n')
        }

        if (action === 'uninstall') {
          return [
            verifyFound,
            'if [ -n "${openclaw_bin}" ]; then',
            '  echo "Uninstall finished, but openclaw is still found. Another install may exist."',
            '  echo "If this path belongs to a source checkout, remove it from PATH manually."',
            'fi',
          ].join('\n')
        }

        if (action === 'gateway-restart') return ''
        return verifyFound
      })()

      return [
        'set -euo pipefail',
        'echo "[holycrab] preparing environment..."',
        prelude,
        nodeProbe,
        stopOpenclaw,
        `echo '$ ${commandToRun}'`,
        commandToRun,
        postAction,
      ]
        .filter(Boolean)
        .join('\n')
    })()

    setRuntimeSessionPanelOpen(true)
    setRuntimeActionLog({
      runtimeId,
      action,
      running: true,
      success: null,
      lines: [],
    })
    void publishLifecycleTask({
      key: taskKey,
      scope: 'runtimeAction',
      status: 'running',
      message: `start ${runtimeId}:${action}`,
      source: 'dashboard',
    }).catch(() => {})

    try {
      const result = await tauriInvoke<{ sessionId: string }>('pty_start', {
        argv: shellArgvForScript(script, shellKind),
        cols: 100,
        rows: 30,
      })
      ptyActionRef.current = { runtimeId, action, command, taskKey }
      setPtySessionId(result.sessionId)
    } catch (err) {
      void publishLifecycleTask({
        key: taskKey,
        scope: 'runtimeAction',
        status: 'error',
        message: String(err),
        source: 'dashboard',
      }).catch(() => {})
      throw err
    }
  }

  const runCatalogAction = async (
    runtime: RuntimeViewModel,
    actionKind: 'install' | 'uninstall' | 'upgrade' | 'open',
  ): Promise<{ handled: boolean; startedPty: boolean }> => {
    const action = resolveRuntimeAction(runtime, actionKind, runtimeActionContext)
    if (!action) return { handled: false, startedPty: false }

    const validationError = validateRuntimeAction(action)
    if (validationError) {
      setUpdateMessage(`${t('softwareCenter.message.remoteActionInvalid')} ${runtime.name} (${actionKind}): ${validationError}`)
      return { handled: false, startedPty: false }
    }

    if (action.type === 'ptyShell') {
      await startPtyAction(runtime.id, actionKind, action.script)
      return { handled: true, startedPty: true }
    }

    await openExternalUrl(action.url)
    if (actionKind !== 'open') {
      setUpdateMessage(`${runtime.name}: ${t('softwareCenter.message.remoteActionOpened')} (${actionKind})`)
    }
    return { handled: true, startedPty: false }
  }

  const onPtyDone = async (exitCode: number) => {
    const current = ptyActionRef.current
    if (!current) return
    const success = exitCode === 0
    void publishLifecycleTask({
      key: current.taskKey,
      scope: 'runtimeAction',
      status: success ? 'completed' : 'error',
      message: success ? `${current.runtimeId}:${current.action} done` : `${current.runtimeId}:${current.action} failed (${exitCode})`,
      source: 'dashboard',
    }).catch(() => {})

    if (success) {
      setRuntimes((previous) =>
        previous.map((runtime) => {
          if (runtime.id !== current.runtimeId) return runtime
          if (current.action === 'uninstall') {
            return { ...runtime, installed: false, version: null, status: 'missing' }
          }
          if (current.action === 'install' || current.action === 'upgrade') {
            return { ...runtime, installed: true, status: 'installed' }
          }
          return runtime
        }),
      )
    }

    setRuntimeActionLog((previous) => {
      if (!previous) return previous
      if (previous.runtimeId !== current.runtimeId || previous.action !== current.action) return previous
      return { ...previous, running: false, success }
    })

    setUpgradingRuntimeId(null)
    setUninstallingRuntimeId(null)
    setRestartingGateway(false)

    const followups: Promise<unknown>[] = []
    if (current.runtimeId === 'openclaw' && (
      current.action === 'install'
      || current.action === 'upgrade'
      || current.action === 'uninstall'
    )) {
      followups.push(emitSetupStateChanged({ source: `dashboard:${current.action}` }))
      followups.push(refreshChatRuntime().catch(() => {}))
    }
    if (success && current.runtimeId === 'openclaw' && (current.action === 'install' || current.action === 'upgrade')) {
      followups.push(checkUpdates())
      if (runtimeActionContext.platform !== 'windows') {
        // Keep OpenClaw gateway loopback-only after mutation on Unix-like hosts.
        followups.push(tauriInvoke('apply_security_fix').catch(() => {}))
        followups.push(
          tauriInvoke<{
            ok: boolean
            advice?: string[]
            gatewayLogPath?: string | null
          }>('check_openclaw_readiness', { input: { attemptFix: true } })
            .then((readiness) => {
              if (readiness?.ok) return
              const advice = readiness?.advice?.length
                ? readiness.advice.map((line) => `- ${line}`).join('\n')
                : t('setupWizard.advice.installGatewayRestart')
              setUpdateMessage(
                [
                  t('softwareCenter.message.gatewayNotReady'),
                  advice,
                  readiness?.gatewayLogPath ? `${t('setupWizard.advice.logsPrefix')} ${readiness.gatewayLogPath}` : null,
                ]
                  .filter(Boolean)
                  .join('\n'),
              )
            })
            .catch(() => {}),
        )
      }
    }
    followups.push(refresh({ showLoading: false, force: true }))
    followups.push(refreshOverviewSnapshot())
    await Promise.allSettled(followups)

    if (!success) {
      setUpdateMessage(`${t('softwareCenter.message.commandFailed')} (${exitCode}). ${t('softwareCenter.message.commandFailedTip')}`)
    }
  }

  useEffect(() => {
    if (
      runtimeActionLog &&
      runtimeActionLog.running &&
      (!previousRuntimeActionRef.current
        || !previousRuntimeActionRef.current.running
        || previousRuntimeActionRef.current.runtimeId !== runtimeActionLog.runtimeId
        || previousRuntimeActionRef.current.action !== runtimeActionLog.action)
    ) {
      setRuntimeSessionPanelOpen(true)
    }
    previousRuntimeActionRef.current = runtimeActionLog
  }, [runtimeActionLog])

  const refresh = async (
    { showLoading = true, force = false }: { showLoading?: boolean; force?: boolean } = {},
  ) => {
    if (refreshRunningRef.current) {
      refreshQueuedRef.current = true
      refreshQueuedShowLoadingRef.current = refreshQueuedShowLoadingRef.current || showLoading
      setRefreshing(true)
      if (showLoading) {
        setLoading(true)
      }
      return
    }

    refreshRunningRef.current = true
    setRefreshing(true)
    setRuntimes((previous) =>
      previous.map((runtime) => ({
        ...runtime,
        status: 'checking',
      })),
    )
    if (showLoading) {
      setLoading(true)
    }
    setError(null)
    try {
      const result = await fetchRuntimeOverview((partial) => {
        setRuntimes((previous) => (previous.length ? previous : partial))
      }, { forceStatuses: force })
      setRuntimes(result)
    } catch (err) {
      console.error(err)
      setError(String(err))
    } finally {
      if (showLoading) {
        setLoading(false)
      }
      refreshRunningRef.current = false
      if (refreshQueuedRef.current) {
        const queuedShowLoading = refreshQueuedShowLoadingRef.current
        refreshQueuedRef.current = false
        refreshQueuedShowLoadingRef.current = false
        void refresh({ showLoading: queuedShowLoading, force })
      } else {
        setRefreshing(false)
      }
    }
  }

  const checkUpdates = async () => {
    setCheckingUpdates(true)
    setUpdateMessage(null)
    try {
      const updates = await tauriInvoke<Array<{
        id: string
        name: string
        package: string
        currentVersion: string
        latestVersion: string
      }>>('check_runtime_updates', { notify: false })
      const openclawUpdates = updates.filter((item) => item.id === 'openclaw')
      const updatesById = Object.fromEntries(
        openclawUpdates.map((item) => [item.id, item]),
      )
      setRuntimeUpdates(updatesById)
      if (!openclawUpdates.length) {
        setUpdateMessage(t('softwareCenter.message.noUpdates'))
        return
      }
      const summary = openclawUpdates
        .map((item) => `${item.name}: ${item.currentVersion} → ${item.latestVersion}`)
        .join(' · ')
      setUpdateMessage(summary)
    } catch (err) {
      console.error(err)
      setUpdateMessage(`${t('softwareCenter.message.updateCheckFailed')} ${String(err)}`)
    } finally {
      setCheckingUpdates(false)
    }
  }

  const upgradeRuntime = async (runtime: RuntimeViewModel) => {
    if (runtime.id !== 'openclaw') {
      setUpdateMessage(`${t('softwareCenter.message.upgradeFailed')} ${t('softwareCenter.message.onlyOpenClawSupported')}`)
      return
    }
    setUpgradingRuntimeId(runtime.id)
    let startedPty = false
    try {
      const remote = await runCatalogAction(runtime, 'upgrade')
      if (remote.handled) {
        startedPty = remote.startedPty
        return
      }
      if (runtime.id === 'openclaw') {
        await startPtyAction(runtime.id, 'upgrade', '')
        startedPty = true
        return
      }
    } catch (error) {
      const message = String(error)
      if (message.includes('command failed')) {
        setUpdateMessage(`${message}\n${t('softwareCenter.message.commandFailedTip')}`)
      } else {
        setUpdateMessage(`${t('softwareCenter.message.upgradeFailed')} ${message}`)
      }
    } finally {
      if (!startedPty) {
        setUpgradingRuntimeId(null)
      }
    }
  }

  const uninstallRuntime = async (runtime: RuntimeViewModel) => {
    if (runtime.id !== 'openclaw') {
      setUpdateMessage(`${t('softwareCenter.message.uninstallFailed')} ${t('softwareCenter.message.onlyOpenClawSupported')}`)
      return
    }
    if (!runtime.installed) return
    const uninstallCommandByRuntimeId: Record<string, string> = {
      openclaw: OPENCLAW_UNINSTALL_SCRIPT_UNIX,
    }
    const targetCommand = uninstallCommandByRuntimeId[runtime.id]
    if (!targetCommand) {
      setUpdateMessage(`${t('softwareCenter.message.uninstallFailed')} uninstall is not configured for runtime: ${runtime.id}`)
      return
    }
    setUninstallingRuntimeId(runtime.id)
    let startedPty = false
    try {
      const remote = await runCatalogAction(runtime, 'uninstall')
      if (remote.handled) {
        startedPty = remote.startedPty
        return
      }

      await startPtyAction(runtime.id, 'uninstall', targetCommand)
      startedPty = true
    } catch (error) {
      const message = String(error)
      if (message.includes('command failed')) {
        setUpdateMessage(`${message}\n${t('softwareCenter.message.commandFailedTip')}`)
      } else {
        setUpdateMessage(`${t('softwareCenter.message.uninstallFailed')} ${message}`)
      }
    } finally {
      if (!startedPty) {
        setUninstallingRuntimeId(null)
      }
    }
  }

  const restartGateway = async () => {
    if (!openclawRuntime?.installed) return
    setUpdateMessage(null)
    setRestartingGateway(true)
    let startedPty = false
    try {
      const shellKind = shellKindForPlatform(runtimeActionContext.platform)
      const command = shellKind === 'powershell'
        ? OPENCLAW_GATEWAY_RESTART_SCRIPT_WINDOWS
        : OPENCLAW_GATEWAY_RESTART_SCRIPT_UNIX
      await startPtyAction('openclaw', 'gateway-restart', command)
      startedPty = true
    } catch (error) {
      const message = String(error)
      if (message.includes('command failed')) {
        setUpdateMessage(`${message}\n${t('softwareCenter.message.commandFailedTip')}`)
      } else {
        setUpdateMessage(`${t('softwareCenter.message.restartGatewayFailed')} ${message}`)
      }
    } finally {
      if (!startedPty) {
        setRestartingGateway(false)
      }
    }
  }

  const refreshOpenClawOverview = useCallback(async () => {
    await Promise.all([
      refresh({ showLoading: false }),
      refreshOverviewSnapshot(),
    ])
  }, [refresh, refreshOverviewSnapshot])

  const handleRetryGateway = useCallback(() => {
    setIsRetryingGateway(true)
    setUpdateMessage(null)
    return (async () => {
      try {
        await refreshOpenClawOverview()
      } catch (error) {
        console.error(error)
        const message = String(error)
        setUpdateMessage(`${t('softwareCenter.message.runtimeDetectionFailed')} ${message}`)
      } finally {
        setIsRetryingGateway(false)
      }
    })()
  }, [refreshOpenClawOverview, t])

  const handleFixGateway = useCallback(() => {
    setIsFixingGateway(true)
    setUpdateMessage(null)
    return (async () => {
      try {
        await checkOpenClawReadiness({ attemptFix: true })
        await refreshOpenClawOverview()
      } catch (error) {
        console.error(error)
        setUpdateMessage(`${t('softwareCenter.message.restartGatewayFailed')} ${String(error)}`)
      } finally {
        setIsFixingGateway(false)
      }
    })()
  }, [refreshOpenClawOverview, t])

  useEffect(() => {
    overviewSessionSelectedAgentIdCache = selectedAgentId
  }, [selectedAgentId])

  useEffect(() => {
    const cached = readRuntimeOverviewCache()
    if (cached && cached.length) {
      setRuntimes(cached)
    }
    setLoading(true)
    void refresh({ showLoading: true })
    void loadOverviewSnapshot()
  }, [])

  useEffect(() => {
    return subscribeProviderProfilesChanged(() => {
      void refreshOverviewSnapshot()
    })
  }, [refreshOverviewSnapshot])

  const openclawUpdate = runtimeUpdates.openclaw
  const openclawChecking = loading || refreshing || openclawRuntime?.status === 'checking'
  const openclawVersionLabel = openclawChecking
    ? t('softwareCenter.status.checking')
    : openclawRuntime?.version || (openclawRuntime?.installed ? t('softwareCenter.field.version.detecting') : t('softwareCenter.field.version.unavailable'))
  const openclawCanUpgradeByAction = openclawRuntime
    ? Boolean(resolveRuntimeAction(openclawRuntime, 'upgrade', runtimeActionContext))
    : false

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-display text-3xl">{t('softwareCenter.page.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('softwareCenter.page.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {openclawRuntime?.installed ? (
            <div className="flex items-center gap-2 rounded-xl bg-background/60 px-3 py-2">
              <span className="font-mono text-xs text-muted-foreground">
                v{openclawVersionLabel}
              </span>
              {openclawUpdate ? (
                <Badge className="h-5 border-0 bg-brand px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-foreground">
                  {t('softwareCenter.badge.new')}
                </Badge>
              ) : null}
              <Button
                variant={openclawUpdate || openclawCanUpgradeByAction ? 'default' : 'outline'}
                size="sm"
                className="border-0"
                disabled={
                  openclawChecking
                  || (!openclawUpdate && !openclawCanUpgradeByAction)
                  || upgradingRuntimeId === 'openclaw'
                }
                onClick={() => {
                  void upgradeRuntime(openclawRuntime)
                }}
              >
                {upgradingRuntimeId === 'openclaw'
                  ? t('softwareCenter.button.preparing')
                  : openclawUpdate
                    ? `${t('softwareCenter.button.upgradeTo')} ${openclawUpdate.latestVersion}`
                    : t('softwareCenter.button.upgrade')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="border-0"
                disabled={openclawChecking || uninstallingRuntimeId === 'openclaw'}
                onClick={() => {
                  void uninstallRuntime(openclawRuntime)
                }}
              >
                {uninstallingRuntimeId === 'openclaw'
                  ? t('softwareCenter.button.preparing')
                  : t('softwareCenter.button.uninstall')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-0"
                disabled={openclawChecking || restartingGateway}
                onClick={() => {
                  void restartGateway()
                }}
              >
                {restartingGateway ? t('softwareCenter.button.restartingGateway') : t('softwareCenter.button.restartGateway')}
              </Button>
            </div>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full border-0"
            onClick={() => {
              void refresh({ showLoading: true })
              void refreshOverviewSnapshot()
            }}
            disabled={refreshing}
            aria-label={t('softwareCenter.refresh')}
            title={t('softwareCenter.refresh')}
          >
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
          </Button>
          <Button variant="default" className="border-0" onClick={() => void checkUpdates()} disabled={checkingUpdates}>
            {checkingUpdates ? t('softwareCenter.checkingUpdates') : t('softwareCenter.checkUpdates')}
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="bg-destructive/10">
          <CardContent className="pt-6 text-sm text-destructive">
            {t('softwareCenter.error.runtimeDetectionFailed')} {error}
          </CardContent>
        </Card>
      ) : null}
      {updateMessage ? (
        <Card className="bg-surface-elevated">
          <CardContent className="pt-6 text-sm whitespace-pre-wrap">
            {updateMessage}
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-4">
          {overviewError ? (
            <div className="mb-4 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {t('softwareCenter.error.overviewLoadFailed')} {overviewError}
            </div>
          ) : null}
          {(() => {
            const snapshot = overviewSnapshot
            const readiness = snapshot?.readiness
            const provider = snapshot?.provider
            const isLoaded = Boolean(snapshot)
            const detectionSettled = !loading && !refreshing && openclawRuntime?.status !== 'checking'
            const openclawBinDetected = Boolean(readiness?.openclawBin)
            const gatewayInstalled = Boolean(readiness?.gatewayInstalled)
            const gatewayRunning = Boolean(readiness?.gatewayRunning)
            const portListening = Boolean(readiness?.portListening)
            const chatReachable = Boolean(readiness?.chatReachable)
            const openclawInstalled = openclawBinDetected || gatewayInstalled || gatewayRunning || portListening || chatReachable
            const hasReadiness = Boolean(readiness)
            const canChat = Boolean(readiness
              && readiness.gatewayInstalled
              && readiness.gatewayRunning
              && readiness.portListening
              && readiness.chatReachable
            )
            const shouldGuideSetupWizard = Boolean(
              hasReadiness
              && !openclawBinDetected
              && !gatewayInstalled
              && !gatewayRunning
              && !portListening,
            )
            const showSetupWizardOverlay = !detectionSettled ? false : Boolean(isLoaded && !canChat && shouldGuideSetupWizard)
            const showGatewayOfflineOverlay = !detectionSettled ? false : Boolean(isLoaded && !canChat && openclawInstalled)
            const showDashboardOverlay = showSetupWizardOverlay || showGatewayOfflineOverlay
            const checksPassed = isLoaded
              ? [
                Boolean(readiness?.ok),
                Boolean(readiness?.gatewayRunning),
                Boolean(readiness?.portListening),
                Boolean(readiness?.chatReachable),
              ].filter(Boolean).length
              : 0
            const configuredChannels = isLoaded
              ? (['telegram', 'feishu', 'discord'] as const).filter((key) => snapshot?.channels?.[key]?.configured).length
              : 0
            const gatewayWsUrl = isLoaded
              ? deriveGatewayWsUrlFromDashboardUrl(snapshot?.dashboardUrl ?? '', snapshot?.chatUrl ?? '')
              : t('softwareCenter.overview.loading')
            const gatewayPort = isLoaded ? extractPortFromGatewayWsUrl(gatewayWsUrl) : ''
            const localeLabel = isLoaded
              ? (typeof navigator === 'undefined' ? t('softwareCenter.overview.auto') : navigator.language)
              : t('softwareCenter.overview.loading')
            const tokenSource = isLoaded
              ? (
                extractGatewayTokenFromUrl(snapshot?.chatUrl)
                || extractGatewayTokenFromUrl(snapshot?.overviewUrl)
                || extractGatewayTokenFromUrl(snapshot?.dashboardUrl)
              )
              : ''
            const tokenDisplay = !isLoaded
              ? t('softwareCenter.overview.loading')
              : tokenSource
                ? (showGatewayToken ? tokenSource : maskGatewayToken(tokenSource))
                : t('softwareCenter.overview.notDetected')
            const hasAgentModelChanges = Boolean(
              selectedAgentOverview
              && agentModelDraft.trim()
              && agentModelDraft.trim() !== selectedAgentOverview.primaryModel,
            )

            return (
              <div className="relative space-y-6">
                <section className={`space-y-4 rounded-3xl border border-border/55 bg-layer-elevated p-5 shadow-[0_10px_28px_-20px_hsl(var(--foreground)/0.45)] ${!isLoaded || showDashboardOverlay ? 'opacity-70' : ''}`}>
                  <h2 className="text-2xl font-semibold tracking-tight">Agent</h2>
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_1px_minmax(0,0.85fr)] xl:items-stretch">
                    <div className="space-y-4 xl:pr-2">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,260px)] md:items-end">
                        <div className="rounded-lg border border-border/35 bg-layer-subtle/90 p-3">
                          <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{t('softwareCenter.overview.field.workspace')}</div>
                          <div
                            className="mt-2 truncate text-sm font-medium leading-10 text-foreground"
                            title={localizedWorkspace || t('softwareCenter.overview.loading')}
                          >
                            {localizedWorkspace || t('softwareCenter.overview.loading')}
                          </div>
                        </div>
                        <div className="rounded-lg border border-border/35 bg-layer-subtle/90 p-3">
                          <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{t('softwareCenter.overview.field.skills')}</div>
                          <div
                            className="mt-2 truncate text-sm font-medium leading-10 text-foreground"
                            title={localizedSkillsSummary || t('softwareCenter.overview.loading')}
                          >
                            {localizedSkillsSummary || t('softwareCenter.overview.loading')}
                          </div>
                        </div>
                        <div className="rounded-lg border border-border/35 bg-layer-subtle/90 p-3 md:ml-auto">
                          <div className="h-[18px]" aria-hidden="true" />
                          <select
                            className="mt-2 h-10 w-full rounded-lg border border-border/35 bg-background/30 px-2 text-sm text-foreground outline-none"
                            value={selectedAgentOverview?.id || ''}
                            onChange={(event) => {
                              setAgentModelSaveMessage(null)
                              setSelectedAgentId(event.target.value || null)
                            }}
                            disabled={!isLoaded || agentOptions.length === 0}
                          >
                            {agentOptions.length === 0 ? (
                              <option value="">{t('softwareCenter.overview.loading')}</option>
                            ) : (
                              agentOptions.map((agent) => (
                                <option key={agent.id} value={agent.id}>
                                  {agent.label}{agent.defaultAgent ? ` ${t('softwareCenter.overview.agent.defaultSuffix')}` : ''}
                                </option>
                              ))
                            )}
                          </select>
                        </div>
                      </div>

                      <div className="border-t border-border/20 pt-3">
                        <div className="grid gap-3">
                          <label className="grid gap-1">
                            <span className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{t('softwareCenter.overview.field.primaryModel')}</span>
                            <select
                              className="h-10 rounded-lg border border-border/35 bg-background/30 px-3 text-sm text-foreground outline-none"
                              value={agentModelDraft}
                              onChange={(event) => {
                                setAgentModelSaveMessage(null)
                                setAgentModelDraft(event.target.value)
                              }}
                              disabled={!isLoaded || !selectedAgentOverview || savingAgentModel || modelOptions.length === 0}
                            >
                              {modelOptions.length === 0 ? (
                                <option value="">{t('softwareCenter.overview.agent.noConfiguredModels')}</option>
                              ) : (
                                <>
                                  {keyHubModelOptions.length ? (
                                    <optgroup label={t('softwareCenter.overview.agent.group.keyHub')}>
                                      {keyHubModelOptions.map((option) => (
                                        <option key={option.id} value={option.id}>{option.label}</option>
                                      ))}
                                    </optgroup>
                                  ) : null}
                                  {openclawModelOptions.length && keyHubModelOptions.length ? (
                                    <option disabled value="__divider__">----</option>
                                  ) : null}
                                  {openclawModelOptions.length ? (
                                    <optgroup label={t('softwareCenter.overview.agent.group.openclawSettings')}>
                                      {openclawModelOptions.map((option) => (
                                        <option key={option.id} value={option.id}>{option.label}</option>
                                      ))}
                                    </optgroup>
                                  ) : null}
                                </>
                              )}
                            </select>
                          </label>
                          <div className="flex flex-wrap justify-start gap-2">
                            <Button
                              variant="default"
                              className="h-10 px-5"
                              onClick={() => {
                                setAgentModelSaveMessage(null)
                                void refreshOverviewSnapshot()
                              }}
                              disabled={!isLoaded || savingAgentModel}
                            >
                              {t('softwareCenter.button.reloadConfig')}
                            </Button>
                            <Button
                              variant={hasAgentModelChanges ? 'brand' : 'default'}
                              className="h-10 px-5"
                              onClick={() => { void saveAgentPrimaryModel() }}
                              disabled={
                                !selectedAgentOverview
                                || !agentModelDraft.trim()
                                || !hasAgentModelChanges
                                || savingAgentModel
                              }
                            >
                              {savingAgentModel ? t('softwareCenter.button.savingChanges') : t('softwareCenter.button.saveChanges')}
                            </Button>
                          </div>
                        </div>
                        {agentModelSaveMessage ? (
                          <div className="mt-2 text-xs text-muted-foreground">{agentModelSaveMessage}</div>
                        ) : null}
                      </div>
                    </div>

                    <div className="hidden xl:block self-stretch bg-border/35" aria-hidden="true" />

                    <div className="space-y-3 xl:pl-2">
                      <div className="text-base font-semibold tracking-tight">{t('softwareCenter.overview.checks.title')}</div>
                      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                        <div className="rounded-xl border border-border/35 bg-layer-subtle/90 px-4 py-3">
                          <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{t('softwareCenter.overview.field.channelsReady')}</div>
                          <div className="mt-1 text-xl font-semibold tracking-tight">{isLoaded ? `${configuredChannels}/3` : t('softwareCenter.overview.loading')}</div>
                          <div className="mt-1 text-xs text-muted-foreground">telegram / feishu / discord</div>
                        </div>
                        <div className="rounded-xl border border-border/35 bg-layer-subtle/90 px-4 py-3">
                          <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{t('softwareCenter.overview.field.providerAuth')}</div>
                          <div className="mt-1 text-xl font-semibold tracking-tight">
                            {isLoaded ? (provider?.configured ? t('softwareCenter.overview.status.ready') : t('softwareCenter.overview.status.missing')) : t('softwareCenter.overview.loading')}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">{t('softwareCenter.overview.providerAuthHint')}</div>
                        </div>
                        <div className="rounded-xl border border-border/35 bg-layer-subtle/90 px-4 py-3">
                          <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{t('softwareCenter.overview.field.runtimeChecks')}</div>
                          <div className="mt-1 text-xl font-semibold tracking-tight">{isLoaded ? `${checksPassed}/4` : t('softwareCenter.overview.loading')}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{t('softwareCenter.overview.runtimeChecksHint')}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className={`space-y-4 rounded-3xl bg-muted/10 p-5 ${!isLoaded || showDashboardOverlay ? 'opacity-70' : ''}`}>
                  <h2 className="text-2xl font-semibold tracking-tight">Gateway</h2>
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_1px_minmax(0,0.85fr)] lg:items-stretch">
                    <div className="space-y-5 lg:pr-2">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="grid gap-1">
                          <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{t('softwareCenter.overview.field.websocketUrl')}</span>
                          <input
                            readOnly
                            value={gatewayWsUrl}
                            className="h-10 rounded-xl border border-border/35 bg-background/30 px-3 text-sm text-foreground outline-none"
                          />
                        </label>
                        <div className="grid gap-1">
                          <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{t('softwareCenter.overview.field.gatewayToken')}</span>
                          <div className="flex h-10 items-center gap-2 rounded-xl border border-border/35 bg-background/30 px-3">
                            <input
                              readOnly
                              value={tokenDisplay}
                              className="w-full bg-transparent text-sm text-foreground outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => setShowGatewayToken((previous) => !previous)}
                              disabled={!isLoaded || !tokenSource}
                              className="text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label={showGatewayToken ? t('softwareCenter.overview.token.hide') : t('softwareCenter.overview.token.show')}
                            >
                              {showGatewayToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>
                        <label className="grid gap-1">
                          <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{t('softwareCenter.overview.field.sessionKey')}</span>
                          <input
                            readOnly
                            value={isLoaded ? 'main' : t('softwareCenter.overview.loading')}
                            className="h-10 rounded-xl border border-border/35 bg-background/30 px-3 text-sm text-foreground outline-none"
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{t('softwareCenter.overview.field.language')}</span>
                          <input
                            readOnly
                            value={localeLabel}
                            className="h-10 rounded-xl border border-border/35 bg-background/30 px-3 text-sm text-foreground outline-none"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="default"
                          onClick={() => void openExternalUrl(overviewSnapshot?.overviewUrl || 'http://127.0.0.1:18789/overview')}
                          disabled={!isLoaded}
                        >
                          {t('softwareCenter.button.webDashboard')}
                        </Button>
                        <Button
                          variant="brand"
                          onClick={() => void navigate({ to: '/chat' })}
                        >
                          {t('softwareCenter.button.openChat')}
                        </Button>
                      </div>
                    </div>

                    <div className="hidden lg:block self-stretch bg-border/35" aria-hidden="true" />

                    <div className="space-y-5 lg:pl-2">
                      <div className="text-base font-semibold tracking-tight">{t('softwareCenter.overview.snapshot.title')}</div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="rounded-lg bg-background/20 px-3 py-3">
                          <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{t('softwareCenter.overview.field.status')}</div>
                          <div className="mt-2 text-sm font-medium text-foreground">
                            {isLoaded ? (readiness?.ok ? t('softwareCenter.overview.status.online') : t('softwareCenter.overview.status.offline')) : t('softwareCenter.overview.loading')}
                          </div>
                        </div>
                        <div className="rounded-lg bg-background/20 px-3 py-3">
                          <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{t('softwareCenter.overview.field.gatewayProcess')}</div>
                          <div className="mt-2 text-sm font-medium text-foreground">
                            {isLoaded ? (readiness?.gatewayRunning ? t('softwareCenter.overview.status.running') : t('softwareCenter.overview.status.stopped')) : t('softwareCenter.overview.loading')}
                          </div>
                        </div>
                        <div className="rounded-lg bg-background/20 px-3 py-3">
                          <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
                            {t('softwareCenter.overview.field.port')}{gatewayPort ? ` ${gatewayPort}` : ''}
                          </div>
                          <div className="mt-2 text-sm font-medium text-foreground">
                            {isLoaded ? (readiness?.portListening ? t('softwareCenter.overview.status.listening') : t('softwareCenter.overview.status.notListening')) : t('softwareCenter.overview.loading')}
                          </div>
                        </div>
                        <div className="rounded-lg bg-background/20 px-3 py-3">
                          <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{t('softwareCenter.overview.field.chatReachability')}</div>
                          <div className="mt-2 text-sm font-medium text-foreground">
                            {isLoaded ? (readiness?.chatReachable ? t('softwareCenter.overview.status.reachable') : t('softwareCenter.overview.status.unreachable')) : t('softwareCenter.overview.loading')}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {showDashboardOverlay ? (
                  <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[1.6rem] bg-background/70 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl border border-border/70 bg-background/85 p-5 text-center shadow-[0_20px_42px_-22px_rgba(0,0,0,0.7)]">
                      <div className="text-lg font-semibold">{t('chat.mask.title')}</div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        {showSetupWizardOverlay
                          ? t('chat.mask.description')
                          : `${t('setupWizard.errors.gatewayNotReady')}${readiness?.gatewayLogPath ? ` ${t('setupWizard.advice.logsPrefix')} ${readiness.gatewayLogPath}` : ''}${' ' + t('setupWizard.advice.gatewayRestart')}`}
                      </div>
                      <div className="mt-4 flex flex-col gap-2">
                        {showSetupWizardOverlay ? (
                          <Button
                            variant="brand"
                            onClick={() => {
                              void openSetupWizardWindow('openclaw')
                            }}
                            disabled={isRetryingGateway || isFixingGateway}
                          >
                            {t('chat.mask.openWizard')}
                          </Button>
                        ) : (
                          <>
                            <Button
                              variant="brand"
                              onClick={() => {
                                void handleRetryGateway()
                              }}
                              disabled={isRetryingGateway || isFixingGateway}
                            >
                              {t('chat.mask.retryGateway')}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => {
                                void handleFixGateway()
                              }}
                              disabled={isFixingGateway || isRetryingGateway}
                            >
                              {t('softwareCenter.button.restartGateway')}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })()}
      </div>

      <RuntimeSessionPanel
        key={ptySessionId ? `pty:${ptySessionId}` : `${runtimeActionLog?.runtimeId ?? ''}:${runtimeActionLog?.action ?? ''}:${runtimeActionLog?.running ? '1' : '0'}:${runtimeActionLog?.success ?? 'null'}`}
        open={runtimeSessionPanelOpen}
        log={runtimeActionLog}
        ptySessionId={ptySessionId}
        onPtyDone={(exitCode) => { void onPtyDone(exitCode) }}
        onOpenChange={closeRuntimeSessionPanel}
        autoCloseOnSuccess
        autoCloseDelayMs={900}
      />
    </div>
  )
}
