import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Button } from '@ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ui/components/dialog'
import { Input } from '@ui/components/input'
import { Separator } from '@ui/components/separator'
import { tauriInvoke } from '@/lib/tauri'
import { useLocale } from '@/lib/locale-context'
import type { Update } from '@tauri-apps/plugin-updater'
import {
  dictationCancelDownload,
  dictationDownloadModel,
  dictationModelStatus,
  dictationRemoveModel,
  listenDictationDownload,
  type DictationModelStatus,
} from '@/lib/dictation'
import {
  checkHolyCrabUpdate,
  getHolyCrabVersion,
  installHolyCrabUpdateAndRelaunch,
  predownloadHolyCrabUpdate,
  type UpdateProgress,
} from '@/lib/holycrab-updater'

interface SettingsView {
  controlPlaneUrl: string
  gatewayUrl: string
  rpcAddr: string
  rpcTokenSet: boolean
  openclawHooksUrl: string
  openclawTokenSet: boolean
  openclawTokenSaved: boolean
  openclawWsTokenSet: boolean
  openclawWsTokenSaved: boolean
  deviceId?: string | null
  authed: boolean
  tenantBaseUrl?: string | null
  companion: {
    enabled: boolean
    provider: string
    model: string
    voice: string
    namespace: string
    endpoint: string
    apiKeySet: boolean
    appKeySet: boolean
  }
  dictation: {
    enabled: boolean
    model: string
    language?: string | null
    holdKey: string
  }
  chat: {
    displayMode: string
    copyMode: string
    botAvatar: string
    avatarDataUrl?: string | null
  }
}

interface SettingsSaveResult {
  changed: boolean
  pairingCleared: boolean
  restartRequired: boolean
}

interface SecurityCheckResult {
  openclawHooksUrl?: string | null
  port: number
  isListening: boolean
  listeningAddresses: string[]
  socketListAvailable: boolean
  bindExposure: 'not_listening' | 'unknown' | 'loopback_only' | 'non_loopback' | 'all_interfaces'
  isExposedToAllInterfaces: boolean
  evidenceSource: string
  advice: string[]
}

interface SecurityFixResult {
  ok: boolean
  changed: boolean
  restarted: boolean
  configPath?: string | null
  nextBind?: string | null
  restartOutput?: string | null
  error?: string | null
  advice: string[]
}

interface MemorySyncStatus {
  last_backup_at_unix?: number | null
  last_restore_at_unix?: number | null
  last_error?: string | null
}

type DictationHoldKey = 'off' | 'alt' | 'shift' | 'control' | 'meta'
type ChatDisplayMode = 'collapsed' | 'content_only' | 'full'
type ChatCopyMode = 'markdown' | 'full' | 'text'
type ChatBotAvatar = 'default' | 'holycrab' | 'upload'

interface DictationSettings {
  dictationEnabled: boolean
  dictationModelId: string
  dictationPreferredLanguage: string | null
  dictationHoldKey: DictationHoldKey
}

interface ChatSettings {
  displayMode: ChatDisplayMode
  copyMode: ChatCopyMode
  botAvatar: ChatBotAvatar
  avatarDataUrl: string | null
}

type DictationAction = 'download' | 'cancel' | 'remove'

type DictationModelNoteKey =
  | 'settings.dictation.model.note.tiny'
  | 'settings.dictation.model.note.base'
  | 'settings.dictation.model.note.small'
  | 'settings.dictation.model.note.medium'
  | 'settings.dictation.model.note.largeV3'

type DictationLanguageLabelKey =
  | 'settings.dictation.language.option.auto'
  | 'settings.dictation.language.option.english'
  | 'settings.dictation.language.option.spanish'
  | 'settings.dictation.language.option.french'
  | 'settings.dictation.language.option.german'
  | 'settings.dictation.language.option.italian'
  | 'settings.dictation.language.option.portuguese'
  | 'settings.dictation.language.option.dutch'
  | 'settings.dictation.language.option.swedish'
  | 'settings.dictation.language.option.norwegian'
  | 'settings.dictation.language.option.danish'
  | 'settings.dictation.language.option.finnish'
  | 'settings.dictation.language.option.polish'
  | 'settings.dictation.language.option.turkish'
  | 'settings.dictation.language.option.russian'
  | 'settings.dictation.language.option.ukrainian'
  | 'settings.dictation.language.option.japanese'
  | 'settings.dictation.language.option.korean'
  | 'settings.dictation.language.option.chinese'

interface DictationModelOption {
  id: string
  label: string
  size: string
  noteKey: DictationModelNoteKey
}

interface DictationLanguageOption {
  value: string
  labelKey: DictationLanguageLabelKey
}


const DICTATION_MODELS: DictationModelOption[] = [
  { id: 'tiny', label: 'Tiny', size: '75 MB', noteKey: 'settings.dictation.model.note.tiny' },
  { id: 'base', label: 'Base', size: '142 MB', noteKey: 'settings.dictation.model.note.base' },
  { id: 'small', label: 'Small', size: '466 MB', noteKey: 'settings.dictation.model.note.small' },
  { id: 'medium', label: 'Medium', size: '1.5 GB', noteKey: 'settings.dictation.model.note.medium' },
  {
    id: 'large-v3',
    label: 'Large V3',
    size: '3.0 GB',
    noteKey: 'settings.dictation.model.note.largeV3',
  },
]

const DICTATION_LANGUAGES: DictationLanguageOption[] = [
  { value: '', labelKey: 'settings.dictation.language.option.auto' },
  { value: 'en', labelKey: 'settings.dictation.language.option.english' },
  { value: 'es', labelKey: 'settings.dictation.language.option.spanish' },
  { value: 'fr', labelKey: 'settings.dictation.language.option.french' },
  { value: 'de', labelKey: 'settings.dictation.language.option.german' },
  { value: 'it', labelKey: 'settings.dictation.language.option.italian' },
  { value: 'pt', labelKey: 'settings.dictation.language.option.portuguese' },
  { value: 'nl', labelKey: 'settings.dictation.language.option.dutch' },
  { value: 'sv', labelKey: 'settings.dictation.language.option.swedish' },
  { value: 'no', labelKey: 'settings.dictation.language.option.norwegian' },
  { value: 'da', labelKey: 'settings.dictation.language.option.danish' },
  { value: 'fi', labelKey: 'settings.dictation.language.option.finnish' },
  { value: 'pl', labelKey: 'settings.dictation.language.option.polish' },
  { value: 'tr', labelKey: 'settings.dictation.language.option.turkish' },
  { value: 'ru', labelKey: 'settings.dictation.language.option.russian' },
  { value: 'uk', labelKey: 'settings.dictation.language.option.ukrainian' },
  { value: 'ja', labelKey: 'settings.dictation.language.option.japanese' },
  { value: 'ko', labelKey: 'settings.dictation.language.option.korean' },
  { value: 'zh', labelKey: 'settings.dictation.language.option.chinese' },
]

