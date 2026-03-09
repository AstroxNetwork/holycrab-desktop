import {
  loadOpenClawChatBootstrap,
  type OpenClawChatBootstrapSnapshot,
} from '@/lib/openclaw-chat-bootstrap'
import {
  GatewayRequestError,
  OpenClawGatewayClient,
  type GatewayEventFrame,
} from '@/lib/openclaw-gateway-chat'
import { publishLifecycleSession } from '@/lib/lifecycle-bus'
import type { ChatAttachment, NormalizedMessage } from '@/components/chat/types'
import {
  DEFAULT_ASSISTANT_AVATAR,
  DEFAULT_ASSISTANT_NAME,
  useChatStore,
} from '@/stores/chat-store'

type GatewayChatEventPayload = {
  runId: string
  sessionKey?: string
  state: 'delta' | 'final' | 'aborted' | 'error'
  message?: unknown
  errorMessage?: string
}

type GatewayAssistantIdentityPayload = {
  agentId?: string | null
  name?: string | null
  avatar?: string | null
}

type SessionDefaultsSnapshot = {
  defaultAgentId?: string
  mainKey?: string
  mainSessionKey?: string
  scope?: string
}

type ChatQueueItem = {
  id: string
  text: string
  attachments: ChatAttachment[]
}

const DEFAULT_SESSION_KEY = 'main'

let startPromise: Promise<void> | null = null
let client: OpenClawGatewayClient | null = null
let activeEndpointKey: string | null = null
let historyLoadedOnce = false
let loadingHistory = false
let loadingHistorySessionKey: string | null = null
let runIdRef: string | null = null
let runStartedAtRef: number | null = null
let queue: ChatQueueItem[] = []
let runSyncTimer: number | null = null
let backgroundSyncTimer: number | null = null
let lastHistorySyncAt = 0
let lastSilentHistoryAttemptAt = 0
let activeSessionKey = DEFAULT_SESSION_KEY
let sessionDefaults: SessionDefaultsSnapshot | null = null
let runSessionKeyRef: string | null = null
const liveSessionKeys = new Set<string>()
const unreadCompletedSessionKeys = new Set<string>()
const lifecycleSessionShadow = new Map<string, { live: boolean; unreadCompleted: boolean }>()

function nextId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function sortByTimestamp(messages: NormalizedMessage[]) {
  return [...messages].sort((a, b) => a.timestamp - b.timestamp)
}

function sameStringArray(left: string[], right: string[]) {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function sameMessage(left: NormalizedMessage, right: NormalizedMessage) {
  const sameTimestamp = (left.timestamp <= 0 || right.timestamp <= 0)
    ? true
    : left.timestamp === right.timestamp
  return left.role === right.role
    && left.text === right.text
    && (left.contentText || '') === (right.contentText || '')
    && (left.toolText || '') === (right.toolText || '')
    && sameTimestamp
    && left.authorName === right.authorName
    && sameStringArray(left.images, right.images)
}

function sameMessageList(left: NormalizedMessage[], right: NormalizedMessage[]) {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (!sameMessage(left[index], right[index])) return false
  }
  return true
}

function normalizeAssistantIdentity(identity: GatewayAssistantIdentityPayload | null | undefined) {
  const rawName = typeof identity?.name === 'string' ? identity.name.trim() : ''
  const rawAvatar = typeof identity?.avatar === 'string' ? identity.avatar.trim() : ''
  const name = rawName || DEFAULT_ASSISTANT_NAME
  return {
    name: name.slice(0, 50),
    avatar: (rawAvatar || name || DEFAULT_ASSISTANT_AVATAR).slice(0, 200),
  }
}

function normalizeSessionKeyForDefaults(
  value: string | undefined,
  defaults: SessionDefaultsSnapshot | null,
): string {
  const raw = (value ?? '').trim()
  if (!defaults?.mainSessionKey?.trim()) {
    return raw
  }
  const mainSessionKey = defaults.mainSessionKey.trim()
  if (!raw) {
    return mainSessionKey
  }
  const mainKey = defaults.mainKey?.trim() || 'main'
  const defaultAgentId = defaults.defaultAgentId?.trim()
  const isAlias = raw === 'main'
    || raw === mainKey
    || (defaultAgentId
      && (raw === `agent:${defaultAgentId}:main` || raw === `agent:${defaultAgentId}:${mainKey}`))
  return isAlias ? mainSessionKey : raw
}

