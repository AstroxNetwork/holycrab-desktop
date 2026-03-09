import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
} from 'react'
import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { Button } from '@ui/components/button'

import { ChatHeader } from '@/components/chat/chat-header'
import { AnnouncementContentRenderer } from '@/components/announcements/announcement-content-renderer'
import { Messages } from '@/components/chat/messages'
import { MultimodalInput } from '@/components/chat/multimodal-input'
import { SuggestedActions } from '@/components/chat/suggested-actions'
import type { ChatAttachment, ChatSuggestion, NormalizedMessage } from '@/components/chat/types'
import {
  abortChatRun,
  ensureChatRuntimeStarted,
  isChatStopCommand,
  markChatSessionAsRead,
  refreshChatRuntime,
  sendChatMessage,
  setActiveChatSessionKey,
} from '@/lib/chat-runtime'
import {
  dictationCancel,
  dictationDownloadModel,
  dictationModelStatus,
  dictationStart,
  dictationStop,
  listenDictationEvents,
  type DictationSessionState,
} from '@/lib/dictation'
import { computeDictationInsertion } from '@/lib/dictation-input'
import {
  fetchAnnouncementsFeed,
  markAnnouncementRead,
  loadReadAnnouncementIds,
  type AnnouncementItem,
} from '@/lib/announcements'
import { buildQuickMarketInsightPrompt } from '@/lib/chat-suggestion-prompts'
import { externalLinks } from '@/lib/external-links'
import { useLocale } from '@/lib/locale-context'
import {
  checkOpenClawReadiness,
  openExternalUrl,
} from '@/lib/openclaw-handoff'
import {
  getOpenClawAgentsOverview,
  getOpenClawAgentSessions,
  saveOpenClawAgentPrimaryModel,
  type OpenClawAgentSessionItem,
  type OpenClawAgentsOverviewSnapshot,
} from '@/lib/openclaw-config'
import { subscribeProviderProfilesChanged } from '@/lib/provider-profile-events'
import { openSettingsWindow } from '@/lib/settings-window'
import { listenSetupStateChanged } from '@/lib/setup-events'
import { openSetupWizardWindow } from '@/lib/setup-wizard-window'
import { tauriInvoke } from '@/lib/tauri'
import { useChatStore } from '@/stores/chat-store'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@ui/components/dialog'

export const Route = createFileRoute('/chat')({
  component: ChatPage,
})

function nextId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

type DictationHoldKey = 'off' | 'alt' | 'shift' | 'control' | 'meta'

type DictationConfig = {
  enabled: boolean
  model: string
  language: string | null
  holdKey: DictationHoldKey
}

type ChatDisplayMode = 'collapsed' | 'content_only' | 'full'
type ChatCopyMode = 'markdown' | 'full' | 'text'
type ChatBotAvatarMode = 'default' | 'holycrab' | 'upload'

type ChatSettingsConfig = {
  displayMode: ChatDisplayMode
  copyMode: ChatCopyMode
  botAvatar: ChatBotAvatarMode
  avatarDataUrl: string | null
}

interface SettingsView {
  controlPlaneUrl: string
  gatewayUrl: string
  rpcAddr: string
  openclawHooksUrl: string
  dictation: {
    enabled: boolean
    model: string
    language?: string | null
    holdKey: string
  }
  chat?: {
    displayMode?: string
    copyMode?: string
    botAvatar?: string
    avatarDataUrl?: string | null
  }
}

const DEFAULT_DICTATION_CONFIG: DictationConfig = {
  enabled: false,
  model: 'base',
  language: null,
  holdKey: 'alt',
}

const DEFAULT_CHAT_SETTINGS_CONFIG: ChatSettingsConfig = {
  displayMode: 'full',
  copyMode: 'markdown',
  botAvatar: 'default',
  avatarDataUrl: null,
}

let cachedAgentsOverviewSnapshot: OpenClawAgentsOverviewSnapshot | null = null
let cachedSelectedAgentId: string | null = null
let cachedAgentModelDraft = ''
const ANNOUNCEMENTS_PAGE_SIZE = 6

function formatAnnouncementDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function readSearchParam(search: unknown, key: string): string {
  if (!search || !key) return ''
  if (typeof search === 'string') {
    const normalized = search.startsWith('?') ? search.slice(1) : search
    return new URLSearchParams(normalized).get(key)?.trim() ?? ''
  }
  if (typeof search === 'object') {
    const raw = (search as Record<string, unknown>)[key]
    if (typeof raw === 'string') return raw.trim()
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'string' && item.trim()) return item.trim()
      }
    }
  }
  return ''
}

function isMainSessionAlias(raw: string): boolean {
  const normalized = raw.trim().toLowerCase()
  if (!normalized) return true
  return normalized === 'main' || normalized === 'agent:main:main'
}

function extractScopeFromSessionKey(key: string): string {
  const parts = key.split(':').map((value) => value.trim()).filter(Boolean)
  if (parts.length >= 3 && parts[0] === 'agent') {
    return parts[2] || ''
  }
  return ''
}

function normalizeScopeLabel(raw: string): string {
  const normalized = raw.trim()
  if (!normalized) return 'Main'
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
}

function matchesHoldKey(event: KeyboardEvent, holdKey: DictationHoldKey) {
  if (holdKey === 'off') return false
  switch (holdKey) {
    case 'alt':
      return event.key === 'Alt'
    case 'shift':
      return event.key === 'Shift'
    case 'control':
      return event.key === 'Control'
    case 'meta':
      return event.key === 'Meta'
    default:
      return false
  }
}

function normalizeDictationConfig(payload: SettingsView | null): DictationConfig {
  const source = payload?.dictation
  if (!source) return { ...DEFAULT_DICTATION_CONFIG }
  const normalizedModel = typeof source.model === 'string' && source.model.trim()
    ? source.model.trim()
    : DEFAULT_DICTATION_CONFIG.model
  const normalizedLanguage = typeof source.language === 'string' && source.language.trim()
    ? source.language.trim().toLowerCase()
    : null
  const holdKeyRaw = typeof source.holdKey === 'string' ? source.holdKey.trim().toLowerCase() : ''
  const normalizedHoldKey: DictationHoldKey =
    holdKeyRaw === 'off'
    || holdKeyRaw === 'alt'
    || holdKeyRaw === 'shift'
    || holdKeyRaw === 'control'
    || holdKeyRaw === 'meta'
      ? holdKeyRaw
      : DEFAULT_DICTATION_CONFIG.holdKey

  return {
    enabled: Boolean(source.enabled),
    model: normalizedModel,
    language: normalizedLanguage,
    holdKey: normalizedHoldKey,
  }
}