const DEFAULT_DICTATION_SETTINGS: DictationSettings = {
  dictationEnabled: false,
  dictationModelId: 'base',
  dictationPreferredLanguage: null,
  dictationHoldKey: 'alt',
}

const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  displayMode: 'full',
  copyMode: 'markdown',
  botAvatar: 'default',
  avatarDataUrl: null,
}

function normalizeDictationSettings(
  input: Partial<{
    enabled: boolean
    model: string
    language: string | null
    holdKey: string
  }>,
): DictationSettings {
  const modelIds = new Set(DICTATION_MODELS.map((item) => item.id))
  const holdKeys = new Set(['off', 'alt', 'shift', 'control', 'meta'])
  const languageValues = new Set(DICTATION_LANGUAGES.map((item) => item.value))
  const normalizedLanguage = typeof input.language === 'string'
    ? input.language.trim().toLowerCase()
    : ''
  const normalizedHoldKey = typeof input.holdKey === 'string'
    ? input.holdKey.trim().toLowerCase()
    : ''
  const normalizedModelId = typeof input.model === 'string'
    ? input.model.trim()
    : ''

  return {
    dictationEnabled: Boolean(input.enabled),
    dictationModelId: modelIds.has(normalizedModelId)
        ? normalizedModelId
        : DEFAULT_DICTATION_SETTINGS.dictationModelId,
    dictationPreferredLanguage:
      normalizedLanguage && languageValues.has(normalizedLanguage)
        ? normalizedLanguage
        : null,
    dictationHoldKey:
      holdKeys.has(normalizedHoldKey)
        ? (normalizedHoldKey as DictationHoldKey)
        : DEFAULT_DICTATION_SETTINGS.dictationHoldKey,
  }
}

