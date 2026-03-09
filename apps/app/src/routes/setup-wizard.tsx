import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@ui/components/card'
import { Combobox } from '@ui/components/combobox'
import {
  fetchRuntimeOverview,
  readRuntimeOverviewCache,
  runtimeIconText,
  type RuntimeViewModel,
} from '@/lib/runtimes'
import { emitSetupStateChanged } from '@/lib/setup-events'
import { tauriInvoke } from '@/lib/tauri'
import { listenRuntimeActionOutput } from '@/lib/runtime-action-events'
import {
  getOpenClawProviderConfigStatus,
  getOpenClawChannelConfigStatus,
  saveTelegramChannelSetup,
  type OpenClawChannelConfigStatus,
  type OpenClawProviderConfigStatus,
} from '@/lib/openclaw-config'
import {
  checkOpenClawReadiness,
  getOpenClawChatUrl,
  handoffOpenClawSetup,
  openExternalUrl,
  type ChannelKind,
} from '@/lib/openclaw-handoff'
import { publishLifecycleTask } from '@/lib/lifecycle-bus'
import { useLocale } from '@/lib/locale-context'
import { RuntimeSessionPanel } from '@/components/runtime-session-panel'
import {
  shellArgvForScript,
  shellKindForPlatform,
} from '@/lib/bash'
import {
  buildOpenClawInstallScriptUnix,
  buildOpenClawInstallScriptWindows,
} from '@/lib/openclaw-installer'
import { defaultBaseUrl, getProviderSetup, saveProviderSetup, setActiveProviderProfile } from '@/lib/provider-setup'
import { externalLinks } from '@/lib/external-links'
import { useLifecycleStore } from '@/stores/lifecycle-store'

export const Route = createFileRoute('/setup-wizard')({
  component: SetupWizardPage,
})

type StepId = 1 | 2 | 3

const channelNames: Record<ChannelKind, string> = {
  telegram: 'Telegram',
  feishu: 'Feishu',
  discord: 'Discord',
}

const KEY_MODEL_SUGGESTIONS: Record<string, string[]> = {
  // From OpenClaw docs + a few common fallbacks. Users can always type any model.
  openai: ['gpt-5.2', 'gpt-5.1-codex', 'gpt-4.1', 'gpt-4o', 'gpt-4.1-mini', 'o3-mini'],
  anthropic: ['claude-sonnet-4-5', 'claude-opus-4-6', 'claude-haiku-3.5'],
  holycrab: [
    'gpt-5.2-codex',
    'gpt-4o-mini',
    'grok-4',
    'qwen3-coder-480b-a35b-instruct',
    'claude-sonnet-4-6',
    'claude-opus-4-6',
    'claude-opus-4-5-20251101-thinking',
  ],
  'naci-openai': ['gpt-4.1', 'gpt-4o', 'gpt-5.2'],
  'naci-anthropic': ['claude-sonnet-4-5', 'claude-opus-4-6', 'claude-opus-4-5-20251101-thinking', 'claude-haiku-3.5'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  // OpenRouter is OpenAI-compatible; model ids are usually vendor/model (not openrouter/vendor/model).
  openrouter: ['anthropic/claude-sonnet-4-5', 'openai/gpt-5.2', 'moonshot/kimi-k2.5'],
  moonshot: ['kimi-k2.5', 'kimi-k2-thinking', 'kimi-k2-thinking-turbo', 'kimi-k2-turbo-preview', 'kimi-k2-0905-preview'],
  'moonshot-cn': ['kimi-k2.5', 'kimi-k2-thinking', 'kimi-k2-thinking-turbo', 'kimi-k2-turbo-preview', 'kimi-k2-0905-preview'],
  litellm: ['gpt-4.1', 'claude-opus-4-6', 'gemini-2.5-pro'],
  minimax: ['MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.1'],
  'minimax-cn': ['MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.1'],
  zhipu: ['glm-4.7', 'glm-4.5'],
  zai: ['glm-4.7', 'glm-4.5'],
  xai: ['grok-4', 'grok-2'],
  venice: ['llama-3.3-70b', 'qwen3-vl-235b-a22b', 'qwen3-coder-480b-a35b-instruct', 'venice-uncensored'],
  custom: [],
}

const KEY_PROVIDER_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'holycrab', label: 'HolyCrab' },
  { id: 'naci-openai', label: 'NACI (OpenAI)' },
  { id: 'naci-anthropic', label: 'NACI (Anthropic)' },
  { id: 'google', label: 'Google' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'moonshot', label: 'Moonshot' },
  { id: 'moonshot-cn', label: 'Moonshot (CN)' },
  { id: 'litellm', label: 'LiteLLM' },
  { id: 'minimax', label: 'MiniMax' },
  { id: 'minimax-cn', label: 'MiniMax (CN)' },
  { id: 'zhipu', label: 'Zhipu (CN)' },
  { id: 'zai', label: 'Z.AI' },
  { id: 'xai', label: 'xAI' },
  { id: 'venice', label: 'Venice' },
  { id: 'custom', label: 'Custom' },
]

type ProviderSetupView = {
  profiles: Array<{
    id: string
    name?: string | null
    provider: string
    baseUrl: string
    model: string
    apiKey?: string | null
    configured?: boolean
    apiKeySet?: boolean
  }>
  activeProfileId?: string | null
  configured: boolean
}

type KeySetupMode = 'existing' | 'new'

