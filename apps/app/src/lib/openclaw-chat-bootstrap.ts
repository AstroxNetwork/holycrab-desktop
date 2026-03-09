import {
  checkOpenClawReadiness,
  getOpenClawChatUrl,
  type OpenClawReadinessResult,
} from '@/lib/openclaw-handoff'

const DEFAULT_CHAT_URL = ''
const DEFAULT_GATEWAY_WS_URL = ''

export interface OpenClawChatBootstrapSnapshot {
  loadedAt: number
  readiness: OpenClawReadinessResult | null
  chatUrl: string
  gatewayWsUrl: string
  gatewayToken: string
  canChat: boolean
  errors: string[]
}

let bootstrapSnapshotCache: OpenClawChatBootstrapSnapshot | null = null
let bootstrapLoadPromise: Promise<OpenClawChatBootstrapSnapshot> | null = null

export function extractGatewayTokenFromUrl(urlValue: string | null | undefined) {
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

export function deriveGatewayWsUrlFromChatUrl(chatUrl: string | null | undefined) {
  const raw = (chatUrl || '').trim()
  if (!raw) return DEFAULT_GATEWAY_WS_URL
  try {
    const parsed = new URL(raw)
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
    parsed.pathname = '/'
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return DEFAULT_GATEWAY_WS_URL
  }
}

function buildSnapshot(
  readiness: OpenClawReadinessResult | null,
  chatUrlValue: string,
  errors: string[],
): OpenClawChatBootstrapSnapshot {
  const chatUrl = chatUrlValue.trim() || DEFAULT_CHAT_URL
  const gatewayToken = extractGatewayTokenFromUrl(chatUrl)
  const gatewayWsUrl = deriveGatewayWsUrlFromChatUrl(chatUrl)
  const canChat = Boolean(
    readiness
    && readiness.gatewayInstalled
    && readiness.gatewayRunning
    && readiness.portListening
    && readiness.chatReachable
    && gatewayToken,
  )

  return {
    loadedAt: Date.now(),
    readiness,
    chatUrl,
    gatewayWsUrl,
    gatewayToken,
    canChat,
    errors,
  }
}

export function getOpenClawChatBootstrapSnapshot() {
  return bootstrapSnapshotCache
}

export async function loadOpenClawChatBootstrap(options?: { force?: boolean }) {
  if (!options?.force && bootstrapSnapshotCache) {
    return bootstrapSnapshotCache
  }
  if (!options?.force && bootstrapLoadPromise) {
    return bootstrapLoadPromise
  }

  bootstrapLoadPromise = (async () => {
    const errors: string[] = []

  const [readinessResult, chatUrlResult] = await Promise.allSettled([
      checkOpenClawReadiness({ attemptFix: false }),
      getOpenClawChatUrl(),
    ])

    let readiness: OpenClawReadinessResult | null = null
    if (readinessResult.status === 'fulfilled') {
      readiness = readinessResult.value
    } else {
      errors.push(String(readinessResult.reason))
    }

    let chatUrl = DEFAULT_CHAT_URL
    if (chatUrlResult.status === 'fulfilled') {
      chatUrl = chatUrlResult.value
    } else {
      errors.push(String(chatUrlResult.reason))
    }

    const snapshot = buildSnapshot(readiness, chatUrl, errors)
    bootstrapSnapshotCache = snapshot
    bootstrapLoadPromise = null
    return snapshot
  })().catch((error) => {
    bootstrapLoadPromise = null
    throw error
  })

  return bootstrapLoadPromise
}

export function primeOpenClawChatBootstrap() {
  void loadOpenClawChatBootstrap()
}