function normalizeChatSettings(payload: SettingsView | null): ChatSettingsConfig {
  const source = payload?.chat
  if (!source) return { ...DEFAULT_CHAT_SETTINGS_CONFIG }

  const displayModeRaw = typeof source.displayMode === 'string' ? source.displayMode.trim().toLowerCase() : ''
  const copyModeRaw = typeof source.copyMode === 'string' ? source.copyMode.trim().toLowerCase() : ''
  const botAvatarRaw = typeof source.botAvatar === 'string' ? source.botAvatar.trim().toLowerCase() : ''
  const avatarDataUrl = typeof source.avatarDataUrl === 'string' && source.avatarDataUrl.trim()
    ? source.avatarDataUrl.trim()
    : null

  const displayMode: ChatDisplayMode =
    displayModeRaw === 'collapsed' || displayModeRaw === 'content_only' || displayModeRaw === 'full'
      ? displayModeRaw
      : DEFAULT_CHAT_SETTINGS_CONFIG.displayMode
  const copyMode: ChatCopyMode =
    copyModeRaw === 'markdown' || copyModeRaw === 'full' || copyModeRaw === 'text'
      ? copyModeRaw
      : DEFAULT_CHAT_SETTINGS_CONFIG.copyMode
  const botAvatar: ChatBotAvatarMode =
    botAvatarRaw === 'default' || botAvatarRaw === 'holycrab' || botAvatarRaw === 'upload'
      ? botAvatarRaw
      : DEFAULT_CHAT_SETTINGS_CONFIG.botAvatar

  return {
    displayMode,
    copyMode,
    botAvatar,
    avatarDataUrl,
  }
}