function resolveSessionKey() {
  const normalized = normalizeSessionKeyForDefaults(activeSessionKey, sessionDefaults)
  return normalized || DEFAULT_SESSION_KEY
}

function publishLiveSessionKeys() {
  useChatStore.setState({ liveSessionKeys: [...liveSessionKeys] })
}

function publishUnreadCompletedSessionKeys() {
  useChatStore.setState({ unreadCompletedSessionKeys: [...unreadCompletedSessionKeys] })
}

function publishLifecycleSessionState(sessionKey: string) {
  const normalized = sessionKey.trim()
  if (!normalized) return

  const nextState = {
    live: liveSessionKeys.has(normalized),
    unreadCompleted: unreadCompletedSessionKeys.has(normalized),
  }
  const previous = lifecycleSessionShadow.get(normalized)
  if (previous && previous.live === nextState.live && previous.unreadCompleted === nextState.unreadCompleted) {
    return
  }
  lifecycleSessionShadow.set(normalized, nextState)

  void publishLifecycleSession({
    sessionKey: normalized,
    live: nextState.live,
    unreadCompleted: nextState.unreadCompleted,
    source: 'chat-runtime',
  }).catch(() => {})
}

function resetSessionLifecycleState() {
  const sessionKeys = new Set<string>([
    ...liveSessionKeys,
    ...unreadCompletedSessionKeys,
    ...lifecycleSessionShadow.keys(),
  ])
  liveSessionKeys.clear()
  unreadCompletedSessionKeys.clear()
  publishLiveSessionKeys()
  publishUnreadCompletedSessionKeys()

  for (const key of sessionKeys) {
    lifecycleSessionShadow.set(key, { live: false, unreadCompleted: false })
    void publishLifecycleSession({
      sessionKey: key,
      live: false,
      unreadCompleted: false,
      source: 'chat-runtime',
    }).catch(() => {})
  }
}

function markSessionLive(sessionKey: string | null | undefined, live: boolean) {
  const normalized = (sessionKey ?? '').trim()
  if (!normalized) return
  const wasLive = liveSessionKeys.has(normalized)
  if (live) {
    liveSessionKeys.add(normalized)
  } else {
    liveSessionKeys.delete(normalized)
  }
  if (wasLive === live) return
  publishLiveSessionKeys()
  publishLifecycleSessionState(normalized)
}

function markSessionCompletedUnread(sessionKey: string | null | undefined, unread: boolean) {
  const normalized = (sessionKey ?? '').trim()
  if (!normalized) return
  const wasUnread = unreadCompletedSessionKeys.has(normalized)
  if (unread) {
    unreadCompletedSessionKeys.add(normalized)
  } else {
    unreadCompletedSessionKeys.delete(normalized)
  }
  if (wasUnread === unread) return
  publishUnreadCompletedSessionKeys()
  publishLifecycleSessionState(normalized)
}

function clearActiveRun(sessionKeyHint?: string | null) {
  const key = (sessionKeyHint ?? runSessionKeyRef ?? '').trim()
  if (key) {
    markSessionLive(key, false)
  }
  runIdRef = null
  runStartedAtRef = null
  runSessionKeyRef = null
  useChatStore.setState({
    runId: null,
    streamText: null,
    activeRunSessionKey: null,
  })
}

function parseSessionDefaultsFromHello(snapshot: unknown): SessionDefaultsSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object') {
    return null
  }
  const value = (snapshot as { sessionDefaults?: unknown }).sessionDefaults
  if (!value || typeof value !== 'object') {
    return null
  }
  const defaults = value as Record<string, unknown>
  const parsed: SessionDefaultsSnapshot = {
    defaultAgentId: typeof defaults.defaultAgentId === 'string' ? defaults.defaultAgentId : undefined,
    mainKey: typeof defaults.mainKey === 'string' ? defaults.mainKey : undefined,
    mainSessionKey: typeof defaults.mainSessionKey === 'string' ? defaults.mainSessionKey : undefined,
    scope: typeof defaults.scope === 'string' ? defaults.scope : undefined,
  }
  return parsed.mainSessionKey ? parsed : null
}