function normalizeChatSettings(
  input: Partial<{
    displayMode: string
    copyMode: string
    botAvatar: string
    avatarDataUrl: string | null
  }>,
): ChatSettings {
  const displayMode = typeof input.displayMode === 'string'
    ? input.displayMode.trim().toLowerCase()
    : ''
  const copyMode = typeof input.copyMode === 'string'
    ? input.copyMode.trim().toLowerCase()
    : ''
  const botAvatar = typeof input.botAvatar === 'string'
    ? input.botAvatar.trim().toLowerCase()
    : ''
  const avatarDataUrl = typeof input.avatarDataUrl === 'string'
    ? input.avatarDataUrl.trim()
    : ''

  return {
    displayMode:
      displayMode === 'collapsed' || displayMode === 'content_only' || displayMode === 'full'
        ? (displayMode as ChatDisplayMode)
        : DEFAULT_CHAT_SETTINGS.displayMode,
    copyMode:
      copyMode === 'markdown' || copyMode === 'full' || copyMode === 'text'
        ? (copyMode as ChatCopyMode)
        : DEFAULT_CHAT_SETTINGS.copyMode,
    botAvatar:
      botAvatar === 'default' || botAvatar === 'holycrab' || botAvatar === 'upload'
        ? (botAvatar as ChatBotAvatar)
        : DEFAULT_CHAT_SETTINGS.botAvatar,
    avatarDataUrl: avatarDataUrl.length > 0 ? avatarDataUrl : null,
  }
}

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const showDaemonSettings = false
  const showDaemonStatus = false
  const { locale, setLocale, t } = useLocale()
  const [holyCrabVersion, setHolyCrabVersion] = useState<string>('-')
  const [holyCrabUpdate, setHolyCrabUpdate] = useState<Update | null>(null)
  const [holyCrabUpdateChecking, setHolyCrabUpdateChecking] = useState(false)
  const [holyCrabCheckedOnce, setHolyCrabCheckedOnce] = useState(false)
  const [holyCrabUpdateError, setHolyCrabUpdateError] = useState<string | null>(null)
  const [holyCrabUpdateProgress, setHolyCrabUpdateProgress] = useState<UpdateProgress>({
    status: 'idle',
    downloadedBytes: 0,
  })
  const [holyCrabInstalling, setHolyCrabInstalling] = useState(false)
  const holyCrabUpdateRef = useRef<Update | null>(null)
  const didAutoCheckRef = useRef(false)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [controlPlaneUrl, setControlPlaneUrl] = useState('')
  const [gatewayUrl, setGatewayUrl] = useState('')
  const [rpcAddr, setRpcAddr] = useState('')
  const [rpcToken, setRpcToken] = useState('')
  const [clearRpcToken, setClearRpcToken] = useState(false)
  const [openclawHooksUrl, setOpenclawHooksUrl] = useState('')
  const [openclawHooksToken, setOpenclawHooksToken] = useState('')
  const [clearOpenclawToken, setClearOpenclawToken] = useState(false)
  const [openclawWsToken, setOpenclawWsToken] = useState('')
  const [clearOpenclawWsToken, setClearOpenclawWsToken] = useState(false)
  const [status, setStatus] = useState<SettingsSaveResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [security, setSecurity] = useState<SecurityCheckResult | null>(null)
  const [securityRunning, setSecurityRunning] = useState(false)
  const [fix, setFix] = useState<SecurityFixResult | null>(null)
  const [fixing, setFixing] = useState(false)

  const [, setMemorySyncStatus] = useState<MemorySyncStatus | null>(null)
  const [, setMemorySyncLoading] = useState(false)
  const [memorySyncRunning, setMemorySyncRunning] = useState(false)
  const [, setMemorySyncMessage] = useState<string | null>(null)

  const [memorySyncAction, setMemorySyncAction] = useState<'backup' | 'restore' | null>(null)
  const [memorySyncDialogError, setMemorySyncDialogError] = useState<string | null>(null)
  const [memorySyncShowPassphrase, setMemorySyncShowPassphrase] = useState(false)
  const passphraseInputRef = useRef<HTMLInputElement | null>(null)
  const [dictationSettings, setDictationSettings] = useState<DictationSettings>({
    ...DEFAULT_DICTATION_SETTINGS,
  })
  const [chatSettings, setChatSettings] = useState<ChatSettings>({
    ...DEFAULT_CHAT_SETTINGS,
  })
  const chatAvatarUploadInputRef = useRef<HTMLInputElement | null>(null)
  const [dictationModelState, setDictationModelState] = useState<DictationModelStatus | null>(null)
  const [dictationStatusLoading, setDictationStatusLoading] = useState(false)
  const [dictationStatusError, setDictationStatusError] = useState<string | null>(null)
  const [dictationAction, setDictationAction] = useState<DictationAction | null>(null)

  const setHolyCrabUpdateInstance = (next: Update | null) => {
    const prev = holyCrabUpdateRef.current
    if (prev && prev !== next) {
      void prev.close().catch(() => {})
    }
    holyCrabUpdateRef.current = next
    setHolyCrabUpdate(next)
  }

  const statusPill = (tone: 'ok' | 'risk' | 'unknown', text: string, fallbackKey?: string) => {
    const cls =
      tone === 'ok'
        ? 'text-emerald-600'
        : tone === 'risk'
          ? 'text-red-600'
          : 'text-amber-600'
    const icon = tone === 'ok' ? '✓' : tone === 'risk' ? '!' : '?'
    const displayText = fallbackKey ? t(fallbackKey) : text
    return (
      <span className={`inline-flex items-center gap-1 font-medium ${cls}`}>
        <span aria-hidden="true">{icon}</span>
        <span>{displayText}</span>
      </span>
    )
  }

  const bindingStatus = (s: SecurityCheckResult) => {
    switch (s.bindExposure) {
      case 'loopback_only':
        return statusPill('ok', '', 'settings.security.status.loopbackOnly')
      case 'all_interfaces':
        return statusPill('risk', '', 'settings.security.status.allInterfaces')
      case 'non_loopback':
        return statusPill('risk', '', 'settings.security.status.nonLoopback')
      case 'not_listening':
        return statusPill('unknown', '', 'settings.security.status.notListening')
      default:
        return statusPill('unknown', '', 'settings.security.status.unknown')
    }
  }
  const formatBytes = (bytes: number | undefined) => {
    if (!bytes || bytes <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024
      unit += 1
    }
    const precision = unit === 0 ? 0 : unit === 1 ? 0 : 1
    return `${value.toFixed(precision)} ${units[unit]}`
  }

  const selectedDictationModel = useMemo(() => {
    return (
      DICTATION_MODELS.find((model) => model.id === dictationSettings.dictationModelId) ??
      DICTATION_MODELS[1]
    )
  }, [dictationSettings.dictationModelId])

  const modifierLabels = useMemo(() => {
    const runtimePlatform = typeof navigator === 'undefined'
      ? ''
      : `${navigator.userAgent} ${navigator.platform}`.toLowerCase()
    const isMac = /(mac|iphone|ipad|ipod)/.test(runtimePlatform)
    const isWindows = /(win|windows)/.test(runtimePlatform)
    return {
      alt: isMac ? t('settings.dictation.holdKey.option') : t('settings.dictation.holdKey.alt'),
      meta: isMac
        ? t('settings.dictation.holdKey.command')
        : isWindows
          ? t('settings.dictation.holdKey.windows')
          : t('settings.dictation.holdKey.meta'),
    }
  }, [t])

  const refreshDictationModelState = useCallback(
    async (modelId?: string) => {
      const targetModelId = modelId ?? dictationSettings.dictationModelId
      setDictationStatusLoading(true)
      setDictationStatusError(null)
      try {
        const status = await dictationModelStatus(targetModelId)
        setDictationModelState(status)
        return status
      } catch (error) {
        setDictationStatusError(String(error))
        return null
      } finally {
        setDictationStatusLoading(false)
      }
    },
    [dictationSettings.dictationModelId],
  )

  const runDictationAction = useCallback(
    async (action: DictationAction) => {
      const targetModelId = dictationSettings.dictationModelId
      setDictationAction(action)
      setDictationStatusError(null)
      try {
        const status = action === 'download'
          ? await dictationDownloadModel(targetModelId)
          : action === 'cancel'
            ? await dictationCancelDownload(targetModelId)
            : await dictationRemoveModel(targetModelId)
        setDictationModelState(status)
        return status
      } catch (error) {
        setDictationStatusError(String(error))
        return null
      } finally {
        setDictationAction(null)
      }
    },
    [dictationSettings.dictationModelId],
  )

  const persistDictationSettings = useCallback(
    async (
      next: DictationSettings,
      options?: {
        refreshModelStatus?: boolean
      },
    ) => {
      setDictationSettings(next)
      if (!settings) {
        return
      }

      setDictationStatusError(null)
      try {
        await tauriInvoke<SettingsSaveResult>('save_settings', {
          update: {
            controlPlaneUrl: settings.controlPlaneUrl,
            gatewayUrl: settings.gatewayUrl,
            rpcAddr: settings.rpcAddr,
            openclawHooksUrl: settings.openclawHooksUrl,
            dictation: {
              enabled: next.dictationEnabled,
              model: next.dictationModelId,
              language: next.dictationPreferredLanguage ?? '',
              holdKey: next.dictationHoldKey,
            },
          },
        })
        const fresh = await tauriInvoke<SettingsView>('get_settings')
        setSettings(fresh)
        setDictationSettings(normalizeDictationSettings(fresh.dictation ?? {}))
        if (options?.refreshModelStatus !== false) {
          void refreshDictationModelState(fresh.dictation?.model || next.dictationModelId)
        }
      } catch (error) {
        setDictationStatusError(String(error))
      }
    },
    [refreshDictationModelState, settings],
  )

  const persistChatSettings = useCallback(
    async (next: ChatSettings) => {
      setChatSettings(next)
      if (!settings) {
        return
      }

      try {
        await tauriInvoke<SettingsSaveResult>('save_settings', {
          update: {
            chat: {
              displayMode: next.displayMode,
              copyMode: next.copyMode,
              botAvatar: next.botAvatar,
              avatarDataUrl: next.avatarDataUrl ?? '',
            },
          },
        })
        const fresh = await tauriInvoke<SettingsView>('get_settings')
        setSettings(fresh)
        setChatSettings(normalizeChatSettings(fresh.chat ?? {}))
      } catch (error) {
        console.error(error)
      }
    },
    [settings],
  )

  const onSelectChatAvatarUpload = useCallback(() => {
    chatAvatarUploadInputRef.current?.click()
  }, [])

  const onChatAvatarFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : ''
        if (!result) return
        void persistChatSettings({
          ...chatSettings,
          botAvatar: 'upload',
          avatarDataUrl: result,
        })
      }
      reader.readAsDataURL(file)
      event.target.value = ''
    },
    [chatSettings, persistChatSettings],
  )

  const onClearChatAvatarUpload = useCallback(() => {
    void persistChatSettings({
      ...chatSettings,
      avatarDataUrl: null,
      botAvatar: chatSettings.botAvatar === 'upload' ? 'default' : chatSettings.botAvatar,
    })
  }, [chatSettings, persistChatSettings])

  const toggleDictationEnabled = useCallback(() => {
    const nextEnabled = !dictationSettings.dictationEnabled
    const next = {
      ...dictationSettings,
      dictationEnabled: nextEnabled,
    }
    void persistDictationSettings(next, { refreshModelStatus: false })
    if (!nextEnabled && dictationModelState?.state === 'downloading') {
      void runDictationAction('cancel')
    }
    if (nextEnabled && dictationModelState?.state === 'missing') {
      void runDictationAction('download')
    }
  }, [
    dictationModelState?.state,
    dictationSettings,
    persistDictationSettings,
    runDictationAction,
  ])

  const checkHolyCrabUpdates = useCallback(
    async (opts?: { autoPrefetch?: boolean }) => {
      // Close/reset previous updater resources first so users can always "clear" a stuck download.
      // If `check()` fails (offline, mock server down), we still want the UI and memory to reset.
      setHolyCrabUpdateInstance(null)
      setHolyCrabUpdateChecking(true)
      setHolyCrabCheckedOnce(true)
      setHolyCrabUpdateError(null)
      setHolyCrabUpdateProgress({ status: 'idle', downloadedBytes: 0 })

      try {
        const update = await checkHolyCrabUpdate(locale)
        setHolyCrabUpdateInstance(update)

        if (!update) return

        if (opts?.autoPrefetch !== false) {
          await predownloadHolyCrabUpdate(update, (progress) => {
            setHolyCrabUpdateProgress(progress)
          })
        }
      } catch (error) {
        setHolyCrabUpdateInstance(null)
        setHolyCrabUpdateError(error instanceof Error ? error.message : String(error))
      } finally {
        setHolyCrabUpdateChecking(false)
      }
    },
    [locale],
  )

  const clearHolyCrabUpdateState = useCallback(() => {
    setHolyCrabUpdateError(null)
    setHolyCrabUpdateProgress({ status: 'idle', downloadedBytes: 0 })
    setHolyCrabUpdateInstance(null)
  }, [])

  const installHolyCrabUpdate = useCallback(async () => {
    if (!holyCrabUpdate) return
    setHolyCrabInstalling(true)
    setHolyCrabUpdateError(null)
    try {
      await installHolyCrabUpdateAndRelaunch(holyCrabUpdate)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('failed to unpack') && msg.includes('._')) {
        setHolyCrabUpdateError(
          [
            msg,
            '',
            t('settings.updates.appleDoubleHint'),
            t('settings.updates.appleDoubleAction'),
          ].join('\n'),
        )
      } else {
        setHolyCrabUpdateError(msg)
      }
      setHolyCrabInstalling(false)
    }
  }, [holyCrabUpdate, t])

  useEffect(() => {
    void getHolyCrabVersion()
      .then((v) => setHolyCrabVersion(v))
      .catch(() => {})
  }, [])

  useEffect(() => {
    return () => {
      const cur = holyCrabUpdateRef.current
      if (cur) void cur.close().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const hash = window.location.hash || ''
    const query = hash.includes('?') ? hash.split('?').slice(1).join('?') : ''
    if (!query) return

    const params = new URLSearchParams(query)
    const tab = params.get('tab')
    const autocheck = params.get('autocheck')

    if (tab === 'updates') {
      const node = document.getElementById('holycrab-updates')
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    } else if (tab === 'dictation') {
      const node = document.getElementById('dictation-settings')
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }

    if (autocheck === '1' && !didAutoCheckRef.current) {
      didAutoCheckRef.current = true
      void checkHolyCrabUpdates({ autoPrefetch: true })
    }
  }, [checkHolyCrabUpdates])

  useEffect(() => {
    tauriInvoke<SettingsView>('get_settings')
      .then((payload) => {
        setSettings(payload)
        setControlPlaneUrl(payload.controlPlaneUrl)
        setGatewayUrl(payload.gatewayUrl)
        setRpcAddr(payload.rpcAddr)
        setOpenclawHooksUrl(payload.openclawHooksUrl)
        setDictationSettings(normalizeDictationSettings(payload.dictation ?? {}))
        setChatSettings(normalizeChatSettings(payload.chat ?? {}))
      })
      .catch((err) => console.error(err))
  }, [])

  useEffect(() => {
    void refreshDictationModelState()
  }, [refreshDictationModelState])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    void listenDictationDownload((status) => {
      if (status.modelId !== dictationSettings.dictationModelId) return
      setDictationModelState(status)
      setDictationStatusError(null)
      setDictationStatusLoading(false)
    })
      .then((off) => {
        unlisten = off
      })
      .catch((error) => {
        setDictationStatusError(String(error))
      })

    return () => {
      if (unlisten) {
        void unlisten()
      }
    }
  }, [dictationSettings.dictationModelId])

  const refreshMemorySyncStatus = useCallback(async () => {
    setMemorySyncLoading(true)
    try {
      const status = await tauriInvoke<MemorySyncStatus>('get_memory_sync_status')
      setMemorySyncStatus(status)
    } catch (err) {
      console.error(err)
      setMemorySyncStatus(null)
      setMemorySyncMessage(`${t('settings.memory.error.statusFailedPrefix')} ${String(err)}`)
    } finally {
      setMemorySyncLoading(false)
    }
  }, [t])

  useEffect(() => {
    void refreshMemorySyncStatus()
  }, [refreshMemorySyncStatus])

  useEffect(() => {
    if (!memorySyncAction) return
    setMemorySyncDialogError(null)
    setMemorySyncShowPassphrase(false)
    queueMicrotask(() => {
      if (passphraseInputRef.current) {
        passphraseInputRef.current.value = ''
        passphraseInputRef.current.focus()
      }
    })
  }, [memorySyncAction])

  const closeMemorySyncDialog = () => {
    setMemorySyncDialogError(null)
    setMemorySyncAction(null)
    setMemorySyncShowPassphrase(false)
    if (passphraseInputRef.current) {
      passphraseInputRef.current.value = ''
    }
  }
  const invokeMemoryBackupNow = async (passphrase: string) => {
    try {
      return await tauriInvoke('memory_backup_now', { passphrase })
    } catch (err) {
      // Back-compat for command signatures that haven't been updated to accept `passphrase` yet.
      const msg = String(err)
      if (msg.includes('unknown field') || msg.includes('unexpected') || msg.includes('invalid args')) {
        return await tauriInvoke('memory_backup_now')
      }
      throw err
    }
  }

  const invokeMemoryRestoreLatest = async (passphrase: string) => {
    try {
      return await tauriInvoke('memory_restore_latest', { passphrase })
    } catch (err) {
      // Back-compat for command signatures that haven't been updated to accept `passphrase` yet.
      const msg = String(err)
      if (msg.includes('unknown field') || msg.includes('unexpected') || msg.includes('invalid args')) {
        return await tauriInvoke('memory_restore_latest')
      }
      throw err
    }
  }

  const runMemorySyncAction = async () => {
    if (!memorySyncAction) return

    const passphrase = passphraseInputRef.current?.value ?? ''
    if (!passphrase.trim()) {
      setMemorySyncDialogError(t('settings.memory.error.passphraseRequired'))
      passphraseInputRef.current?.focus()
      return
    }

    setMemorySyncRunning(true)
    setMemorySyncDialogError(null)
    try {
      if (memorySyncAction === 'backup') {
        await invokeMemoryBackupNow(passphrase)
        setMemorySyncMessage(t('settings.memory.message.backupCompleted'))
      } else {
        await invokeMemoryRestoreLatest(passphrase)
        setMemorySyncMessage(t('settings.memory.message.restoreCompleted'))
      }
      closeMemorySyncDialog()
      await refreshMemorySyncStatus()
    } catch (err) {
      console.error(err)
      setMemorySyncDialogError(String(err))
    } finally {
      if (passphraseInputRef.current) {
        passphraseInputRef.current.value = ''
      }
      setMemorySyncRunning(false)
    }
  }

  const runSecurityCheck = async () => {
    setSecurityRunning(true)
    try {
      const result = await tauriInvoke<SecurityCheckResult>('run_security_check')
      setSecurity(result)
      setFix(null)
    } catch (err) {
      console.error(err)
      setSecurity(null)
    } finally {
      setSecurityRunning(false)
    }
  }

  const applyFix = async () => {
    setFixing(true)
    setFix(null)
    try {
      const result = await tauriInvoke<SecurityFixResult>('apply_security_fix')
      setFix(result)
      await runSecurityCheck()
    } catch (err) {
      console.error(err)
      setFix({
        ok: false,
        changed: false,
        restarted: false,
        advice: [],
        error: String(err),
      })
    } finally {
      setFixing(false)
    }
  }

  const dirty = useMemo(() => {
    if (!settings) return false
    return (
      settings.controlPlaneUrl !== controlPlaneUrl.trim() ||
      settings.gatewayUrl !== gatewayUrl.trim() ||
      settings.rpcAddr !== rpcAddr.trim() ||
      clearRpcToken ||
      rpcToken.trim().length > 0 ||
      settings.openclawHooksUrl !== openclawHooksUrl.trim() ||
      clearOpenclawToken ||
      openclawHooksToken.trim().length > 0
      || clearOpenclawWsToken
      || openclawWsToken.trim().length > 0
      || settings.chat.displayMode !== chatSettings.displayMode
      || settings.chat.copyMode !== chatSettings.copyMode
      || settings.chat.botAvatar !== chatSettings.botAvatar
      || (settings.chat.avatarDataUrl || '') !== (chatSettings.avatarDataUrl || '')
    )
  }, [
    settings,
    controlPlaneUrl,
    gatewayUrl,
    rpcAddr,
    rpcToken,
    clearRpcToken,
    openclawHooksUrl,
    openclawHooksToken,
    clearOpenclawToken,
    openclawWsToken,
    clearOpenclawWsToken,
    chatSettings.displayMode,
    chatSettings.copyMode,
    chatSettings.botAvatar,
    chatSettings.avatarDataUrl,
  ])

  const onSave = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const rpcTokenUpdate: string | undefined = clearRpcToken
        ? ''
        : rpcToken.trim().length > 0
          ? rpcToken.trim()
          : undefined
      const openclawHooksTokenUpdate: string | undefined = clearOpenclawToken
        ? ''
        : openclawHooksToken.trim().length > 0
          ? openclawHooksToken.trim()
          : undefined
      const openclawWsTokenUpdate: string | undefined = clearOpenclawWsToken
        ? ''
        : openclawWsToken.trim().length > 0
          ? openclawWsToken.trim()
          : undefined
      const update: Record<string, unknown> = {
        controlPlaneUrl,
        gatewayUrl,
        rpcAddr,
        openclawHooksUrl,
        chat: {
          displayMode: chatSettings.displayMode,
          copyMode: chatSettings.copyMode,
          botAvatar: chatSettings.botAvatar,
          avatarDataUrl: chatSettings.avatarDataUrl ?? '',
        },
      }
      if (rpcTokenUpdate !== undefined) {
        update.rpcToken = rpcTokenUpdate
      }
      if (openclawHooksTokenUpdate !== undefined) {
        update.openclawHooksToken = openclawHooksTokenUpdate
      }
      if (openclawWsTokenUpdate !== undefined) {
        update.openclawWsToken = openclawWsTokenUpdate
      }
      const result = await tauriInvoke<SettingsSaveResult>('save_settings', {
        update,
      })
      setStatus(result)
      const fresh = await tauriInvoke<SettingsView>('get_settings')
      setSettings(fresh)
      setControlPlaneUrl(fresh.controlPlaneUrl)
      setGatewayUrl(fresh.gatewayUrl)
      setRpcAddr(fresh.rpcAddr)
      setRpcToken('')
      setClearRpcToken(false)
      setOpenclawHooksUrl(fresh.openclawHooksUrl)
      setOpenclawHooksToken('')
      setClearOpenclawToken(false)
      setOpenclawWsToken('')
      setClearOpenclawWsToken(false)
      setDictationSettings(normalizeDictationSettings(fresh.dictation ?? {}))
      setChatSettings(normalizeChatSettings(fresh.chat ?? {}))
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const dictationProgress = dictationModelState?.progress ?? null
  const dictationProgressPercent = dictationProgress?.totalBytes
    ? Math.min(100, (dictationProgress.downloadedBytes / dictationProgress.totalBytes) * 100)
    : 0
  const dictationReady = dictationModelState?.state === 'ready'
  const dictationCanDownload = dictationModelState?.state === 'missing' || dictationModelState?.state === 'error'
  const dictationShowStatus = dictationStatusLoading || dictationModelState !== null || dictationStatusError !== null
  const dictationStatusText = dictationModelState
    ? dictationModelState.state === 'ready'
      ? t('settings.dictation.status.ready')
      : dictationModelState.state === 'missing'
        ? t('settings.dictation.status.missing')
        : dictationModelState.state === 'downloading'
          ? t('settings.dictation.status.downloading')
          : dictationModelState.error || t('settings.dictation.status.errorFallback')
    : dictationStatusLoading
      ? t('settings.dictation.status.loading')
      : t('settings.dictation.status.unavailable')

  return (
    <div className="grid gap-6">
      <Dialog
        open={memorySyncAction !== null}
        onOpenChange={(open) => {
          if (!open) closeMemorySyncDialog()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {memorySyncAction === 'backup'
                ? t('settings.memory.dialog.backupTitle')
                : memorySyncAction === 'restore'
                  ? t('settings.memory.dialog.restoreTitle')
                  : t('settings.memory.title')}
            </DialogTitle>
            <DialogDescription>
              {t('settings.memory.dialog.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm font-medium">{t('settings.memory.passphrase.label')}</div>
            <div className="flex items-center gap-2">
              <Input
                ref={passphraseInputRef}
                type={memorySyncShowPassphrase ? 'text' : 'password'}
                placeholder={t('settings.memory.passphrase.placeholder')}
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !memorySyncRunning) {
                    e.preventDefault()
                    void runMemorySyncAction()
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setMemorySyncShowPassphrase((previous) => !previous)}
              >
                {memorySyncShowPassphrase
                  ? t('settings.memory.passphrase.hide')
                  : t('settings.memory.passphrase.show')}
              </Button>
            </div>
            {memorySyncDialogError ? (
              <div className="text-sm text-red-600">{memorySyncDialogError}</div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeMemorySyncDialog} disabled={memorySyncRunning}>
              {t('settings.memory.dialog.cancel')}
            </Button>
            <Button onClick={() => void runMemorySyncAction()} disabled={memorySyncRunning}>
              {memorySyncRunning
                ? t('settings.memory.dialog.working')
                : t('settings.memory.dialog.continue')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rounded-3xl bg-surface-elevated px-6 py-5">
        <section id="holycrab-updates" className="space-y-3 pb-6">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">{t('settings.updates.title')}</h2>
            <div className="text-sm text-muted-foreground">{t('settings.updates.description')}</div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <div>
              {t('settings.updates.currentVersion')}:{' '}
              <span className="font-mono">{holyCrabVersion}</span>
            </div>
            {holyCrabUpdate ? (
              <div>
                {t('settings.updates.availableVersion')}:{' '}
                <span className="font-mono">{holyCrabUpdate.version}</span>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => void checkHolyCrabUpdates({ autoPrefetch: true })}
              disabled={holyCrabUpdateChecking || holyCrabInstalling}
            >
              {holyCrabUpdateChecking
                ? t('settings.updates.checking')
                : t('settings.updates.check')}
            </Button>

            {holyCrabUpdate && holyCrabUpdateProgress.status === 'downloaded' ? (
              <Button onClick={() => void installHolyCrabUpdate()} disabled={holyCrabInstalling}>
                {holyCrabInstalling
                  ? t('settings.updates.installing')
                  : t('settings.updates.installRestart')}
              </Button>
            ) : null}

            <Button
              variant="outline"
              onClick={clearHolyCrabUpdateState}
              disabled={holyCrabUpdateChecking || holyCrabInstalling}
            >
              {t('settings.updates.clear')}
            </Button>
          </div>

          {holyCrabUpdate ? (
            <div className="space-y-1 rounded-xl bg-background/25 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <div>
                  {t('settings.updates.status')}:{' '}
                  <span className="font-mono">
                    {holyCrabUpdateProgress.status === 'downloading'
                      ? t('settings.updates.status.downloading')
                      : holyCrabUpdateProgress.status === 'downloaded'
                        ? t('settings.updates.status.downloaded')
                        : t('settings.updates.status.available')}
                  </span>
                </div>
                <div>
                  {t('settings.updates.downloaded')}:{' '}
                  <span className="font-mono">
                    {formatBytes(holyCrabUpdateProgress.downloadedBytes)}
                    {holyCrabUpdateProgress.totalBytes
                      ? ` / ${formatBytes(holyCrabUpdateProgress.totalBytes)}`
                      : ''}
                  </span>
                </div>
              </div>

              {holyCrabUpdate.body ? (
                <>
                  <Separator className="bg-border/60" />
                  <div className="whitespace-pre-wrap text-xs text-muted-foreground">
                    {holyCrabUpdate.body}
                  </div>
                </>
              ) : null}
            </div>
          ) : holyCrabCheckedOnce && !holyCrabUpdateChecking && !holyCrabUpdateError ? (
            <div className="text-sm text-muted-foreground">{t('settings.updates.noUpdates')}</div>
          ) : null}

          {holyCrabUpdateError ? (
            <div className="text-sm text-red-600">
              {t('settings.updates.error')}: {holyCrabUpdateError}
            </div>
          ) : null}
        </section>

        <Separator className="bg-border/60" />

        <section className="space-y-3 py-6">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">{t('settings.language.title')}</h2>
            <div className="text-sm text-muted-foreground">{t('settings.language.description')}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('settings.language.current')}:</span>
            <Button
              size="sm"
              variant={locale === 'en' ? 'default' : 'outline'}
              onClick={() => setLocale('en')}
            >
              {t('settings.language.english')}
            </Button>
            <Button
              size="sm"
              variant={locale === 'zh' ? 'default' : 'outline'}
              onClick={() => setLocale('zh')}
            >
              {t('settings.language.chinese')}
            </Button>
          </div>
        </section>

        <Separator className="bg-border/60" />

        <section id="dictation-settings" className="space-y-4 py-6">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">{t('settings.dictation.title')}</h2>
            <div className="text-sm text-muted-foreground">{t('settings.dictation.description')}</div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-background/25 p-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">{t('settings.dictation.enable.title')}</div>
              <div className="text-xs text-muted-foreground">{t('settings.dictation.enable.description')}</div>
            </div>
            <button
              type="button"
              onClick={toggleDictationEnabled}
              aria-pressed={dictationSettings.dictationEnabled}
              className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-colors ${
                dictationSettings.dictationEnabled
                  ? 'border-primary/80 bg-primary'
                  : 'border-border/80 bg-zinc-500/45'
              }`}
            >
              <span
                className={`inline-block size-5 rounded-full bg-white shadow-sm ring-1 ring-black/10 dark:ring-white/15 transition-transform ${
                  dictationSettings.dictationEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="dictation-model">
                {t('settings.dictation.model.label')}
              </label>
              <select
                id="dictation-model"
                className="h-9 w-full rounded-lg border border-border/35 bg-background/40 px-3 text-sm text-foreground outline-none"
                value={dictationSettings.dictationModelId}
                onChange={(event) => {
                  setDictationModelState(null)
                  setDictationStatusError(null)
                  void persistDictationSettings({
                    ...dictationSettings,
                    dictationModelId: event.target.value,
                  })
                }}
              >
                {DICTATION_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} ({model.size})
                  </option>
                ))}
              </select>
              <div className="text-xs text-muted-foreground">
                {t(selectedDictationModel.noteKey)} {t('settings.dictation.model.downloadSize')}:{' '}
                {selectedDictationModel.size}.
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="dictation-language">
                {t('settings.dictation.language.label')}
              </label>
              <select
                id="dictation-language"
                className="h-9 w-full rounded-lg border border-border/35 bg-background/40 px-3 text-sm text-foreground outline-none"
                value={dictationSettings.dictationPreferredLanguage ?? ''}
                onChange={(event) => {
                  void persistDictationSettings({
                    ...dictationSettings,
                    dictationPreferredLanguage: event.target.value || null,
                  }, { refreshModelStatus: false })
                }}
              >
                {DICTATION_LANGUAGES.map((language) => (
                  <option key={language.labelKey} value={language.value}>
                    {t(language.labelKey)}
                  </option>
                ))}
              </select>
              <div className="text-xs text-muted-foreground">{t('settings.dictation.language.help')}</div>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium" htmlFor="dictation-hold-key">
                {t('settings.dictation.holdKey.label')}
              </label>
              <select
                id="dictation-hold-key"
                className="h-9 w-full rounded-lg border border-border/35 bg-background/40 px-3 text-sm text-foreground outline-none md:max-w-[420px]"
                value={dictationSettings.dictationHoldKey}
                onChange={(event) => {
                  void persistDictationSettings({
                    ...dictationSettings,
                    dictationHoldKey: (event.target.value || 'off') as DictationHoldKey,
                  }, { refreshModelStatus: false })
                }}
              >
                <option value="off">{t('settings.dictation.holdKey.off')}</option>
                <option value="alt">{modifierLabels.alt}</option>
                <option value="shift">{t('settings.dictation.holdKey.shift')}</option>
                <option value="control">{t('settings.dictation.holdKey.control')}</option>
                <option value="meta">{modifierLabels.meta}</option>
              </select>
              <div className="text-xs text-muted-foreground">{t('settings.dictation.holdKey.help')}</div>
            </div>
          </div>

          {dictationShowStatus ? (
            <div className="space-y-2 rounded-xl bg-background/25 p-3">
              <div className="text-sm font-medium">
                {t('settings.dictation.status.title')} ({selectedDictationModel.label})
              </div>
              <div className="text-xs text-muted-foreground">{dictationStatusText}</div>
              {dictationProgress ? (
                <div className="space-y-1">
                  <div className="h-2 overflow-hidden rounded bg-border/40">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${dictationProgressPercent}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatBytes(dictationProgress.downloadedBytes)}
                    {dictationProgress.totalBytes ? ` / ${formatBytes(dictationProgress.totalBytes)}` : ''}
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {dictationCanDownload ? (
                  <Button
                    size="sm"
                    onClick={() => void runDictationAction('download')}
                    disabled={dictationAction !== null}
                  >
                    {dictationAction === 'download'
                      ? t('settings.dictation.actions.downloading')
                      : t('settings.dictation.actions.download')}
                  </Button>
                ) : null}
                {dictationModelState?.state === 'downloading' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void runDictationAction('cancel')}
                    disabled={dictationAction !== null}
                  >
                    {dictationAction === 'cancel'
                      ? t('settings.dictation.actions.canceling')
                      : t('settings.dictation.actions.cancel')}
                  </Button>
                ) : null}
                {dictationReady ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void runDictationAction('remove')}
                    disabled={dictationAction !== null}
                  >
                    {dictationAction === 'remove'
                      ? t('settings.dictation.actions.removing')
                      : t('settings.dictation.actions.remove')}
                  </Button>
                ) : null}
              </div>
              {dictationStatusError ? (
                <div className="text-xs text-red-600">
                  {t('settings.dictation.status.requestError')}: {dictationStatusError}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <Separator className="bg-border/60" />

        <section className="space-y-4 py-6">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">{t('settings.chat.title')}</h2>
            <div className="text-sm text-muted-foreground">{t('settings.chat.description')}</div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="chat-display-mode">
                {t('settings.chat.display.label')}
              </label>
              <select
                id="chat-display-mode"
                className="h-9 w-full rounded-lg border border-border/35 bg-background/40 px-3 text-sm text-foreground outline-none"
                value={chatSettings.displayMode}
                onChange={(event) => {
                  void persistChatSettings({
                    ...chatSettings,
                    displayMode: (event.target.value || 'full') as ChatDisplayMode,
                  })
                }}
              >
                <option value="collapsed">{t('settings.chat.display.option.collapsed')}</option>
                <option value="content_only">{t('settings.chat.display.option.contentOnly')}</option>
                <option value="full">{t('settings.chat.display.option.full')}</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="chat-copy-mode">
                {t('settings.chat.copy.label')}
              </label>
              <select
                id="chat-copy-mode"
                className="h-9 w-full rounded-lg border border-border/35 bg-background/40 px-3 text-sm text-foreground outline-none"
                value={chatSettings.copyMode}
                onChange={(event) => {
                  void persistChatSettings({
                    ...chatSettings,
                    copyMode: (event.target.value || 'markdown') as ChatCopyMode,
                  })
                }}
              >
                <option value="markdown">{t('settings.chat.copy.option.markdown')}</option>
                <option value="full">{t('settings.chat.copy.option.full')}</option>
                <option value="text">{t('settings.chat.copy.option.text')}</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="chat-bot-avatar">
                {t('settings.chat.avatar.label')}
              </label>
              <select
                id="chat-bot-avatar"
                className="h-9 w-full rounded-lg border border-border/35 bg-background/40 px-3 text-sm text-foreground outline-none"
                value={chatSettings.botAvatar}
                onChange={(event) => {
                  void persistChatSettings({
                    ...chatSettings,
                    botAvatar: (event.target.value || 'default') as ChatBotAvatar,
                  })
                }}
              >
                <option value="default">{t('settings.chat.avatar.option.default')}</option>
                <option value="holycrab">{t('settings.chat.avatar.option.holycrab')}</option>
                <option value="upload">{t('settings.chat.avatar.option.upload')}</option>
              </select>
              <input
                ref={chatAvatarUploadInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onChatAvatarFileChange}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={onSelectChatAvatarUpload}>
                  {t('settings.chat.avatar.upload.button')}
                </Button>
                {chatSettings.avatarDataUrl ? (
                  <Button size="sm" variant="outline" onClick={onClearChatAvatarUpload}>
                    {t('settings.chat.avatar.upload.clear')}
                  </Button>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground">
                {chatSettings.avatarDataUrl
                  ? t('settings.chat.avatar.upload.ready')
                  : t('settings.chat.avatar.upload.hint')}
              </div>
              {chatSettings.avatarDataUrl ? (
                <img
                  src={chatSettings.avatarDataUrl}
                  alt="chat-bot-avatar-preview"
                  className="size-10 rounded-md border border-border/40 object-cover"
                />
              ) : null}
            </div>
          </div>
        </section>

        <Separator className="bg-border/60" />

        <section className="space-y-3 py-6">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">
              {t('settings.memory.title')} {t('settings.memory.comingSoonSuffix')}
            </h2>
            <div className="text-sm text-muted-foreground">{t('settings.memory.description')}</div>
          </div>
          <div className="text-sm text-muted-foreground">{t('settings.comingSoon')}</div>
        </section>

        <Separator className="bg-border/60" />

        <section className="space-y-3 py-6">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">{t('settings.security.title')}</h2>
            <div className="text-sm text-muted-foreground">
              {t('settings.security.description')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={runSecurityCheck} disabled={securityRunning}>
              {securityRunning ? t('settings.security.button.running') : t('settings.security.button.run')}
            </Button>
            {security && (
              <div className="text-xs text-muted-foreground">
                {t('settings.security.label.detection')}: <span className="font-mono">{security.evidenceSource}</span>
              </div>
            )}
          </div>
          {security && (
            <div className="space-y-2 rounded-xl bg-background/25 p-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <div>
                  {t('settings.security.label.port')}: <span className="font-mono">{security.port}</span>
                </div>
                <div>
                  {t('settings.security.label.listener')}:{' '}
                  {security.isListening ? statusPill('ok', t('settings.security.label.listening')) : statusPill('unknown', t('settings.security.label.notListening'))}
                </div>
                <div>
                  {t('settings.security.label.binding')}:{' '}
                  {bindingStatus(security)}
                </div>
              </div>

              {(security.bindExposure === 'all_interfaces' || security.bindExposure === 'non_loopback') && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    variant="destructive"
                    onClick={applyFix}
                    disabled={fixing || securityRunning}
                  >
                    {fixing ? t('settings.security.button.fixing') : t('settings.security.button.fix')}
                  </Button>
                  <div className="text-xs text-muted-foreground">
                    {t('settings.security.fix.setDescription').replace('gateway.bind=loopback', '<span className="font-mono">gateway.bind=loopback</span>')}
                  </div>
                </div>
              )}

              {security.openclawHooksUrl && (
                <div className="text-xs text-muted-foreground">
                  {t('settings.security.label.openclawHooksUrl')}: <span className="font-mono">{security.openclawHooksUrl}</span>
                </div>
              )}

              {security.listeningAddresses.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  {t('settings.security.label.listeningAddresses')}:{' '}
                  <span className="font-mono">{security.listeningAddresses.join(', ')}</span>
                </div>
              )}

              {security.advice.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  {security.advice.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}

              {fix && (
                <div className="space-y-1 pt-2 text-xs">
                  <div className={fix.ok ? 'text-foreground' : 'text-red-600'}>
                    {t('settings.security.label.fix')}: {fix.ok ? statusPill('ok', t('settings.security.status.succeeded')) : statusPill('risk', t('settings.security.status.failed'))}
                    {fix.changed ? ` ${t('settings.security.fixResult.configUpdated')}` : ` ${t('settings.security.fixResult.noConfigChange')}`}
                    {fix.restarted ? t('settings.security.fixResult.restarted') : t('settings.security.fixResult.notRestarted')}
                  </div>
                  {fix.configPath && (
                    <div className="text-muted-foreground">
                      {t('settings.security.label.config')}: <span className="font-mono">{fix.configPath}</span>
                    </div>
                  )}
                  {fix.error && <div className="text-red-600">{fix.error}</div>}
                  {fix.advice?.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                      {fix.advice.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

      {showDaemonSettings ? (
        <>
          <Separator className="bg-border/60" />
          <section className="space-y-4 pt-6">
            <div className="space-y-1">
              <h2 className="text-2xl font-semibold tracking-tight">{t('settings.daemon.title')}</h2>
            </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">{t('settings.daemon.controlPlaneUrl')}</div>
            <Input value={controlPlaneUrl} onChange={(e) => setControlPlaneUrl(e.target.value)} />
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">{t('settings.daemon.gatewayUrl')}</div>
            <Input value={gatewayUrl} onChange={(e) => setGatewayUrl(e.target.value)} />
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">{t('settings.daemon.rpcAddress')}</div>
            <Input
              value={rpcAddr}
              onChange={(e) => setRpcAddr(e.target.value)}
              placeholder={t('settings.daemon.rpcAddressPlaceholder')}
            />
            <div className="text-xs text-muted-foreground">
              {t('settings.daemon.rpcAddressHint')}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">{t('settings.daemon.rpcToken')}</div>
            <Input
              value={rpcToken}
              onChange={(e) => setRpcToken(e.target.value)}
              placeholder={settings?.rpcTokenSet ? t('settings.daemon.tokenPlaceholderSet') : t('settings.daemon.tokenPlaceholderPaste')}
              type="password"
              autoComplete="off"
            />
            <label className="flex select-none items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={clearRpcToken}
                onChange={(e) => setClearRpcToken(e.target.checked)}
                disabled={!settings?.rpcTokenSet || saving}
              />
              {t('settings.daemon.clearSavedToken')}
            </label>
          </div>
          <Separator />
          <div className="space-y-2">
            <div className="text-sm font-medium">{t('settings.daemon.openclawHooksUrl')}</div>
            <Input
              value={openclawHooksUrl}
              onChange={(e) => setOpenclawHooksUrl(e.target.value)}
              placeholder={t('settings.daemon.openclawHooksUrlPlaceholder')}
            />
            <div className="text-xs text-muted-foreground">
              {t('settings.daemon.openclawHooksUrlHint')}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">{t('settings.daemon.openclawHooksToken')}</div>
            <Input
              value={openclawHooksToken}
              onChange={(e) => setOpenclawHooksToken(e.target.value)}
              placeholder={settings?.openclawTokenSet ? t('settings.daemon.tokenPlaceholderSet') : t('settings.daemon.tokenPlaceholderPaste')}
              type="password"
              autoComplete="off"
            />
            <label className="flex select-none items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={clearOpenclawToken}
                onChange={(e) => setClearOpenclawToken(e.target.checked)}
                disabled={!settings?.openclawTokenSaved || saving}
              />
              {t('settings.daemon.clearSavedToken')}
            </label>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">{t('settings.daemon.openclawWsToken')}</div>
            <Input
              value={openclawWsToken}
              onChange={(e) => setOpenclawWsToken(e.target.value)}
              placeholder={settings?.openclawWsTokenSet ? t('settings.daemon.tokenPlaceholderSet') : t('settings.daemon.tokenPlaceholderPaste')}
              type="password"
              autoComplete="off"
            />
            <div className="text-xs text-muted-foreground">
              {t('settings.daemon.wsTokenHint')}
            </div>
            <label className="flex select-none items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={clearOpenclawWsToken}
                onChange={(e) => setClearOpenclawWsToken(e.target.checked)}
                disabled={!settings?.openclawWsTokenSaved || saving}
              />
              {t('settings.daemon.clearSavedToken')}
            </label>
          </div>
          <Button disabled={!dirty || saving} onClick={onSave}>
            {saving ? t('settings.daemon.saving') : t('settings.daemon.save')}
          </Button>
          {status ? (
            <div className="text-sm text-muted-foreground">
              {status.changed ? t('settings.daemon.status.applied') : t('settings.daemon.status.noChanges')}
              {status.pairingCleared ? ` ${t('settings.daemon.status.pairingReset')}` : ''}
              {status.restartRequired ? ` ${t('settings.daemon.status.restartRequired')}` : ''}
            </div>
          ) : null}
          </section>
        </>
      ) : null}
      {showDaemonStatus ? (
        <>
          <Separator className="bg-border/60" />
          <section className="space-y-2 pt-6 text-sm">
            <div className="space-y-1">
              <h2 className="text-2xl font-semibold tracking-tight">{t('settings.status.title')}</h2>
            </div>
          <div>{t('settings.status.deviceId')}: {settings?.deviceId ?? '-'}</div>
          <div>{t('settings.status.authenticated')}: {settings?.authed ? t('settings.status.yes') : t('settings.status.no')}</div>
          <div>{t('settings.status.daemonRpcToken')}: {settings?.rpcTokenSet ? t('settings.status.set') : t('settings.status.unset')}</div>
          <div>{t('settings.status.openclawUrl')}: {settings?.openclawHooksUrl || '-'}</div>
          <div>{t('settings.status.openclawHooksToken')}: {settings?.openclawTokenSet ? t('settings.status.set') : t('settings.status.unset')}</div>
          <div>{t('settings.status.openclawWsToken')}: {settings?.openclawWsTokenSet ? t('settings.status.set') : t('settings.status.unset')}</div>
          <Separator />
          <div>{t('settings.status.tenantUrl')}: {settings?.tenantBaseUrl ?? '-'}</div>
          </section>
        </>
      ) : null}
      </div>
    </div>
  )
}