function ChatPage() {
  const { t } = useLocale()
  const navigate = useNavigate()
  const routeSearch = useRouterState({ select: (state) => state.location.search as unknown })
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const bootstrap = useChatStore((state) => state.bootstrap)
  const bootstrapping = useChatStore((state) => state.bootstrapping)
  const connected = useChatStore((state) => state.connected)
  const loadingHistory = useChatStore((state) => state.loadingHistory)
  const historyReady = useChatStore((state) => state.historyReady)
  const messageScrollTop = useChatStore((state) => state.messageScrollTop)
  const messageManualUp = useChatStore((state) => state.messageManualUp)
  const messages = useChatStore((state) => state.messages)
  const sending = useChatStore((state) => state.sending)
  const streamText = useChatStore((state) => state.streamText)
  const runId = useChatStore((state) => state.runId)
  const activeRunSessionKey = useChatStore((state) => state.activeRunSessionKey)
  const unreadCompletedSessionKeys = useChatStore((state) => state.unreadCompletedSessionKeys)
  const error = useChatStore((state) => state.error)
  const queuedCount = useChatStore((state) => state.queuedCount)
  const assistantName = useChatStore((state) => state.assistantName)
  const assistantAvatar = useChatStore((state) => state.assistantAvatar)
  const draftInput = useChatStore((state) => state.draftInput)

  const [chatInput, setChatInput] = useState(draftInput || '')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [tipsOpen, setTipsOpen] = useState(false)
  const [agentsOverviewSnapshot, setAgentsOverviewSnapshot] = useState<OpenClawAgentsOverviewSnapshot | null>(
    cachedAgentsOverviewSnapshot,
  )
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(cachedSelectedAgentId)
  const [agentModelDraft, setAgentModelDraft] = useState<string>(cachedAgentModelDraft)
  const [savingAgentModel, setSavingAgentModel] = useState(false)
  const [agentModelError, setAgentModelError] = useState<string | null>(null)
  const [dictationState, setDictationState] = useState<DictationSessionState>('idle')
  const [dictationWorking, setDictationWorking] = useState(false)
  const [dictationLevel, setDictationLevel] = useState(0)
  const [dictationConfig, setDictationConfig] = useState<DictationConfig>({
    ...DEFAULT_DICTATION_CONFIG,
  })
  const [chatSettings, setChatSettings] = useState<ChatSettingsConfig>({
    ...DEFAULT_CHAT_SETTINGS_CONFIG,
  })
  const holdDictationActive = useRef(false)
  const holdDictationStopPending = useRef(false)
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([])
  const [announcementsLoading, setAnnouncementsLoading] = useState(false)
  const [announcementsError, setAnnouncementsError] = useState<string | null>(null)
  const [announcementFeedUrl, setAnnouncementFeedUrl] = useState('')
  const [announcementPage, setAnnouncementPage] = useState(1)
  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState<string | null>(null)
  const [readAnnouncementIds, setReadAnnouncementIds] = useState<string[]>(() => loadReadAnnouncementIds())
  const [agentSessions, setAgentSessions] = useState<OpenClawAgentSessionItem[]>([])
  const [isRetryingGateway, setIsRetryingGateway] = useState(false)
  const [isRestartingGateway, setIsRestartingGateway] = useState(false)
  const autoRuntimeRecoverRef = useRef<{ inFlight: boolean; lastAttemptAt: number }>({
    inFlight: false,
    lastAttemptAt: 0,
  })
  const activeSessionKey = readSearchParam(routeSearch, 'session') || 'main'
  const activeChatTab = readSearchParam(routeSearch, 'tab')
  const activeAnnouncementId = readSearchParam(routeSearch, 'announcement')
  const runBoundToCurrentSession = activeRunSessionKey
    ? (
      (isMainSessionAlias(activeRunSessionKey) && isMainSessionAlias(activeSessionKey))
      || activeRunSessionKey === activeSessionKey
    )
    : false
  const visibleStreamText = runBoundToCurrentSession ? streamText : null

  const loadAgentsOverview = useCallback(async () => {
    try {
      const nextSnapshot = await getOpenClawAgentsOverview()
      cachedAgentsOverviewSnapshot = nextSnapshot
      setAgentsOverviewSnapshot(nextSnapshot)
      setAgentModelError(null)
      setSelectedAgentId((previous) => {
        if (!nextSnapshot.agents.length) return null
        if (previous && nextSnapshot.agents.some((agent) => agent.id === previous)) return previous
        if (nextSnapshot.defaultAgentId && nextSnapshot.agents.some((agent) => agent.id === nextSnapshot.defaultAgentId)) {
          return nextSnapshot.defaultAgentId
        }
        return nextSnapshot.agents[0]?.id || null
      })
    } catch (err) {
      console.error(err)
      setAgentModelError(String(err))
    }
  }, [])

  const loadDictationConfig = useCallback(async () => {
    try {
      const settings = await tauriInvoke<SettingsView>('get_settings')
      setDictationConfig(normalizeDictationConfig(settings))
      setChatSettings(normalizeChatSettings(settings))
    } catch (err) {
      console.error(err)
    }
  }, [])

  const loadAnnouncements = useCallback(async () => {
    setAnnouncementsLoading(true)
    setAnnouncementsError(null)
    try {
      const feed = await fetchAnnouncementsFeed()
      setAnnouncementFeedUrl(feed.url)
      setAnnouncements(feed.items)
      setAnnouncementPage(1)
    } catch (err) {
      console.error(err)
      setAnnouncementsError(String(err))
    } finally {
      setAnnouncementsLoading(false)
    }
  }, [])

  const loadAgentSessions = useCallback(async () => {
    try {
      const snapshot = await getOpenClawAgentSessions()
      setAgentSessions(Array.isArray(snapshot.sessions) ? snapshot.sessions : [])
    } catch (err) {
      console.error(err)
    }
  }, [])

  useEffect(() => {
    void ensureChatRuntimeStarted()
    void loadAgentsOverview()
    void loadDictationConfig()
    void loadAnnouncements()
    void loadAgentSessions()
  }, [loadAgentsOverview, loadDictationConfig, loadAnnouncements, loadAgentSessions])

  useEffect(() => subscribeProviderProfilesChanged(() => {
    void loadAgentsOverview()
  }), [loadAgentsOverview])

  useEffect(() => {
    if (!draftInput.trim()) return
    setChatInput(draftInput)
    useChatStore.getState().patch({ draftInput: '' })
  }, [draftInput])

  useEffect(() => {
    void setActiveChatSessionKey(activeSessionKey)
  }, [activeSessionKey])

  useEffect(() => {
    if (activeChatTab !== 'system') return
    setSelectedAnnouncementId(null)
  }, [activeChatTab])

  useEffect(() => {
    cachedSelectedAgentId = selectedAgentId
  }, [selectedAgentId])

  useEffect(() => {
    cachedAgentModelDraft = agentModelDraft
  }, [agentModelDraft])

  useEffect(() => {
    const onFocus = () => {
      void loadDictationConfig()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
    }
  }, [loadDictationConfig])

  useEffect(() => {
    if (bootstrapping || connected || !bootstrap?.canChat) {
      return
    }
    const now = Date.now()
    const guard = autoRuntimeRecoverRef.current
    if (guard.inFlight || now - guard.lastAttemptAt < 10_000) {
      return
    }

    const timer = window.setTimeout(() => {
      const nextGuard = autoRuntimeRecoverRef.current
      nextGuard.inFlight = true
      nextGuard.lastAttemptAt = Date.now()
      void refreshChatRuntime()
        .catch((error) => {
          console.error(error)
        })
        .finally(() => {
          autoRuntimeRecoverRef.current.inFlight = false
        })
    }, 1200)

    return () => {
      window.clearTimeout(timer)
    }
  }, [bootstrapping, bootstrap?.canChat, connected])

  useEffect(() => {
    let alive = true
    let unlisten: (() => void) | null = null

    const bind = async () => {
      try {
        const off = await listenDictationEvents((event) => {
          if (event.type === 'state') {
            setDictationState(event.state)
            if (event.state === 'idle') {
              setDictationWorking(false)
              setDictationLevel(0)
            }
            return
          }
          if (event.type === 'level') {
            setDictationLevel(event.value)
            return
          }
          if (event.type === 'transcript') {
            if (typeof document !== 'undefined') {
              if (document.visibilityState !== 'visible' || !document.hasFocus()) {
                return
              }
            }
            const text = event.text.trim()
            if (!text) return
            setChatInput((previous) => {
              const textarea = textareaRef.current
              const start = textarea?.selectionStart ?? previous.length
              const end = textarea?.selectionEnd ?? start
              const { nextText, nextCursor } = computeDictationInsertion(previous, text, start, end)
              window.requestAnimationFrame(() => {
                if (!textareaRef.current) return
                textareaRef.current.focus()
                textareaRef.current.setSelectionRange(nextCursor, nextCursor)
              })
              return nextText
            })
            return
          }
          if (event.type === 'error' || event.type === 'canceled') {
            setAgentModelError(event.message)
            setDictationWorking(false)
            setDictationLevel(0)
          }
        })

        if (!alive) {
          void off()
          return
        }
        unlisten = off
      } catch (err) {
        console.error(err)
      }
    }

    void bind()

    return () => {
      alive = false
      if (unlisten) {
        void unlisten()
        unlisten = null
      }
    }
  }, [])

  const forceRefresh = useCallback(async () => {
    await Promise.all([
      refreshChatRuntime(),
      loadAgentsOverview(),
      loadDictationConfig(),
      loadAnnouncements(),
      loadAgentSessions(),
    ])
  }, [loadAgentsOverview, loadDictationConfig, loadAnnouncements, loadAgentSessions])

  const handleRetryGateway = useCallback(async () => {
    setIsRetryingGateway(true)
    try {
      await forceRefresh()
    } catch (err) {
      console.error(err)
    } finally {
      setIsRetryingGateway(false)
    }
  }, [forceRefresh])

  const handleRestartGateway = useCallback(async () => {
    setIsRestartingGateway(true)
    try {
      await checkOpenClawReadiness({ attemptFix: true })
      await forceRefresh()
    } catch (err) {
      console.error(err)
    } finally {
      setIsRestartingGateway(false)
    }
  }, [forceRefresh])

  useEffect(() => {
    let alive = true
    let unlisten: (() => void) | null = null

    const bind = async () => {
      try {
        const off = await listenSetupStateChanged(() => {
          if (!alive) return
          void forceRefresh()
        })
        if (!alive) {
          void off()
          return
        }
        unlisten = off
      } catch (error) {
        console.error(error)
      }
    }

    void bind()
    return () => {
      alive = false
      if (unlisten) {
        void unlisten()
      }
    }
  }, [forceRefresh])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const hitRefreshShortcut = key === 'f5' || ((event.metaKey || event.ctrlKey) && key === 'r')
      if (!hitRefreshShortcut) return
      event.preventDefault()
      void forceRefresh()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [forceRefresh])

  const canChat = Boolean(bootstrap?.canChat)
  const canCompose = canChat && connected
  const isBusy = runBoundToCurrentSession && (sending || runId !== null)
  const readAnnouncementIdSet = useMemo(() => new Set(readAnnouncementIds), [readAnnouncementIds])
  const unreadAnnouncementCount = useMemo(
    () => announcements.filter((item) => !readAnnouncementIdSet.has(item.id)).length,
    [announcements, readAnnouncementIdSet],
  )
  const showAnnouncementCenterPage = activeChatTab === 'system'
  const showAnnouncementsTip = unreadAnnouncementCount > 0 && !showAnnouncementCenterPage
  const currentSessionHasUnreadCompleted = useMemo(() => {
    if (showAnnouncementCenterPage) return false
    if (isMainSessionAlias(activeSessionKey)) {
      return unreadCompletedSessionKeys.some((key) => isMainSessionAlias(key))
    }
    return unreadCompletedSessionKeys.includes(activeSessionKey)
  }, [activeSessionKey, showAnnouncementCenterPage, unreadCompletedSessionKeys])
  const currentSessionMeta = useMemo(
    () => agentSessions.find((item) => item.key === activeSessionKey) ?? null,
    [agentSessions, activeSessionKey],
  )
  const sessionHeaderTitle = useMemo(() => {
    if (showAnnouncementCenterPage) return '系统消息'
    if (isMainSessionAlias(activeSessionKey)) return 'Main:main'
    const scopeRaw = (currentSessionMeta?.channel || extractScopeFromSessionKey(activeSessionKey) || currentSessionMeta?.agentId || 'main').trim()
    const scope = normalizeScopeLabel(scopeRaw)
    const sessionShort = (currentSessionMeta?.sessionId || activeSessionKey).slice(0, 8)
    return `${scope}:${sessionShort}`
  }, [showAnnouncementCenterPage, activeSessionKey, currentSessionMeta])
  const announcementTotalPages = Math.max(1, Math.ceil(announcements.length / ANNOUNCEMENTS_PAGE_SIZE))
  const pagedAnnouncements = useMemo(() => {
    const start = (announcementPage - 1) * ANNOUNCEMENTS_PAGE_SIZE
    return announcements.slice(start, start + ANNOUNCEMENTS_PAGE_SIZE)
  }, [announcementPage, announcements])
  const selectedAnnouncement = useMemo(
    () => announcements.find((item) => item.id === selectedAnnouncementId) ?? null,
    [announcements, selectedAnnouncementId],
  )

  const markRead = useCallback((id: string) => {
    if (!id || readAnnouncementIdSet.has(id)) return
    markAnnouncementRead(id)
    setReadAnnouncementIds((previous) => {
      if (previous.includes(id)) return previous
      return [...previous, id]
    })
    }, [readAnnouncementIdSet])
  useEffect(() => {
    if (!showAnnouncementCenterPage) {
      setSelectedAnnouncementId(null)
      return
    }
    setSelectedAnnouncementId(activeAnnouncementId || null)
  }, [showAnnouncementCenterPage, activeAnnouncementId])

  useEffect(() => {
    if (!showAnnouncementCenterPage || !selectedAnnouncementId) {
      return
    }
    markRead(selectedAnnouncementId)
  }, [markRead, selectedAnnouncementId, showAnnouncementCenterPage])

  const openAnnouncementCenter = useCallback(() => {
    setSelectedAnnouncementId(null)
    void navigate({ to: '/chat', search: { tab: 'system' } as never })
  }, [navigate])

  const openAnnouncementDetail = useCallback((id: string) => {
    setSelectedAnnouncementId(id)
    markRead(id)
  }, [markRead])

  const markAllAnnouncementsRead = useCallback(() => {
    for (const item of announcements) {
      markAnnouncementRead(item.id)
    }
    setReadAnnouncementIds(announcements.map((item) => item.id))
  }, [announcements])

  useEffect(() => {
    setAnnouncementPage((previous) => Math.min(previous, announcementTotalPages))
  }, [announcementTotalPages])

  const agentOptions = useMemo(() => agentsOverviewSnapshot?.agents ?? [], [agentsOverviewSnapshot])
  const selectedAgentOverview = useMemo(() => {
    if (!agentOptions.length) return null
    if (!selectedAgentId) return agentOptions[0]
    return agentOptions.find((agent) => agent.id === selectedAgentId) || agentOptions[0]
  }, [agentOptions, selectedAgentId])
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

  const updateAgentPrimaryModel = useCallback(async (nextOptionId: string) => {
    setAgentModelDraft(nextOptionId)
    setAgentModelError(null)
    if (!selectedAgentOverview) return
    const selectedOption = modelOptions.find((item) => item.id === nextOptionId) || null
    if (!selectedOption) return
    if (selectedOption.source !== 'keyHub' && selectedOption.modelId === selectedAgentOverview.primaryModel) return

    setSavingAgentModel(true)
    try {
      await saveOpenClawAgentPrimaryModel({
        agentId: selectedAgentOverview.id,
        modelId: selectedOption.modelId,
        source: selectedOption.source,
        profileId: selectedOption.profileId || undefined,
      })
      await loadAgentsOverview()
    } catch (err) {
      console.error(err)
      setAgentModelError(String(err))
    } finally {
      setSavingAgentModel(false)
    }
  }, [loadAgentsOverview, modelOptions, selectedAgentOverview])

  const ensureDictationModelReady = useCallback(async () => {
    const targetModelId = dictationConfig.model || DEFAULT_DICTATION_CONFIG.model
    let status = await dictationModelStatus(targetModelId)
    if (status.state === 'ready') return
    await dictationDownloadModel(targetModelId)

    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 1000)
      })
      status = await dictationModelStatus(targetModelId)
      if (status.state === 'ready') return
      if (status.state === 'error') {
        throw new Error(status.error || 'Dictation model download failed.')
      }
    }
    throw new Error('Dictation model download timed out.')
  }, [dictationConfig.model])

  const startDictation = useCallback(async () => {
    setAgentModelError(null)
    if (!dictationConfig.enabled) {
      void openSettingsWindow('dictation').catch((err) => {
        console.error(err)
      })
      return
    }
    if (dictationState === 'processing' || dictationWorking) {
      return
    }
    if (dictationState === 'listening') {
      return
    }

    setDictationWorking(true)
    try {
      await ensureDictationModelReady()
      const preferredLanguage = dictationConfig.language
        || (typeof navigator === 'undefined'
          ? undefined
          : navigator.language.split('-')[0])
      await dictationStart(preferredLanguage || undefined)
    } catch (err) {
      console.error(err)
      setAgentModelError(String(err))
      setDictationWorking(false)
    }
  }, [dictationConfig, dictationState, dictationWorking, ensureDictationModelReady])

  const stopDictation = useCallback(async () => {
    if (dictationState !== 'listening') {
      return
    }
    setDictationWorking(true)
    try {
      await dictationStop()
    } catch (err) {
      console.error(err)
      setAgentModelError(String(err))
      setDictationWorking(false)
    }
  }, [dictationState])

  const cancelDictationSession = useCallback(async () => {
    setDictationWorking(true)
    try {
      await dictationCancel()
    } catch (err) {
      console.error(err)
      setAgentModelError(String(err))
      setDictationWorking(false)
    }
  }, [])

  const startDictationHold = useCallback(() => {
    holdDictationActive.current = true
    holdDictationStopPending.current = false
    void startDictation()
  }, [startDictation])

  const stopDictationHold = useCallback(() => {
    if (!holdDictationActive.current) {
      return
    }
    holdDictationActive.current = false
    holdDictationStopPending.current = true
    if (dictationState === 'listening') {
      holdDictationStopPending.current = false
      void stopDictation()
    }
  }, [dictationState, stopDictation])

  useEffect(() => {
    if (!holdDictationStopPending.current) {
      return
    }
    if (dictationState !== 'listening') {
      return
    }
    holdDictationStopPending.current = false
    void stopDictation()
  }, [dictationState, stopDictation])

  useEffect(() => {
    const normalizedHoldKey = dictationConfig.holdKey
    if (normalizedHoldKey === 'off') {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesHoldKey(event, normalizedHoldKey) || event.repeat) {
        return
      }
      if (!dictationConfig.enabled || dictationState !== 'idle' || dictationWorking) {
        return
      }
      holdDictationActive.current = true
      holdDictationStopPending.current = false
      void startDictation()
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (!matchesHoldKey(event, normalizedHoldKey)) {
        return
      }
      if (!holdDictationActive.current) {
        return
      }
      holdDictationActive.current = false
      holdDictationStopPending.current = true
      if (dictationState === 'listening') {
        holdDictationStopPending.current = false
        void stopDictation()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [
    dictationConfig.enabled,
    dictationConfig.holdKey,
    dictationState,
    dictationWorking,
    startDictation,
    stopDictation,
  ])

  useEffect(() => {
    const onWindowBlur = () => {
      holdDictationActive.current = false
      holdDictationStopPending.current = false
      if (dictationState === 'listening') {
        void cancelDictationSession()
      }
    }
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [cancelDictationSession, dictationState])

  const openDictationSettings = useCallback(() => {
    void openSettingsWindow('dictation').catch((err) => {
      console.error(err)
    })
  }, [])

  const onSubmit = useCallback(async () => {
    if (!canCompose) {
      return
    }

    const message = chatInput.trim()
    const hasAttachments = attachments.length > 0
    if (!message && !hasAttachments) {
      return
    }

    if (!hasAttachments && isChatStopCommand(message)) {
      setChatInput('')
      await abortChatRun()
      return
    }

    const rawInput = chatInput
    const pendingAttachments = attachments.map((attachment) => ({ ...attachment }))
    setChatInput('')
    setAttachments([])
    const sent = await sendChatMessage({
      text: message,
      attachments: pendingAttachments,
    })
    if (!sent) {
      setChatInput(rawInput)
      setAttachments(pendingAttachments)
      return
    }

    try {
      textareaRef.current?.focus({ preventScroll: true })
    } catch {
      textareaRef.current?.focus()
    }
  }, [attachments, canCompose, chatInput])

  const handlePaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items
    if (!items) return

    const imageItems: DataTransferItem[] = []
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      if (item.type.startsWith('image/')) {
        imageItems.push(item)
      }
    }

    if (imageItems.length === 0) {
      return
    }

    event.preventDefault()

    for (const item of imageItems) {
      const file = item.getAsFile()
      if (!file) continue

      const reader = new FileReader()
      reader.addEventListener('load', () => {
        const dataUrl = String(reader.result ?? '')
        if (!dataUrl) return
        setAttachments((prev) => ([
          ...prev,
          {
            id: nextId(),
            dataUrl,
            mimeType: file.type,
          },
        ]))
      })
      reader.readAsDataURL(file)
    }
  }, [])

  const suggestions = useMemo<ChatSuggestion[]>(() => ([
    {
      id: 'key-offer',
      badge: t('chat.suggestion.key.badge'),
      title: t('chat.suggestion.key.title'),
      body: t('chat.suggestion.key.body'),
      highlights: [
        t('chat.suggestion.key.highlight1'),
        t('chat.suggestion.key.highlight2'),
      ],
      primaryAction: {
        kind: 'external',
        label: t('chat.suggestion.key.cta'),
        url: externalLinks.keyMarketplace,
        variant: 'brand',
      },
    },
    {
      id: 'dashboard',
      badge: t('chat.suggestion.dashboard.badge'),
      title: t('chat.suggestion.dashboard.title'),
      body: t('chat.suggestion.dashboard.body'),
      highlights: [
        t('chat.suggestion.dashboard.highlight1'),
        t('chat.suggestion.dashboard.highlight2'),
      ],
      primaryAction: {
        kind: 'route',
        label: t('chat.suggestion.dashboard.cta'),
        route: '/dashboard',
        variant: 'default',
      },
    },
    {
      id: 'market-insight',
      badge: t('chat.suggestion.insight.badge'),
      title: t('chat.suggestion.insight.title'),
      body: t('chat.suggestion.insight.body'),
      highlights: [
        t('chat.suggestion.insight.highlight1'),
        t('chat.suggestion.insight.highlight2'),
      ],
      primaryAction: {
        kind: 'prompt',
        label: t('chat.suggestion.insight.ctaTry'),
        prompt: t('chat.suggestion.insight.prompt'),
        variant: 'brand',
      },
      secondaryAction: {
        kind: 'route',
        label: t('chat.suggestion.insight.ctaMore'),
        route: '/discover',
        variant: 'outline',
      },
    },
  ]), [t])
  const quickMarketSeedPrompt = useMemo(
    () => t('chat.suggestion.insight.prompt'),
    [t],
  )
  const quickMarketComposedPrompt = useMemo(
    () => buildQuickMarketInsightPrompt(quickMarketSeedPrompt),
    [quickMarketSeedPrompt],
  )
  const applySuggestionToInput = useCallback((prompt: string) => {
    if (prompt.trim() === quickMarketSeedPrompt.trim()) {
      setChatInput(quickMarketComposedPrompt)
      return
    }
    setChatInput(prompt)
  }, [quickMarketComposedPrompt, quickMarketSeedPrompt])
  const runSuggestionAction = useCallback((action: ChatSuggestion['primaryAction']) => {
    if (action.kind === 'prompt') {
      applySuggestionToInput(action.prompt)
      return
    }
    if (action.kind === 'external') {
      void openExternalUrl(action.url).catch((err) => {
        console.error(err)
      })
      return
    }
    void navigate({ to: action.route })
  }, [applySuggestionToInput, navigate])

  const statusLabel = bootstrapping
    ? t('chat.status.checking')
    : connected
      ? t('chat.status.connected')
      : t('chat.status.disconnected')
  const statusVariant = !bootstrapping && connected ? 'connected' : 'muted'
  const bootstrapSettled = !bootstrapping && Boolean(bootstrap)
  const installCheckPending = !bootstrapSettled
  const readiness = bootstrap?.readiness
  const openclawBinDetected = Boolean(
    bootstrap?.readiness?.openclawBin
    && String(bootstrap.readiness.openclawBin).trim(),
  )
  const gatewayInstalled = Boolean(bootstrap?.readiness?.gatewayInstalled)
  const gatewayRunning = Boolean(bootstrap?.readiness?.gatewayRunning)
  const portListening = Boolean(bootstrap?.readiness?.portListening)
  const chatReachable = Boolean(bootstrap?.readiness?.chatReachable)
  const installed = Boolean(
    openclawBinDetected || gatewayInstalled || gatewayRunning || portListening || chatReachable,
  )
  const noMessagesYet = messages.length === 0 && visibleStreamText === null
  const showInstallCheckSkeleton = installCheckPending
  const showInstalledLoadingSkeleton = !showInstallCheckSkeleton
    && installed
    && canChat
    && (!historyReady || loadingHistory)
    && noMessagesYet
  const openclawInstalled = openclawBinDetected || gatewayInstalled || gatewayRunning || portListening || chatReachable
  const hasReadiness = Boolean(readiness)
  const shouldGuideSetupWizard = Boolean(
    hasReadiness
    && !openclawBinDetected
    && !gatewayInstalled
    && !gatewayRunning
    && !portListening,
  )
  const showSetupWizardMask = !showInstallCheckSkeleton && !canChat && shouldGuideSetupWizard
  const showGatewayOfflineMask = !showInstallCheckSkeleton && !canChat && openclawInstalled
  const showMask = showSetupWizardMask || showGatewayOfflineMask
  const showSuggestionCards = !showInstallCheckSkeleton
    && !showInstalledLoadingSkeleton
    && installed
    && historyReady
    && !loadingHistory
    && noMessagesYet
    && !isBusy

  const copyMessage = useCallback(async (message: NormalizedMessage) => {
    const messageText = (message.contentText ?? message.text)?.trim() || ''
    const images = message.images?.filter(Boolean) || []

    let copyText = ''
    if (chatSettings.copyMode === 'text') {
      copyText = messageText
    } else if (chatSettings.copyMode === 'full') {
      const imageLines = images.map((url) => `image: ${url}`)
      copyText = [messageText, ...imageLines].filter(Boolean).join('\n').trim()
    } else {
      copyText = [
        messageText,
        ...images.map((url) => `![image](${url})`),
      ]
        .filter(Boolean)
        .join('\n\n')
        .trim()
    }
    if (!copyText) return

    try {
      await navigator.clipboard.writeText(copyText)
    } catch (err) {
      console.error(err)
    }
  }, [chatSettings.copyMode])

  const quoteMessage = useCallback((message: NormalizedMessage) => {
    const quoteBlock = (message.text || '')
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
      .trim()
    if (!quoteBlock) return

    setChatInput((previous) => {
      if (!previous.trim()) return `${quoteBlock}\n\n`
      return `${previous.trimEnd()}\n\n${quoteBlock}\n\n`
    })
    textareaRef.current?.focus()
  }, [])

  const messageLabels = useMemo(
    () => ({
      loadingHistory: t('chat.history.loading'),
      empty: t('chat.history.empty'),
      maskTitle: showSetupWizardMask || showGatewayOfflineMask ? t('chat.mask.title') : t('chat.status.disconnected'),
      maskDescription: showSetupWizardMask
        ? t('chat.mask.description')
        : `${t('setupWizard.errors.gatewayNotReady')}${readiness?.gatewayLogPath ? ` ${t('setupWizard.advice.logsPrefix')} ${readiness.gatewayLogPath}` : ''}${' ' + t('setupWizard.advice.gatewayRestart')}`,
      maskAction: showSetupWizardMask ? t('chat.mask.openWizard') : t('chat.mask.retryGateway'),
      maskActionSecondary: showGatewayOfflineMask ? t('softwareCenter.button.restartGateway') : undefined,
      maskActionDisabled: isRetryingGateway,
      maskActionSecondaryDisabled: isRestartingGateway,
      scrollToBottom: t('chat.scrollToBottom'),
    }),
    [isRestartingGateway, isRetryingGateway, readiness?.gatewayLogPath, showGatewayOfflineMask, showSetupWizardMask, t],
  )

  const handleMaskAction = useCallback(() => {
    if (showSetupWizardMask) {
      void openSetupWizardWindow('openclaw')
      return
    }
    void handleRetryGateway()
  }, [handleRetryGateway, showSetupWizardMask])

  const handleSecondaryMaskAction = useCallback(() => {
    if (showSetupWizardMask) return
    void handleRestartGateway()
  }, [handleRestartGateway, showSetupWizardMask])

  const handleMessageScrollStateChange = useCallback((nextScrollTop: number, manualUp: boolean) => {
    const state = useChatStore.getState()
    const normalizedTop = manualUp ? Math.max(0, Math.floor(nextScrollTop)) : 0
    const unchanged = state.messageManualUp === manualUp
      && (!manualUp || Math.abs(state.messageScrollTop - normalizedTop) < 1)
    if (unchanged) {
      return
    }

    useChatStore.setState({
      messageManualUp: manualUp,
      messageScrollTop: normalizedTop,
    })
    if (!manualUp && currentSessionHasUnreadCompleted) {
      markChatSessionAsRead(activeSessionKey)
    }
  }, [activeSessionKey, currentSessionHasUnreadCompleted])

  const handleMessageContentInteract = useCallback(() => {
    if (!currentSessionHasUnreadCompleted || showAnnouncementCenterPage) {
      return
    }
    markChatSessionAsRead(activeSessionKey)
  }, [activeSessionKey, currentSessionHasUnreadCompleted, showAnnouncementCenterPage])

  return (
    <div className="overscroll-behavior-contain flex h-full min-h-0 min-w-0 touch-pan-y flex-col overflow-hidden bg-background">
      <div className="mx-auto w-full max-w-[1520px] px-3 pb-2 pt-3 md:px-5 md:pb-3 md:pt-4">
        <ChatHeader
          title={sessionHeaderTitle}
          status={statusLabel}
          statusVariant={statusVariant}
          refreshLabel={t('common.refresh')}
          tipsLabel={t('chat.tips.button')}
          restartGatewayLabel={t('softwareCenter.button.restartGateway')}
          restartingGatewayLabel={t('softwareCenter.button.restartingGateway')}
          showRestartGateway={!bootstrapping && !connected}
          restartingGateway={isRestartingGateway}
          onRestartGateway={() => {
            void handleRestartGateway()
          }}
          onRefresh={() => {
            void forceRefresh()
          }}
          onTips={() => {
            setTipsOpen(true)
          }}
        />
      </div>

      {showAnnouncementsTip ? (
        <div className="mx-auto w-full max-w-[1520px] px-3 pb-2 md:px-5">
          <button
            type="button"
            onClick={openAnnouncementCenter}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-primary/35 bg-primary/10 px-4 py-3 text-left transition hover:bg-primary/15"
          >
            <span className="inline-flex items-center gap-2">
              <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
                NEW!
              </span>
              <span className="text-sm font-semibold text-foreground">
                {`你有 ${unreadAnnouncementCount} 条未读消息`}
              </span>
            </span>
            <span className="text-xs font-semibold text-primary">查看消息</span>
          </button>
        </div>
      ) : null}

      <Dialog open={tipsOpen} onOpenChange={setTipsOpen}>
        <DialogContent className="max-w-5xl bg-background/95">
          <DialogHeader>
            <DialogTitle>{t('chat.tips.title')}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center py-1">
            <SuggestedActions
              suggestions={suggestions}
              canCompose={canCompose}
              onSuggestionAction={(action) => {
                runSuggestionAction(action)
                setTipsOpen(false)
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {showAnnouncementCenterPage ? (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="hc-scrollbar-stealth min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1520px] space-y-4 px-3 pb-4 pt-1 md:px-5">
              {selectedAnnouncement ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelectedAnnouncementId(null)}
                    >
                      返回列表
                    </Button>
                    <div className="text-xs text-muted-foreground">{formatAnnouncementDate(selectedAnnouncement.publishedAt)}</div>
                  </div>

                  {selectedAnnouncement.heroImage?.url ? (
                    <img
                      src={selectedAnnouncement.heroImage.url}
                      alt={selectedAnnouncement.heroImage.alt}
                      className="w-full rounded-xl border border-border/40 object-cover"
                      loading="lazy"
                    />
                  ) : null}

                  <h3 className="text-xl font-semibold text-foreground">{selectedAnnouncement.title}</h3>
                  {selectedAnnouncement.summary ? (
                    <p className="text-sm text-muted-foreground">{selectedAnnouncement.summary}</p>
                  ) : null}

                  <AnnouncementContentRenderer
                    content={selectedAnnouncement.contentMarkdown}
                    markdownClassName="hc-chat-markdown overflow-x-hidden break-words rounded-xl border border-border/35 bg-background/35 p-4"
                    specClassName="rounded-xl border border-border/35 bg-background/35 p-4"
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-end">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={markAllAnnouncementsRead}
                      disabled={announcements.length === 0}
                    >
                      全部标为已读
                    </Button>
                  </div>

                  {announcementsError ? (
                    <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {`消息拉取失败: ${announcementsError}`}
                    </div>
                  ) : null}

                  {!announcementFeedUrl ? (
                    <div className="rounded-xl border border-border/40 bg-background/35 px-3 py-3 text-sm text-muted-foreground">
                      未配置消息源。请设置 `HOLYCRAB_ANNOUNCEMENTS_FEED_URL`。
                    </div>
                  ) : null}

                  {announcementFeedUrl && announcements.length === 0 && !announcementsLoading ? (
                    <div className="rounded-xl border border-border/40 bg-background/35 px-3 py-3 text-sm text-muted-foreground">
                      暂无消息。
                    </div>
                  ) : null}

                  {pagedAnnouncements.map((item) => {
                    const unread = !readAnnouncementIdSet.has(item.id)
                    return (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => openAnnouncementDetail(item.id)}
                        className="flex w-full items-start gap-3 rounded-2xl border border-border/50 bg-background/40 p-3 text-left transition hover:border-primary/45 hover:bg-background/55"
                      >
                        {item.coverImage ? (
                          <img
                            src={item.coverImage}
                            alt={item.title}
                            className="h-16 w-28 shrink-0 rounded-lg border border-border/40 object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-16 w-28 shrink-0 rounded-lg border border-dashed border-border/40 bg-background/25" />
                        )}
                        <span className="min-w-0 flex-1 space-y-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-foreground">{item.title}</span>
                            {unread ? (
                              <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                                New
                              </span>
                            ) : null}
                          </span>
                          <span className="line-clamp-2 text-xs text-muted-foreground">
                            {item.summary || '点击查看详情'}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{formatAnnouncementDate(item.publishedAt)}</span>
                        </span>
                      </button>
                    )
                  })}

                  {announcements.length > ANNOUNCEMENTS_PAGE_SIZE ? (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setAnnouncementPage((value) => Math.max(1, value - 1))}
                        disabled={announcementPage <= 1}
                      >
                        上一页
                      </Button>
                      <div className="text-xs text-muted-foreground">
                        {`第 ${announcementPage} / ${announcementTotalPages} 页`}
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setAnnouncementPage((value) => Math.min(announcementTotalPages, value + 1))}
                        disabled={announcementPage >= announcementTotalPages}
                      >
                        下一页
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </section>
      ) : (
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1">
          <Messages
            loadingHistory={loadingHistory}
            messages={messages}
            streamText={visibleStreamText}
            suggestions={suggestions}
            showSuggestionCards={showSuggestionCards}
            forceSkeleton={showInstallCheckSkeleton || showInstalledLoadingSkeleton}
            forceMask={showMask}
            canCompose={canCompose}
            canChat={canChat}
            onSuggestionAction={runSuggestionAction}
            onMaskAction={handleMaskAction}
            onSecondaryMaskAction={showGatewayOfflineMask ? handleSecondaryMaskAction : undefined}
            onCopyMessage={copyMessage}
            onQuoteMessage={quoteMessage}
            labels={messageLabels}
            endRef={messagesEndRef}
            assistantName={assistantName}
            assistantAvatar={assistantAvatar}
            assistantAvatarMode={chatSettings.botAvatar}
            assistantAvatarDataUrl={chatSettings.avatarDataUrl}
            displayMode={chatSettings.displayMode}
            initialScrollTop={messageScrollTop}
            initialManualUp={messageManualUp}
            onScrollStateChange={handleMessageScrollStateChange}
            onContentInteract={handleMessageContentInteract}
          />
        </div>
        <div className="shrink-0 border-t border-border/30 bg-background">
          <div className="mx-auto w-full max-w-[1520px] px-3 pb-3 pt-2 md:px-5 md:pb-4 md:pt-3">
            <div className="w-full">
              <div className="mb-2 min-h-[24px]">
                {error || bootstrap?.errors?.length || agentModelError ? (
                  <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {error || bootstrap?.errors?.[0] || agentModelError}
                  </div>
                ) : !error && canCompose && isBusy ? (
                  <div className="text-xs text-muted-foreground">
                    {queuedCount > 0
                      ? `${t('chat.input.busyQueuePrefix')}${queuedCount}`
                      : t('chat.input.busyRunning')}
                  </div>
                ) : null}
              </div>

              <MultimodalInput
                attachments={attachments}
                input={chatInput}
                textareaRef={textareaRef}
                disabled={!canCompose}
                sending={isBusy}
                canSubmit={canCompose && (Boolean(chatInput.trim()) || attachments.length > 0)}
                dictationState={dictationState}
                dictationLevel={dictationLevel}
                dictationWorking={dictationWorking}
                dictationEnabled={dictationConfig.enabled}
                onOpenDictationSettings={openDictationSettings}
                onDictationHoldStart={startDictationHold}
                onDictationHoldEnd={stopDictationHold}
                placeholders={{
                  ready: t('chat.input.placeholder.ready'),
                  disabled: t('chat.input.placeholder.disabled'),
                  send: t('chat.input.send'),
                  queue: t('chat.input.queue'),
                  sending: t('chat.input.sending'),
                  expand: t('chat.input.expand'),
                  collapse: t('chat.input.collapse'),
                  dictationProcessing: t('chat.input.dictationProcessing'),
                }}
                onInputChange={setChatInput}
                onPaste={handlePaste}
                onRemoveAttachment={(id) => {
                  setAttachments((prev) => prev.filter((item) => item.id !== id))
                }}
                onEnterSubmit={() => {
                  void onSubmit()
                }}
                onSubmit={(event) => {
                  event.preventDefault()
                  void onSubmit()
                }}
              />

              {selectedAgentOverview ? (
                <div className="mt-3 grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="h-9 min-w-[320px] max-w-full rounded-lg border border-border/35 bg-background/40 px-3 text-sm text-foreground outline-none"
                      value={agentModelDraft}
                      onChange={(event) => {
                        void updateAgentPrimaryModel(event.target.value)
                      }}
                      disabled={!canChat || savingAgentModel || modelOptions.length === 0}
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
                    {savingAgentModel ? (
                      <span className="text-xs text-muted-foreground">
                        {t('softwareCenter.button.savingChanges')}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      )}
    </div>
  )
}