function ensureImageDataUrl(source: Record<string, unknown>) {
  const sourceType = typeof source.type === 'string' ? source.type : ''
  const mediaType = typeof source.media_type === 'string' ? source.media_type : 'image/png'

  if (sourceType === 'base64' && typeof source.data === 'string' && source.data.trim()) {
    const payload = source.data.trim()
    if (payload.startsWith('data:')) {
      return payload
    }
    return `data:${mediaType};base64,${payload}`
  }

  if (typeof source.url === 'string' && source.url.trim()) {
    return source.url.trim()
  }

  return null
}

function normalizeGatewayMessage(message: unknown): NormalizedMessage | null {
  if (!message || typeof message !== 'object') {
    return null
  }

  const raw = message as Record<string, unknown>
  const role = typeof raw.role === 'string' ? raw.role : 'assistant'
  const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : 0
  const id = typeof raw.id === 'string' ? raw.id : nextId()

  const contentTextParts: string[] = []
  const toolTextParts: string[] = []
  const images: string[] = []
  const rawAuthor = raw.author
  const authorName = typeof raw.name === 'string'
    ? raw.name
    : rawAuthor && typeof rawAuthor === 'object' && typeof (rawAuthor as Record<string, unknown>).name === 'string'
      ? String((rawAuthor as Record<string, unknown>).name)
      : null

  if (typeof raw.content === 'string') {
    contentTextParts.push(raw.content)
  } else if (Array.isArray(raw.content)) {
    const pushTextPart = (target: string[], value: unknown) => {
      if (typeof value !== 'string') return
      const trimmed = value.trim()
      if (!trimmed) return
      target.push(trimmed)
    }
    const pushJsonPart = (target: string[], value: unknown) => {
      if (value === null || value === undefined) return
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed) return
        target.push(trimmed)
        return
      }
      try {
        target.push(`\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``)
      } catch {
        // Ignore non-serializable payloads.
      }
    }

    for (const part of raw.content) {
      if (!part || typeof part !== 'object') continue
      const item = part as Record<string, unknown>
      const type = typeof item.type === 'string' ? item.type : ''
      const typeLower = type.toLowerCase()

      if (
        typeLower === 'text'
        || typeLower === 'input_text'
        || typeLower === 'output_text'
      ) {
        pushTextPart(contentTextParts, item.text)
        pushTextPart(contentTextParts, item.output_text)
        pushTextPart(contentTextParts, item.input_text)
        pushTextPart(contentTextParts, item.content)
        pushJsonPart(toolTextParts, item.args)
        pushJsonPart(toolTextParts, item.arguments)
        pushJsonPart(toolTextParts, item.result)
        pushJsonPart(toolTextParts, item.data)
        continue
      }

      if (
        typeLower === 'tool_result'
        || typeLower === 'toolresult'
        || typeLower === 'json'
        || typeLower === 'result'
      ) {
        pushTextPart(toolTextParts, item.text)
        pushTextPart(toolTextParts, item.output_text)
        pushTextPart(toolTextParts, item.input_text)
        pushTextPart(toolTextParts, item.content)
        pushJsonPart(toolTextParts, item.args)
        pushJsonPart(toolTextParts, item.arguments)
        pushJsonPart(toolTextParts, item.result)
        pushJsonPart(toolTextParts, item.data)
        continue
      }

      if ((typeLower === 'image' || typeLower === 'input_image') && item.source && typeof item.source === 'object') {
        const imageUrl = ensureImageDataUrl(item.source as Record<string, unknown>)
        if (imageUrl) images.push(imageUrl)
        continue
      }

      if ((typeLower === 'image' || typeLower === 'input_image') && typeof item.image_url === 'string') {
        images.push(item.image_url)
        continue
      }

      // Fallback: for unknown content item types, still attempt to recover textual payload.
      pushTextPart(contentTextParts, item.text)
      pushTextPart(contentTextParts, item.output_text)
      pushTextPart(contentTextParts, item.input_text)
      pushTextPart(contentTextParts, item.content)
      pushJsonPart(toolTextParts, item.args)
      pushJsonPart(toolTextParts, item.arguments)
      pushJsonPart(toolTextParts, item.result)
      pushJsonPart(toolTextParts, item.data)
      if (typeof item.tool_name === 'string' || typeof item.toolName === 'string') {
        pushTextPart(toolTextParts, `[Tool] ${String(item.tool_name ?? item.toolName)}`)
      }
    }
  }

  if (typeof raw.text === 'string') {
    contentTextParts.push(raw.text)
  }

  const contentText = contentTextParts.join('\n').trim()
  const toolText = toolTextParts.join('\n').trim()

  return {
    id,
    role,
    text: [contentText, toolText].filter(Boolean).join('\n').trim(),
    contentText,
    toolText,
    images,
    timestamp,
    authorName,
  }
}

function extractStreamText(message: unknown): string | null {
  const normalized = normalizeGatewayMessage(message)
  if (!normalized) return null
  return normalized.text
}

function parseDataUrlBase64(dataUrl: string): { mimeType: string; content: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl.trim())
  if (!match) {
    return null
  }
  return { mimeType: match[1], content: match[2] }
}

function updateRunSyncTimer() {
  const state = useChatStore.getState()
  const shouldRun = Boolean(client && state.connected && runIdRef)

  if (!shouldRun) {
    if (runSyncTimer !== null) {
      window.clearInterval(runSyncTimer)
      runSyncTimer = null
    }
    return
  }

  if (runSyncTimer !== null) {
    return
  }

  runSyncTimer = window.setInterval(() => {
    void loadHistory({ silent: true })
  }, 1400)
}

function updateBackgroundSyncTimer() {
  const state = useChatStore.getState()
  const shouldRun = Boolean(client && state.connected)

  if (!shouldRun) {
    if (backgroundSyncTimer !== null) {
      window.clearInterval(backgroundSyncTimer)
      backgroundSyncTimer = null
    }
    return
  }

  if (backgroundSyncTimer !== null) {
    return
  }

  backgroundSyncTimer = window.setInterval(() => {
    if (runIdRef || loadingHistory) {
      return
    }
    void loadHistory({ silent: true })
  }, 12_000)
}

function updateMessages(messages: NormalizedMessage[]) {
  const sorted = sortByTimestamp(messages)
  const current = useChatStore.getState().messages
  const latestAssistant = [...sorted]
    .reverse()
    .find((message) => message.role.toLowerCase() === 'assistant' && message.authorName?.trim())

  const patch: Partial<ReturnType<typeof useChatStore.getState>> = {}
  if (!sameMessageList(current, sorted)) {
    patch.messages = sorted
  }
  if (latestAssistant?.authorName) {
    const normalized = normalizeAssistantIdentity({ name: latestAssistant.authorName })
    if (normalized.name !== useChatStore.getState().assistantName) {
      patch.assistantName = normalized.name
    }
  }
  if (Object.keys(patch).length > 0) {
    console.debug('[chat-history]', 'updateMessages:setState', {
      currentCount: current.length,
      nextCount: sorted.length,
      patchKeys: Object.keys(patch),
      latestMessageRole: sorted.length ? sorted[sorted.length - 1]?.role : null,
      latestMessageId: sorted.length ? sorted[sorted.length - 1]?.id : null,
      latestMessageTs: sorted.length ? sorted[sorted.length - 1]?.timestamp : null,
    })
    useChatStore.setState(patch)
  } else {
    console.debug('[chat-history]', 'updateMessages:skip-no-change', {
      count: sorted.length,
    })
  }
}

function shouldReloadHistoryForFinalEvent(payload?: GatewayChatEventPayload): boolean {
  if (!payload || payload.state !== 'final') {
    return false
  }
  if (!payload.message || typeof payload.message !== 'object') {
    return true
  }
  const role = typeof (payload.message as Record<string, unknown>).role === 'string'
    ? String((payload.message as Record<string, unknown>).role).toLowerCase()
    : ''
  if (role && role !== 'assistant') {
    return true
  }
  return false
}

async function loadAssistantIdentity() {
  if (!client || !client.connected) {
    return
  }

  try {
    const sessionKey = resolveSessionKey()
    const params = sessionKey.trim() ? { sessionKey } : {}
    const result = await client.request<GatewayAssistantIdentityPayload>('agent.identity.get', params)
    const normalized = normalizeAssistantIdentity(result)
    useChatStore.setState({ assistantName: normalized.name, assistantAvatar: normalized.avatar })
  } catch {
    // keep latest identity/fallback
  }
}

async function loadHistory(options?: { silent?: boolean }) {
  if (!client || !client.connected) {
    return
  }
  const requestedSessionKey = resolveSessionKey()
  if (loadingHistory && loadingHistorySessionKey === requestedSessionKey) {
    return
  }

  loadingHistory = true
  loadingHistorySessionKey = requestedSessionKey
  const silent = Boolean(options?.silent)
  if (silent) {
    const now = Date.now()
    if (now - lastSilentHistoryAttemptAt < 1500) {
      loadingHistory = false
      return
    }
    // Prevent event storms from spamming history pulls while still allowing regular sync.
    if (lastHistorySyncAt > 0 && now - lastHistorySyncAt < 1800) {
      loadingHistory = false
      return
    }
    lastSilentHistoryAttemptAt = now
  }
  const isFirstHistoryLoad = !historyLoadedOnce
  let historyLoadedSuccessfully = false

  if (!silent) {
    useChatStore.setState({ loadingHistory: true, error: null })
  }

  try {
    console.debug('[chat-history]', 'loadHistory:start', {
      silent,
      historyLoadedOnce,
      runId: runIdRef,
      requestedSessionKey,
    })
    const result = await client.request<{ messages?: unknown[] }>('chat.history', {
      sessionKey: requestedSessionKey,
      limit: 200,
    })
    const normalized = Array.isArray(result.messages)
      ? result.messages
          .map((message) => normalizeGatewayMessage(message))
          .filter((message): message is NormalizedMessage => Boolean(message))
      : []

    // User may switch sessions while this request is in flight; ignore stale results.
    if (resolveSessionKey() !== requestedSessionKey) {
      return
    }

    updateMessages(normalized)
    lastHistorySyncAt = Date.now()
    historyLoadedSuccessfully = true
    console.debug('[chat-history]', 'loadHistory:done', {
      normalizedCount: normalized.length,
      silent,
      historyLoadedOnce,
      runId: runIdRef,
      requestedSessionKey,
    })

    if (runIdRef) {
      const startedAt = runStartedAtRef ?? 0
      const hasAssistantAfterRun = normalized.some(
        (message) => message.role.toLowerCase() === 'assistant' && message.timestamp >= startedAt,
      )
      if (hasAssistantAfterRun) {
        clearActiveRun(requestedSessionKey)
        updateRunSyncTimer()
        void flushQueue()
      }
    }
  } catch (error) {
    console.debug('[chat-history]', 'loadHistory:error', {
      error: String(error),
      silent,
      runId: runIdRef,
      requestedSessionKey,
    })
    useChatStore.setState({ error: String(error) })
  } finally {
    if (loadingHistorySessionKey === requestedSessionKey) {
      if (isFirstHistoryLoad && historyLoadedSuccessfully) {
        historyLoadedOnce = true
        useChatStore.setState({ historyReady: true })
      }
      if (!silent) {
        useChatStore.setState({ loadingHistory: false })
      }
      loadingHistory = false
      loadingHistorySessionKey = null
    }
  }
}

function handleChatEvent(event: GatewayEventFrame) {
  if (event.event !== 'chat') {
    return
  }

  const payload = event.payload as GatewayChatEventPayload | undefined
  if (!payload) {
    return
  }
  const incomingRunId = typeof payload.runId === 'string' && payload.runId.trim()
    ? payload.runId.trim()
    : null
  const incomingSessionKey = payload.sessionKey
    ? normalizeSessionKeyForDefaults(payload.sessionKey, sessionDefaults)
    : null

  if (incomingSessionKey && payload.state === 'delta') {
    markSessionLive(incomingSessionKey, true)
    markSessionCompletedUnread(incomingSessionKey, false)
  } else if (incomingSessionKey && (payload.state === 'final' || payload.state === 'aborted' || payload.state === 'error')) {
    markSessionLive(incomingSessionKey, false)
    markSessionCompletedUnread(incomingSessionKey, true)
  }

  if (payload.sessionKey) {
    const expectedSessionKey = resolveSessionKey()
    if (incomingSessionKey) {
      if (incomingSessionKey !== expectedSessionKey) {
        if (incomingRunId && runIdRef && incomingRunId === runIdRef && (payload.state === 'final' || payload.state === 'aborted' || payload.state === 'error')) {
          clearActiveRun(incomingSessionKey)
          updateRunSyncTimer()
          void flushQueue()
        }
        return
      }
      activeSessionKey = incomingSessionKey
    }
  }
  if (!payload.sessionKey && payload.runId && runIdRef && payload.runId !== runIdRef) {
    return
  }

  const activeRunId = runIdRef
  if (!incomingRunId) {
    // Ignore frames without runId to avoid cross-producer stream flicker.
    if (payload.state === 'final' || payload.state === 'aborted') {
      void loadHistory({ silent: true })
    }
    return
  }

  if (!activeRunId || incomingRunId !== activeRunId) {
    // No active local run or run mismatch: never mutate stream buffer directly.
    if (payload.state === 'final' || payload.state === 'aborted') {
      void loadHistory({ silent: true })
    }
    return
  }

  if (payload.state === 'delta') {
    const next = extractStreamText(payload.message)
    if (typeof next === 'string') {
      useChatStore.setState((state) => ({
        streamText: !state.streamText || next.length >= state.streamText.length ? next : state.streamText,
      }))
    }
    return
  }

  if (payload.state === 'final') {
    const finalMessage = normalizeGatewayMessage(payload.message)
    if (finalMessage) {
      updateMessages([...useChatStore.getState().messages, finalMessage])
    } else if (shouldReloadHistoryForFinalEvent(payload)) {
      void loadHistory()
    }
    clearActiveRun(incomingSessionKey)
    updateRunSyncTimer()
    void flushQueue()
    return
  }

  if (payload.state === 'aborted') {
    const abortedMessage = normalizeGatewayMessage(payload.message)
    if (abortedMessage) {
      updateMessages([...useChatStore.getState().messages, abortedMessage])
    }
    clearActiveRun(incomingSessionKey)
    updateRunSyncTimer()
    void flushQueue()
    return
  }

  if (payload.state === 'error') {
    clearActiveRun(incomingSessionKey)
    useChatStore.setState({
      error: payload.errorMessage ?? 'chat error',
    })
    updateRunSyncTimer()
    void flushQueue()
  }
}

async function connectClient(snapshot: OpenClawChatBootstrapSnapshot, options?: { forceReconnect?: boolean }) {
  if (!snapshot.canChat) {
    return
  }

  const endpointKey = `${snapshot.gatewayWsUrl}|${snapshot.gatewayToken}`
  const forceReconnect = Boolean(options?.forceReconnect)

  if (client && activeEndpointKey === endpointKey && !forceReconnect) {
    return
  }

  if (client) {
    client.stop()
    client = null
    activeEndpointKey = null
    updateRunSyncTimer()
    updateBackgroundSyncTimer()
  }

  historyLoadedOnce = false
  activeSessionKey = DEFAULT_SESSION_KEY
  sessionDefaults = null
  clearActiveRun(null)
  resetSessionLifecycleState()
  useChatStore.setState({
    error: null,
    historyReady: false,
    loadingHistory: false,
    liveSessionKeys: [],
    unreadCompletedSessionKeys: [],
  })

  const nextClient = new OpenClawGatewayClient({
    url: snapshot.gatewayWsUrl,
    token: snapshot.gatewayToken,
    onConnectedChange: (isConnected) => {
      if (client !== nextClient) {
        return
      }
      useChatStore.setState({ connected: isConnected })
      if (isConnected) {
        useChatStore.setState({ error: null })
        if (!historyLoadedOnce) {
          void loadHistory()
        }
        void loadAssistantIdentity()
      }
      updateRunSyncTimer()
      updateBackgroundSyncTimer()
    },
    onHello: (hello) => {
      if (client !== nextClient) {
        return
      }
      sessionDefaults = parseSessionDefaultsFromHello(hello?.snapshot) ?? null
      activeSessionKey = resolveSessionKey()
    },
    onEvent: (event) => {
      if (client !== nextClient) {
        return
      }
      handleChatEvent(event)
    },
    onError: (nextError) => {
      if (client !== nextClient) {
        return
      }
      useChatStore.setState({ error: nextError })
    },
    onClose: ({ code, reason, error }) => {
      if (client !== nextClient) {
        return
      }
      // 1012 = service restart, avoid noisy banner during intentional restarts.
      if (code === 1012) {
        return
      }
      const nextError = error?.message || `gateway closed (${code}): ${reason || 'no reason'}`
      useChatStore.setState({ error: nextError })
    },
  })

  client = nextClient
  activeEndpointKey = endpointKey
  nextClient.start()
}

export async function ensureChatRuntimeStarted() {
  if (startPromise) {
    return startPromise
  }

  startPromise = (async () => {
    useChatStore.setState({ bootstrapping: true })
    try {
      const snapshot = await loadOpenClawChatBootstrap()
      useChatStore.setState({
        bootstrap: snapshot,
        bootstrapping: false,
      })
      if (snapshot.canChat) {
        await connectClient(snapshot)
      }
    } catch (error) {
      useChatStore.setState({
        bootstrapping: false,
        error: String(error),
      })
    }
  })().finally(() => {
    startPromise = null
  })

  return startPromise
}

export async function refreshChatRuntime() {
  const snapshot = await loadOpenClawChatBootstrap({ force: true })
  useChatStore.setState({ bootstrap: snapshot })

  if (snapshot.canChat) {
    await connectClient(snapshot, { forceReconnect: true })
    await loadHistory()
  } else {
    useChatStore.setState({ connected: false })
    updateRunSyncTimer()
    updateBackgroundSyncTimer()
  }
}

export async function setActiveChatSessionKey(sessionKey: string) {
  const next = normalizeSessionKeyForDefaults(sessionKey, sessionDefaults) || DEFAULT_SESSION_KEY
  markSessionCompletedUnread(next, false)
  if (next === activeSessionKey && historyLoadedOnce) {
    return
  }

  activeSessionKey = next
  historyLoadedOnce = false
  lastHistorySyncAt = 0
  lastSilentHistoryAttemptAt = 0

  useChatStore.setState({
    loadingHistory: false,
    historyReady: false,
    messages: [],
    error: null,
    activeRunSessionKey: runSessionKeyRef,
  })

  updateRunSyncTimer()
  updateBackgroundSyncTimer()

  if (!client || !useChatStore.getState().connected) {
    return
  }

  await loadHistory()
  await loadAssistantIdentity()
}

export function markChatSessionAsRead(sessionKey?: string) {
  const normalized = normalizeSessionKeyForDefaults(
    (sessionKey ?? activeSessionKey ?? '').trim(),
    sessionDefaults,
  ) || DEFAULT_SESSION_KEY
  markSessionCompletedUnread(normalized, false)
}

export async function ensureChatHistoryFresh(options?: { maxAgeMs?: number }) {
  const maxAgeMs = options?.maxAgeMs ?? 8_000
  await ensureChatRuntimeStarted()

  if (!client || !useChatStore.getState().connected) {
    return
  }

  const age = Date.now() - lastHistorySyncAt
  if (!lastHistorySyncAt || age > maxAgeMs) {
    await loadHistory({ silent: true })
  }
}

async function sendNow(item: ChatQueueItem): Promise<boolean> {
  if (!client || !client.connected) {
    return false
  }

  const now = Date.now()
  const sessionKey = resolveSessionKey()
  const optimisticMessage: NormalizedMessage = {
    id: item.id,
    role: 'user',
    text: item.text,
    contentText: item.text,
    toolText: '',
    images: item.attachments.map((attachment) => attachment.dataUrl),
    timestamp: now,
  }

  updateMessages([...useChatStore.getState().messages, optimisticMessage])
  useChatStore.setState({ sending: true, error: null })

  const nextRunId = nextId()
  runIdRef = nextRunId
  runStartedAtRef = now
  runSessionKeyRef = sessionKey
  markSessionLive(sessionKey, true)
  markSessionCompletedUnread(sessionKey, false)
  useChatStore.setState({ runId: nextRunId, streamText: '', activeRunSessionKey: sessionKey })
  updateRunSyncTimer()

  const payloadAttachments = item.attachments
    .map((attachment) => {
      const parsed = parseDataUrlBase64(attachment.dataUrl)
      if (!parsed) {
        return null
      }
      return {
        type: 'image',
        mimeType: parsed.mimeType,
        content: parsed.content,
      }
    })
    .filter((attachment): attachment is { type: 'image'; mimeType: string; content: string } => attachment !== null)

  if (!item.text && item.attachments.length > 0 && payloadAttachments.length === 0) {
    useChatStore.setState({
      error: 'Attachment parse failed: invalid image data URL.',
    })
    return false
  }

  const outboundMessage = item.text

  try {
    await client.request('chat.send', {
      sessionKey,
      message: outboundMessage,
      deliver: false,
      idempotencyKey: nextRunId,
      attachments: payloadAttachments.length > 0 ? payloadAttachments : undefined,
    })
    return true
  } catch (error) {
    clearActiveRun(sessionKey)
    useChatStore.setState({
      error: error instanceof GatewayRequestError ? error.message : String(error),
    })
    updateRunSyncTimer()
    updateMessages([
      ...useChatStore.getState().messages,
      {
        id: nextId(),
        role: 'assistant',
        text: `Error: ${String(error)}`,
        images: [],
        timestamp: Date.now(),
      },
    ])
    return false
  } finally {
    useChatStore.setState({ sending: false })
  }
}

async function flushQueue() {
  const state = useChatStore.getState()
  if (!client || !state.connected || state.sending || runIdRef) {
    return
  }

  const next = queue[0]
  if (!next) {
    return
  }

  queue = queue.slice(1)
  useChatStore.setState({ queuedCount: queue.length })

  const ok = await sendNow(next)
  if (!ok) {
    queue = [next, ...queue]
    useChatStore.setState({ queuedCount: queue.length })
  }
}

export async function sendChatMessage(payload: { text: string; attachments: ChatAttachment[] }) {
  const state = useChatStore.getState()
  if (!client || !state.connected || !state.bootstrap?.canChat) {
    return false
  }

  const item: ChatQueueItem = {
    id: nextId(),
    text: payload.text.trim(),
    attachments: payload.attachments.map((attachment) => ({ ...attachment })),
  }

  if (state.sending || runIdRef) {
    queue = [...queue, item]
    useChatStore.setState({ queuedCount: queue.length })
    return true
  }

  return sendNow(item)
}

export async function abortChatRun() {
  if (!client || !useChatStore.getState().connected) {
    return
  }

  try {
    const sessionKey = resolveSessionKey()
    await client.request(
      'chat.abort',
      runIdRef
        ? { sessionKey, runId: runIdRef }
        : { sessionKey },
    )
  } catch (error) {
    useChatStore.setState({ error: String(error) })
  }
}

export function isChatStopCommand(text: string) {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return false
  return normalized === '/stop' || normalized === 'stop' || normalized === 'esc' || normalized === 'abort' || normalized === 'wait' || normalized === 'exit'
}