function formatYmd(date: Date) {
  const y = String(date.getFullYear())
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function slugifyPart(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function buildAutoName({
  provider,
  model,
  existingNames,
  now,
}: {
  provider: string
  model: string
  existingNames: string[]
  now: Date
}) {
  const providerSlug = slugifyPart(provider || 'provider')
  const modelSlug = slugifyPart(model || 'model') || 'model'
  const datePart = formatYmd(now)
  const prefix = `${providerSlug}-${modelSlug}-${datePart}-`

  let maxN = 0
  for (const name of existingNames) {
    if (!name?.startsWith(prefix)) continue
    const tail = name.slice(prefix.length)
    const n = Number.parseInt(tail, 10)
    if (Number.isFinite(n) && n > maxN) maxN = n
  }

  const next = String(maxN + 1).padStart(2, '0')
  return `${prefix}${next}`
}

function SetupWizardPage() {
  const { t } = useLocale()
  const hostShellKind = shellKindForPlatform(
    typeof window === 'undefined' ? '' : `${window.navigator.userAgent} ${window.navigator.platform}`,
  )
  const [runtimes, setRuntimes] = useState<RuntimeViewModel[]>([])
  const [providerSetup, setProviderSetup] = useState<ProviderSetupView | null>(null)
  const [openclawProviderConfig, setOpenclawProviderConfig] = useState<OpenClawProviderConfigStatus | null>(null)
  const [providerChecking, setProviderChecking] = useState(true)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [installingOpenClaw, setInstallingOpenClaw] = useState(false)
  const [, setPtyActionKind] = useState<'openclaw-install' | null>(null)
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false)
  const [installLog, setInstallLog] = useState<{ running: boolean; success: boolean | null; lines: string[] } | null>(null)
  const [ptySessionId, setPtySessionId] = useState<string | null>(null)
  const [channel, setChannel] = useState<ChannelKind>('telegram')
  const [channelConfig, setChannelConfig] = useState<OpenClawChannelConfigStatus | null>(null)
  const [channelChecking, setChannelChecking] = useState(false)
  const [handoffRunning, setHandoffRunning] = useState(false)
  const [openingChat, setOpeningChat] = useState(false)
  const [telegramBotToken, setTelegramBotToken] = useState('')
  const [savingTelegramConfig, setSavingTelegramConfig] = useState(false)

  const [keyProvider, setKeyProvider] = useState<string>('openai')
  const [keyModel, setKeyModel] = useState<string>('gpt-4.1')
  const [keyBaseUrl, setKeyBaseUrl] = useState<string>(defaultBaseUrl('openai'))
  const [keyApiKey, setKeyApiKey] = useState<string>('')
  const [keyShow, setKeyShow] = useState(false)
  const [keySaving, setKeySaving] = useState(false)
  const [keyDraftInit, setKeyDraftInit] = useState(false)
  const [keyDraftTouched, setKeyDraftTouched] = useState(false)
  const [keySetupMode, setKeySetupMode] = useState<KeySetupMode>('new')
  const [keySetupModeInit, setKeySetupModeInit] = useState(false)
  const [existingProfileId, setExistingProfileId] = useState('')
  const [stepOverride, setStepOverride] = useState<StepId | null>(null)
  const lifecycleTasks = useLifecycleStore((state) => state.tasks)

  const keyModelSuggestions = useMemo(() => {
    return KEY_MODEL_SUGGESTIONS[keyProvider] ?? []
  }, [keyProvider])

  const keyDefaultModel = useMemo(() => {
    return keyModelSuggestions[0] || 'gpt-4.1'
  }, [keyModelSuggestions])

  const openclawRuntime = useMemo(
    () => runtimes.find((runtime) => runtime.id === 'openclaw'),
    [runtimes],
  )
  const keysReady = providerSetup?.configured ?? false
  const openclawAuthReady = openclawProviderConfig?.configured ?? false
  const openclawReady = openclawRuntime?.installed ?? false
  const canConfigureChannel = openclawReady && openclawAuthReady
  const derivedStep: StepId = !keysReady || !openclawAuthReady ? 1 : 2
  const currentStep: StepId = stepOverride ?? derivedStep
  const canProceedAfterOpenClawInstall = Boolean(openclawReady || installLog?.success)
  const installingOpenClawNow = installingOpenClaw || lifecycleTasks['setup:openclaw-install']?.status === 'running'
  const handoffRunningNow = handoffRunning || lifecycleTasks[`channel-handoff:${channel}`]?.status === 'running'
  const openingChatNow = openingChat || lifecycleTasks[`setup:open-chat:${channel}`]?.status === 'running'
  const savingTelegramConfigNow = savingTelegramConfig || lifecycleTasks['setup:telegram-save']?.status === 'running'

  const holdOnKeyStep = () => {
    setStepOverride(1)
  }
  const holdOnKeyStepWhileEditing = () => {
    setKeyDraftTouched(true)
    holdOnKeyStep()
  }

  const activeProfile = useMemo(() => {
    if (!providerSetup?.profiles?.length) return null
    const id = providerSetup.activeProfileId || ''
    return providerSetup.profiles.find((p) => p.id === id) ?? null
  }, [providerSetup?.activeProfileId, providerSetup?.profiles])
  const keyStepLoading = providerChecking || !providerSetup || !openclawProviderConfig
  const existingConfiguredProfiles = useMemo(() => {
    return (providerSetup?.profiles ?? []).filter((profile) => profile.configured && profile.apiKeySet)
  }, [providerSetup?.profiles])

  useEffect(() => {
    if (keyDraftInit) return
    if (!providerSetup) return
    if (keyDraftTouched) {
      setKeyDraftInit(true)
      return
    }
    // Initialize the draft from the active profile (if any). Do this once per mount.
    if (activeProfile) {
      setKeyProvider(activeProfile.provider || 'openai')
      setKeyModel(activeProfile.model || 'gpt-4.1')
      setKeyBaseUrl(activeProfile.baseUrl || defaultBaseUrl(activeProfile.provider || 'openai'))
      setKeyApiKey(activeProfile.apiKey || '')
    }
    setKeyDraftInit(true)
  }, [activeProfile, keyDraftInit, keyDraftTouched, providerSetup])

  useEffect(() => {
    if (!providerSetup) return
    if (keySetupModeInit) return

    setKeySetupMode(existingConfiguredProfiles.length > 0 ? 'existing' : 'new')
    setKeySetupModeInit(true)
  }, [existingConfiguredProfiles.length, keySetupModeInit, providerSetup])

  useEffect(() => {
    if (existingConfiguredProfiles.length === 0) {
      setExistingProfileId('')
      setKeySetupMode('new')
      return
    }

    const activeId = providerSetup?.activeProfileId || ''
    const preferredId = existingConfiguredProfiles.some((profile) => profile.id === activeId)
      ? activeId
      : (existingConfiguredProfiles[0]?.id || '')
    const stillValid = existingConfiguredProfiles.some((profile) => profile.id === existingProfileId)

    if (!stillValid) {
      setExistingProfileId(preferredId)
    }
  }, [existingConfiguredProfiles, existingProfileId, providerSetup?.activeProfileId])

  useEffect(() => {
    setStepOverride(null)
    setKeySetupModeInit(false)
  }, [])

  const refresh = async (
    { includeRuntime = true, forceRuntime = false }: { includeRuntime?: boolean; forceRuntime?: boolean } = {},
  ) => {
    setProviderChecking(true)
    setLoading(includeRuntime)
    setError(null)
    let openclawInstalled = false
    let firstError: string | null = null

    try {
      const providerStatePromise = getProviderSetup()
      const openclawConfigPromise = getOpenClawProviderConfigStatus()
      const [providerState, openclawConfig] = await Promise.all([
        providerStatePromise,
        openclawConfigPromise,
      ])
      const providerData: ProviderSetupView = {
        profiles: providerState.profiles,
        activeProfileId: providerState.activeProfileId,
        configured: providerState.configured,
      }
      setProviderSetup(providerData)
      setOpenclawProviderConfig(openclawConfig)
    } catch (err) {
      console.error(err)
      firstError = String(err)
      setError(firstError)
    } finally {
      setProviderChecking(false)
    }

    if (includeRuntime) {
      try {
        const runtimeData = await fetchRuntimeOverview(undefined, { forceStatuses: forceRuntime })
        setRuntimes(runtimeData)
        openclawInstalled = runtimeData.some((runtime) => runtime.id === 'openclaw' && runtime.installed)
      } catch (err) {
        console.error(err)
        if (!firstError) {
          firstError = String(err)
          setError(firstError)
        }
      } finally {
        setLoading(false)
      }
    } else {
      setLoading(false)
    }
    return { openclawInstalled }
  }

  const onSaveKeyInWizard = async () => {
    setMessage(null)
    setError(null)
    setKeySaving(true)
    try {
      if (!keyApiKey.trim()) throw new Error(t('setupWizard.errors.apiKeyRequired'))

      if (!keyBaseUrl.trim()) throw new Error(t('setupWizard.errors.baseUrlRequired'))
      if (!keyModel.trim()) throw new Error(t('setupWizard.errors.modelRequired'))

      const existingNames = (providerSetup?.profiles ?? []).map((p) => p.name || '').filter(Boolean)
      const name = buildAutoName({
        provider: keyProvider,
        model: keyModel.trim(),
        existingNames,
        now: new Date(),
      })

      const result = await saveProviderSetup({
        name,
        mode: 'custom',
        provider: keyProvider,
        baseUrl: keyBaseUrl.trim(),
        apiKey: keyApiKey.trim(),
        model: keyModel.trim(),
        customParams: '',
        setActive: true,
      })

      setMessage(t('setupWizard.messages.saved'))
      const refreshed = await refresh({ includeRuntime: true, forceRuntime: true })
      const status = await getOpenClawProviderConfigStatus()
      setOpenclawProviderConfig(status)
      emitSetupStateChanged()
      if (status.configured) {
        const openclawInstalledNow = refreshed.openclawInstalled || Boolean(openclawRuntime?.installed)
        setStepOverride(openclawInstalledNow ? 3 : 2)
      } else {
        setStepOverride(1)
        setError(status.message || t('setupWizard.errors.openclawAuthProfilesNotReady'))
      }
      return result
    } catch (err) {
      console.error(err)
      setError(String(err))
      return null
    } finally {
      setKeySaving(false)
    }
  }

  const onUseExistingKeyInWizard = async () => {
    setMessage(null)
    setError(null)
    setKeySaving(true)
    try {
      if (!existingProfileId) throw new Error(t('setupWizard.errors.existingProfileRequired'))

      await setActiveProviderProfile(existingProfileId)
      setMessage(t('setupWizard.messages.usingExistingKeyProfile'))
      const refreshed = await refresh({ includeRuntime: true, forceRuntime: true })
      const status = await getOpenClawProviderConfigStatus()
      setOpenclawProviderConfig(status)
      emitSetupStateChanged()
      if (status.configured) {
        const openclawInstalledNow = refreshed.openclawInstalled || Boolean(openclawRuntime?.installed)
        setStepOverride(openclawInstalledNow ? 3 : 2)
      } else {
        setStepOverride(1)
        setError(status.message || t('setupWizard.errors.openclawAuthProfilesNotReady'))
      }
    } catch (err) {
      console.error(err)
      setError(String(err))
    } finally {
      setKeySaving(false)
    }
  }

  useEffect(() => {
    const cachedRuntimes = readRuntimeOverviewCache()
    if (cachedRuntimes?.length) {
      setRuntimes(cachedRuntimes)
      // Cache is optimistic UI only; always refresh statuses so manual installs/uninstalls are reflected.
      void refresh({ includeRuntime: true, forceRuntime: true })
      return
    }
    void refresh({ includeRuntime: true, forceRuntime: true })
  }, [])

  useEffect(() => {
    let mounted = true
    let unlisten: (() => void) | undefined

    void listenRuntimeActionOutput((payload) => {
      if (!mounted) return
      if (payload.runtimeId !== 'openclaw') return

      setSessionPanelOpen(true)
      const line = payload.line?.trimEnd() || ''
      setInstallLog((previous) => {
        const next = previous ?? { running: true, success: null, lines: [] }
        const lines = line.length > 0 ? [...next.lines, line] : next.lines
        return {
          running: payload.done ? false : true,
          success: payload.done ? (payload.success ?? null) : null,
          lines,
        }
      })
      if (payload.done) {
        void refresh({ includeRuntime: true })
      }
    })
      .then((dispose) => {
        if (mounted) {
          unlisten = dispose
        } else {
          dispose()
        }
      })
      .catch((err) => {
        console.error(err)
      })

    return () => {
      mounted = false
      if (unlisten) unlisten()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!canConfigureChannel) {
      setChannelConfig(null)
      return () => {
        cancelled = true
      }
    }

    setChannelChecking(true)
    void getOpenClawChannelConfigStatus(channel)
      .then((status) => {
        if (!cancelled) {
          setChannelConfig(status)
        }
      })
      .catch((err) => {
        console.error(err)
        if (!cancelled) {
          setChannelConfig({
            channel,
            configured: false,
            exists: false,
            message: String(err),
          })
        }
      })
      .finally(() => {
        if (!cancelled) {
          setChannelChecking(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [canConfigureChannel, channel])

  const onInstallOpenClaw = async () => {
    setMessage(null)
    setError(null)
    setInstallingOpenClaw(true)
    setSessionPanelOpen(true)
    setInstallLog({ running: true, success: null, lines: [] })
    setPtyActionKind('openclaw-install')
    void publishLifecycleTask({
      key: 'setup:openclaw-install',
      scope: 'setupWizard',
      status: 'running',
      message: 'openclaw install started',
      source: 'setup-wizard',
    }).catch(() => {})
    try {
      const script = hostShellKind === 'powershell'
        ? buildOpenClawInstallScriptWindows({
            notOnPathMessage: t('setupWizard.errors.openclawInstalledButNotOnPath'),
          })
        : buildOpenClawInstallScriptUnix({
            notOnPathMessage: t('setupWizard.errors.openclawInstalledButNotOnPath'),
            tipRunMessage: t('setupWizard.errors.tipOpenTerminalRun'),
          })

      const result = await tauriInvoke<{ sessionId: string }>('pty_start', {
        argv: shellArgvForScript(script, hostShellKind),
        cols: 100,
        rows: 30,
      })
      setPtySessionId(result.sessionId)
    } catch (err) {
      console.error(err)
      setError(String(err))
      setInstallLog({ running: false, success: false, lines: [] })
      setInstallingOpenClaw(false)
      void publishLifecycleTask({
        key: 'setup:openclaw-install',
        scope: 'setupWizard',
        status: 'error',
        message: String(err),
        source: 'setup-wizard',
      }).catch(() => {})
    } finally {
      // cleared on PTY completion
    }
  }

  const onSaveTelegramConfig = async () => {
    setMessage(null)
    setError(null)
    const token = telegramBotToken.trim()
    if (!token) {
      setError(t('setupWizard.errors.telegramTokenRequired'))
      return
    }
    if (!token.includes(':')) {
      setError(t('setupWizard.errors.telegramTokenInvalidFormat'))
      return
    }

    setSavingTelegramConfig(true)
    void publishLifecycleTask({
      key: 'setup:telegram-save',
      scope: 'setupWizard',
      status: 'running',
      message: 'saving telegram channel config',
      source: 'setup-wizard',
    }).catch(() => {})
    try {
      const result = await saveTelegramChannelSetup({
        runtime: 'openclaw',
        botToken: token,
      })
      setMessage(`${result.message} (${result.configPath})`)
      const status = await getOpenClawChannelConfigStatus('telegram')
      setChannelConfig(status)
      // "Save & Connect" should actually connect after saving.
      await onStartChat()
      await emitSetupStateChanged({ source: 'openclaw:telegram:save' })
      void publishLifecycleTask({
        key: 'setup:telegram-save',
        scope: 'setupWizard',
        status: 'completed',
        message: result.message,
        source: 'setup-wizard',
      }).catch(() => {})
    } catch (err) {
      console.error(err)
      setError(String(err))
      void publishLifecycleTask({
        key: 'setup:telegram-save',
        scope: 'setupWizard',
        status: 'error',
        message: String(err),
        source: 'setup-wizard',
      }).catch(() => {})
    } finally {
      setSavingTelegramConfig(false)
    }
  }

  const onInstallPtyDone = async (exitCode: number) => {
    const success = exitCode === 0
    setInstallLog((previous) => ({ ...(previous ?? { running: true, success: null, lines: [] }), running: false, success }))
    setInstallingOpenClaw(false)
    void publishLifecycleTask({
      key: 'setup:openclaw-install',
      scope: 'setupWizard',
      status: success ? 'completed' : 'error',
      message: success ? 'openclaw install completed' : `openclaw install failed (${exitCode})`,
      source: 'setup-wizard',
    }).catch(() => {})

    if (!success) {
      setError(`${t('setupWizard.errors.installFailedPrefix')} ${exitCode}${t('setupWizard.errors.installFailedSuffix')}`)
      setPtyActionKind(null)
      return
    }

    const state = await refresh({ includeRuntime: true, forceRuntime: true })
    await emitSetupStateChanged({ source: 'setup-wizard:openclaw-install' })
    if (state.openclawInstalled) {
      if (hostShellKind === 'powershell') {
        setStepOverride(null)
        setMessage(t('setupWizard.messages.openclawInstalled'))
      } else {
        // Ensure gateway is loopback-only and running so Start Chat works immediately.
        type SecurityFixResult = { ok: boolean; changed: boolean; restarted: boolean; error?: string | null }
        const fix = await tauriInvoke<SecurityFixResult>('apply_security_fix').catch(() => null)
        const secured = Boolean(fix?.ok)

        const readiness = await checkOpenClawReadiness({ attemptFix: true }).catch(() => null)
        if (!readiness || !readiness.ok) {
          const advice = readiness?.advice?.length
            ? readiness.advice.map((line) => `- ${line}`).join('\n')
            : t('setupWizard.advice.installGatewayRestart')
          setError(
            [
              t('setupWizard.errors.gatewayNotReadyAfterInstall'),
              advice,
              readiness?.gatewayLogPath ? `${t('setupWizard.advice.logsPrefix')} ${readiness.gatewayLogPath}` : null,
            ]
              .filter(Boolean)
              .join('\n'),
          )
          setMessage(
            secured ? t('setupWizard.messages.openclawInstalledGatewaySecured') : t('setupWizard.messages.openclawInstalled'),
          )
          return
        }

        setStepOverride(null)
        setMessage(
          secured
            ? t('setupWizard.messages.openclawInstalledGatewaySecuredReady')
            : t('setupWizard.messages.openclawInstalledGatewayReady'),
        )
      }
    } else {
      setMessage(t('setupWizard.messages.openclawInstalled'))
    }
    setPtyActionKind(null)
  }

  const onStartChat = async () => {
    setMessage(null)
    setError(null)
    if (!canConfigureChannel) {
      setError(t('setupWizard.errors.completeStepsBeforeChannel'))
      return
    }
    setOpeningChat(true)
    void publishLifecycleTask({
      key: `setup:open-chat:${channel}`,
      scope: 'setupWizard',
      status: 'running',
      message: `opening openclaw chat for ${channel}`,
      source: 'setup-wizard',
    }).catch(() => {})
    try {
      if (hostShellKind !== 'powershell') {
        // Start Chat should stay responsive. Do a fast readiness probe only.
        const readiness = await checkOpenClawReadiness({ attemptFix: false })
        if (!readiness.ok) {
          const advice = readiness.advice?.length
            ? readiness.advice.map((line) => `- ${line}`).join('\n')
            : t('setupWizard.advice.gatewayRestart')
          setError(
            [
              t('setupWizard.errors.gatewayNotReady'),
              advice,
              readiness.gatewayLogPath ? `${t('setupWizard.advice.logsPrefix')} ${readiness.gatewayLogPath}` : null,
            ]
              .filter(Boolean)
              .join('\n'),
          )
          void publishLifecycleTask({
            key: `setup:open-chat:${channel}`,
            scope: 'setupWizard',
            status: 'error',
            message: 'gateway not ready for chat',
            source: 'setup-wizard',
          }).catch(() => {})
          return
        }
      }
      const chatUrl = await getOpenClawChatUrl()
      await openExternalUrl(chatUrl)
      setMessage(t('setupWizard.messages.openclawChatOpened'))
      void publishLifecycleTask({
        key: `setup:open-chat:${channel}`,
        scope: 'setupWizard',
        status: 'completed',
        message: 'openclaw chat opened',
        source: 'setup-wizard',
      }).catch(() => {})
    } catch (err) {
      console.error(err)
      setError(String(err))
      void publishLifecycleTask({
        key: `setup:open-chat:${channel}`,
        scope: 'setupWizard',
        status: 'error',
        message: String(err),
        source: 'setup-wizard',
      }).catch(() => {})
    } finally {
      setOpeningChat(false)
    }
  }

  const onCompleteSetupWizard = async () => {
    setMessage(null)
    setError(null)
    try {
      await emitSetupStateChanged({ source: 'setup-wizard:completed' })
      await tauriInvoke('complete_setup_wizard')
    } catch (err) {
      console.error(err)
      setError(String(err))
    }
  }

  const onSetupChannel = async () => {
    setMessage(null)
    setError(null)
    if (!canConfigureChannel) {
      setError(t('setupWizard.errors.completeStepsBeforeChannel'))
      return
    }

    setHandoffRunning(true)
    try {
      const result = await handoffOpenClawSetup({ channel })
      await openExternalUrl(result.chatUrl)
      setMessage(result.message)
    } catch (err) {
      console.error(err)
      setError(String(err))
    } finally {
      setHandoffRunning(false)
    }
  }

  const onSessionPanelOpenChange = (nextOpen: boolean) => {
    setSessionPanelOpen(nextOpen)
    if (!nextOpen && ptySessionId) {
      void tauriInvoke('pty_close', { session_id: ptySessionId }).catch(() => {})
      setPtySessionId(null)
      setPtyActionKind(null)
      setInstallingOpenClaw(false)
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl leading-tight">
            {t('setupWizard.page.title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('setupWizard.page.subtitle')}
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
      ) : null}
      {message ? (
        <div className="rounded-2xl bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">{message}</div>
      ) : null}

      <Card className="bg-surface-elevated">
        <CardHeader>
          <CardTitle>
            {currentStep === 1 ? t('setupWizard.keys.cardTitle') : t('setupWizard.install.cardTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <>
              {currentStep === 1 ? (
                <>
                  {keyStepLoading ? (
                    <div className="rounded-2xl bg-background/30 p-5">
                      <div className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm text-muted-foreground">
                        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary/80" />
                        {t('setupWizard.status.checkingSavedProviderSetup')}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-background/50 font-mono text-sm font-semibold">
                          KEY
                        </div>
                        <div className="text-sm text-muted-foreground">{t('setupWizard.keys.blurb')}</div>
                      </div>

                      {existingConfiguredProfiles.length > 0 ? (
                        <div className="inline-flex items-center rounded-xl border border-border/70 bg-background/40 p-1">
                          <button
                            type="button"
                            className={`rounded-lg px-3 py-1.5 text-sm transition ${
                              keySetupMode === 'existing' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                            }`}
                            onClick={() => {
                              setKeySetupMode('existing')
                              setStepOverride(1)
                            }}
                          >
                            {t('setupWizard.mode.existing')}
                          </button>
                          <button
                            type="button"
                            className={`rounded-lg px-3 py-1.5 text-sm transition ${
                              keySetupMode === 'new' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                            }`}
                            onClick={() => {
                              setKeySetupMode('new')
                              setStepOverride(1)
                            }}
                          >
                            {t('setupWizard.mode.createNew')}
                          </button>
                        </div>
                      ) : null}

                      {keySetupMode === 'existing' && existingConfiguredProfiles.length > 0 ? (
                        <div className="grid gap-4 rounded-2xl bg-background/30 p-4">
                          <div className="space-y-2">
                            <div className="text-sm font-medium">{t('setupWizard.existingKey.title')}</div>
                            <div className="relative">
                              <select
                                className="h-10 w-full appearance-none rounded-xl border border-border/70 bg-background/60 px-3 pr-9 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                                value={existingProfileId}
                                onChange={(e) => {
                                  setExistingProfileId(e.target.value)
                                  setStepOverride(1)
                                }}
                              >
                                {existingConfiguredProfiles.map((profile) => (
                                  <option key={profile.id} value={profile.id}>
                                    {profile.name || `${profile.provider} · ${profile.model}`}
                                  </option>
                                ))}
                              </select>
                              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                ▼
                              </span>
                            </div>
                            {existingProfileId ? (
                              <div className="text-xs text-muted-foreground">
                                {(() => {
                                  const selected = existingConfiguredProfiles.find((profile) => profile.id === existingProfileId)
                                  if (!selected) return null
                                  return `${selected.provider} · ${selected.model}${selected.baseUrl ? ` · ${selected.baseUrl}` : ''}`
                                })()}
                              </div>
                            ) : null}
                          </div>

                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button variant="ghost" onClick={() => setKeySetupMode('new')}>
                              {t('setupWizard.button.createNewKey')}
                            </Button>
                            <Button
                              variant="brand"
                              onClick={() => void onUseExistingKeyInWizard()}
                              disabled={keySaving || !existingProfileId}
                            >
                              {keySaving ? t('setupWizard.button.saving') : t('setupWizard.button.useAndContinue')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-4 rounded-2xl bg-background/30 p-4">
                          <div className="grid gap-3 lg:grid-cols-2">
                            <div className="space-y-2">
                              <div className="text-sm font-medium">{t('setupWizard.field.provider')}</div>
                              <div className="relative">
                                <select
                                  className="h-10 w-full appearance-none rounded-xl border border-border/70 bg-background/60 px-3 pr-9 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                                  value={keyProvider}
                                  onChange={(e) => {
                                    const next = e.target.value
                                    holdOnKeyStepWhileEditing()
                                    setKeyProvider(next)
                                    setKeyBaseUrl(defaultBaseUrl(next))
                                    setKeyModel((KEY_MODEL_SUGGESTIONS[next] ?? [])[0] ?? 'gpt-4.1')
                                  }}
                                >
                                  {KEY_PROVIDER_OPTIONS.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                  ▼
                                </span>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <div className="text-sm font-medium">{t('setupWizard.field.model')}</div>
                              <Combobox
                                value={keyModel}
                                onValueChange={(next) => {
                                  holdOnKeyStepWhileEditing()
                                  setKeyModel(next)
                                }}
                                placeholder={keyDefaultModel}
                                searchPlaceholder={t('setupWizard.field.searchModels')}
                                options={keyModelSuggestions.map((m) => ({ value: m, label: m }))}
                                allowCustom
                              />
                              <div className="text-xs text-muted-foreground">{t('setupWizard.hint.pickModel')}</div>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="text-sm font-medium">{t('setupWizard.field.baseUrl')}</div>
                            <input
                              className="h-10 w-full rounded-xl border border-border/70 bg-background/60 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                              value={keyBaseUrl}
                              onChange={(e) => {
                                holdOnKeyStepWhileEditing()
                                setKeyBaseUrl(e.target.value)
                              }}
                              placeholder={t('setupWizard.placeholder.baseUrl')}
                            />
                            <div className="text-xs text-muted-foreground">{t('setupWizard.hint.baseUrlDefault')}</div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-medium">{t('setupWizard.field.apiKey')}</div>
                              <Button variant="ghost" size="sm" onClick={() => setKeyShow((v) => !v)}>
                                {keyShow ? t('setupWizard.field.hide') : t('setupWizard.field.show')}
                              </Button>
                            </div>
                            <input
                              className="h-10 w-full rounded-xl border border-border/70 bg-background/60 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                              type={keyShow ? 'text' : 'password'}
                              value={keyApiKey}
                              onChange={(e) => {
                                holdOnKeyStepWhileEditing()
                                setKeyApiKey(e.target.value)
                              }}
                              placeholder={t('setupWizard.placeholder.apiKey')}
                              autoComplete="off"
                            />
                          </div>

                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button variant="brand" onClick={() => void onSaveKeyInWizard()} disabled={keySaving}>
                              {keySaving ? t('setupWizard.button.saving') : t('setupWizard.button.save')}
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : null}

              {currentStep === 2 ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-background/50 font-mono text-sm font-semibold">
                      {openclawRuntime ? runtimeIconText(openclawRuntime) : 'OC'}
                    </div>
                    <div className="text-sm text-muted-foreground">{t('setupWizard.step1.blurb')}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="brand"
                      onClick={() => {
                        if (canProceedAfterOpenClawInstall) {
                          void onCompleteSetupWizard()
                          return
                        }
                        void onInstallOpenClaw()
                      }}
                      disabled={installingOpenClawNow || (!canProceedAfterOpenClawInstall && loading)}
                    >
                      {canProceedAfterOpenClawInstall
                        ? t('setupWizard.button.next')
                        : installingOpenClawNow
                          ? t('setupWizard.step1.button.installing')
                          : installLog?.success === false
                            ? t('setupWizard.step1.button.retryInstall')
                            : t('setupWizard.step1.button.install')}
                    </Button>
                  </div>
                  {installLog ? (
                    <div className="text-xs text-muted-foreground">{t('setupWizard.step1.hint.liveOutput')}</div>
                  ) : null}
                  <details className="rounded-2xl bg-background/30 px-4 py-3">
                    <summary className="cursor-pointer select-none text-sm font-medium text-muted-foreground">
                      {t('setupWizard.step1.troubleshooting')}
                    </summary>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button variant="ghost" onClick={() => void refresh({ includeRuntime: true })} disabled={loading}>
                        {loading ? t('common.checking') : t('setupWizard.step1.button.refreshDetection')}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setSessionPanelOpen(true)}
                        disabled={!installLog && !ptySessionId}
                      >
                        {t('setupWizard.step1.button.viewRuntimeSession')}
                      </Button>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">{t('setupWizard.step1.hint.sessionPanel')}</div>
                  </details>
                </>
              ) : null}

              {currentStep === 3 ? (
                <>
                  <div className="text-sm text-muted-foreground">
                    {t('setupWizard.step3.blurb')}
                  </div>

                  <div className="rounded-2xl bg-background/30 p-4">
                    <div className="text-sm font-medium">{t('setupWizard.step3.channel.title')}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{channelNames[channel]}</div>
                    <details className="mt-3 rounded-xl bg-background/25 px-3 py-2">
                      <summary className="cursor-pointer select-none text-sm font-medium text-muted-foreground">
                        {t('setupWizard.step3.changeChannel')}
                      </summary>
                      <div className="mt-3 grid gap-2">
                        <label className="text-xs text-muted-foreground" htmlFor="setup-channel">
                          {t('setupWizard.step3.channel.label')}
                        </label>
                        <select
                          id="setup-channel"
                          className="h-10 w-full rounded-xl border border-border/70 bg-background px-3 text-sm"
                          value={channel}
                          onChange={(e) => setChannel(e.target.value as ChannelKind)}
                          disabled={!canConfigureChannel}
                        >
                          {(['telegram', 'feishu', 'discord'] as ChannelKind[]).map((candidate) => (
                            <option key={candidate} value={candidate}>
                              {channelNames[candidate]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </details>
                  </div>

                  <div className="rounded-xl bg-background/25 p-3 text-sm text-muted-foreground">
                    {channelChecking
                      ? t(`setupWizard.step3.status.${channel}.checking`)
                      : channelConfig?.configured
                        ? t(`setupWizard.step3.status.${channel}.configured`)
                        : channelConfig?.exists
                          ? t(`setupWizard.step3.status.${channel}.exists`)
                          : t(`setupWizard.step3.status.${channel}.missing`)}
                    {channelConfig?.message ? (
                      <div className="mt-1 text-xs text-muted-foreground/90">{channelConfig.message}</div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="ghost" onClick={onStartChat} disabled={!canConfigureChannel || openingChatNow}>
                      {openingChatNow ? t('setupWizard.step3.button.opening') : t('setupWizard.step3.button.skipStartChat')}
                    </Button>
                  </div>

                  {channel === 'telegram' ? (
                    <div className="space-y-3 rounded-2xl bg-background/30 p-4">
                      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                        <div className="space-y-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-500/20 text-sm font-semibold text-sky-300">
                              TG
                            </div>
                            <div className="text-2xl font-semibold">{t('setupWizard.telegram.title')}</div>
                          </div>
                          <div className="text-sm font-medium">{t('setupWizard.telegram.howToGetToken')}</div>
                          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
                            <li>
                              {t('setupWizard.telegram.guide.step1Prefix')}{' '}
                              <button
                                type="button"
                                className="underline underline-offset-2"
                                onClick={() => void openExternalUrl(externalLinks.botfather)}
                              >
                                @BotFather
                              </button>
                              {t('setupWizard.telegram.guide.step1Suffix')}
                            </li>
                            <li>{t('setupWizard.telegram.guide.step2')} <code>/newbot</code>.</li>
                            <li>{t('setupWizard.telegram.guide.step3')}</li>
                            <li>{t('setupWizard.telegram.guide.step4')}</li>
                            <li>{t('setupWizard.telegram.guide.step5')}</li>
                          </ol>
                          <div className="space-y-2">
                            <label className="text-sm font-medium" htmlFor="openclaw-telegram-token">{t('setupWizard.telegram.label.botToken')}</label>
                            <input
                              id="openclaw-telegram-token"
                              className="h-11 w-full rounded-xl border border-border/70 bg-background/60 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                              value={telegramBotToken}
                              onChange={(e) => setTelegramBotToken(e.target.value)}
                              placeholder={t('setupWizard.telegram.placeholder.botToken')}
                              autoComplete="off"
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              variant="brand"
                              onClick={() => void onSaveTelegramConfig()}
                              disabled={savingTelegramConfigNow || !canConfigureChannel}
                            >
                              {savingTelegramConfigNow ? t('setupWizard.telegram.button.saving') : t('setupWizard.telegram.button.saveConnect')}
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <div className="mx-auto w-full max-w-[280px] rounded-[2rem] border border-border/70 bg-[#0d0f14] p-2 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]">
                            <div className="rounded-[1.6rem] border border-border/40 bg-black/70 p-1">
                              <video
                                className="aspect-[9/19.5] w-full rounded-[1.3rem] object-cover"
                                src={externalLinks.botfatherVideo}
                                controls
                                preload="metadata"
                              />
                            </div>
                          </div>
                          <div className="text-center text-xs text-muted-foreground">
                            {t('setupWizard.telegram.videoHintPrefix')}{' '}
                            <a
                              className="underline underline-offset-2"
                              href={externalLinks.botfatherVideo}
                              target="_blank"
                              rel="noreferrer"
                            >
                              botfather.mp4
                            </a>
                            {t('setupWizard.telegram.videoHintSuffix')}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        {!channelConfig?.configured ? (
                          <Button variant="brand" onClick={onSetupChannel} disabled={!canConfigureChannel || handoffRunningNow}>
                            {handoffRunningNow
                              ? t('setupWizard.step3.button.settingUp')
                              : t(`setupWizard.step3.button.setup.${channel}`)}
                          </Button>
                        ) : (
                          <Button variant="brand" onClick={onStartChat} disabled={!canConfigureChannel || openingChatNow}>
                            {openingChatNow ? t('setupWizard.step3.button.opening') : t('setupWizard.step3.button.startChat')}
                          </Button>
                        )}
                      </div>
                      {!channelConfig?.configured ? (
                        <details className="rounded-2xl bg-background/30 px-4 py-3">
                          <summary className="cursor-pointer select-none text-sm font-medium text-muted-foreground">
                            {t('setupWizard.step3.otherActions')}
                          </summary>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Button variant="ghost" onClick={onStartChat} disabled={!canConfigureChannel || openingChatNow}>
                              {openingChatNow ? t('setupWizard.step3.button.opening') : t('setupWizard.step3.button.startChat')}
                            </Button>
                          </div>
                        </details>
                      ) : null}
                    </>
                  )}
                </>
              ) : null}
          </>
        </CardContent>
      </Card>
      <RuntimeSessionPanel
        key={ptySessionId ? `pty:${ptySessionId}` : `install:${installLog?.running ? '1' : '0'}:${installLog?.success ?? 'null'}`}
        runtimeLabel={t('runtime.defaultLabel')}
        actionLabel={t('setupWizard.session.actionLabel.installUpgrade')}
        open={sessionPanelOpen}
        onOpenChange={onSessionPanelOpenChange}
        log={installLog}
        ptySessionId={ptySessionId}
        onPtyDone={(exitCode) => { void onInstallPtyDone(exitCode) }}
        autoCloseOnSuccess
        autoCloseDelayMs={900}
      />
    </div>
  )
}
