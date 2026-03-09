export type DeeplinkNavigationTarget =
  | {
    kind: 'internal'
    to: '/chat' | '/dashboard' | '/discover' | '/tts' | '/labs' | '/labs/companion' | '/labs/ollama-qwen35' | '/labs/star-office-ui' | '/keys' | '/settings' | '/setup-wizard' | '/redeem' | '/link'
    search?: Record<string, string>
  }
  | {
    kind: 'external'
    url: string
  }

type DeeplinkInternalRoute =
  '/chat' | '/dashboard' | '/discover' | '/tts' | '/labs' | '/labs/companion' | '/labs/ollama-qwen35' | '/labs/star-office-ui' | '/keys' | '/settings' | '/setup-wizard' | '/redeem' | '/link'

const INTERNAL_SCHEMES = new Set(['deep-link', 'deeplink', 'holycrab', 'openclaw'])

const CHAT_TABS = new Set(['system'])
const LABS_ID_ALIASES: Record<string, DeeplinkInternalRoute> = {
  // Short hash IDs (compact deep links):
  // deeplink:///labs/9f2a4b7c?...
  '9f2a4b7c': '/labs/ollama-qwen35',
  // deeplink:///labs/c7d31e84?...
  'c7d31e84': '/labs/star-office-ui',
}

const LABS_ALIASES: Record<string, DeeplinkInternalRoute> = {
  'tts': '/tts',
  'companion': '/labs/companion',
  'ollama': '/labs/ollama-qwen35',
  'star-office-ui': '/labs/star-office-ui',
  'star-office': '/labs/star-office-ui',
  'star': '/labs/star-office-ui',
}

function toInternalRoute(raw: string): DeeplinkInternalRoute | null {
  switch (raw) {
    case '/chat':
    case '/dashboard':
    case '/discover':
    case '/tts':
    case '/labs':
    case '/labs/ollama-qwen35':
    case '/labs/companion':
    case '/labs/star-office-ui':
    case '/keys':
    case '/settings':
    case '/setup-wizard':
    case '/redeem':
    case '/link':
      return raw
    default:
      if (raw.startsWith('/chat/')) return '/chat'
      if (raw.startsWith('/labs/')) return '/labs'
      return null
  }
}

function toSearchRecord(url: URL): Record<string, string> {
  const search: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    const normalizedValue = normalizeValue(value)
    if (normalizedValue) {
      search[normalizeValue(key)] = normalizedValue
    }
  })
  return search
}

function normalizeValue(value: string): string {
  return value.trim()
}

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase()
}

function buildInternalTarget(to: DeeplinkInternalRoute, search: Record<string, string> = {}): DeeplinkNavigationTarget {
  return {
    kind: 'internal',
    to,
    ...(Object.keys(search).length ? { search } : {}),
  }
}

function resolveLabsAlias(rawAlias: string | undefined): DeeplinkInternalRoute | null {
  if (!rawAlias) return null
  const key = normalizeAlias(rawAlias).replace(/[^0-9a-z-]/g, '')
  if (!key) return null
  if (LABS_ID_ALIASES[key]) {
    return LABS_ID_ALIASES[key]
  }
  if (key in LABS_ALIASES) {
    return LABS_ALIASES[key]
  }
  if (key.startsWith('labs-')) {
    const trimmed = key.slice('labs-'.length)
    return LABS_ALIASES[trimmed] ?? null
  }
  if (key.startsWith('subpage-')) {
    const trimmed = key.slice('subpage-'.length)
    return LABS_ALIASES[trimmed] ?? null
  }
  return null
}

function resolveAnnouncementTarget(segments: string[], search: Record<string, string>): DeeplinkNavigationTarget {
  const normalizedSegments = segments.map((segment) => normalizeAlias(segment)).filter(Boolean)
  const announcementId = search.announcement || normalizedSegments[0] || ''
  const target: Record<string, string> = { tab: 'system' }
  if (announcementId) {
    target.announcement = announcementId
  }
  return buildInternalTarget('/chat', target)
}

function resolveNumericOrSubpageAlias(rawAlias: string | undefined): DeeplinkInternalRoute | null {
  const route = resolveLabsAlias(rawAlias)
  return route
}

function stripLabsControlParams(search: Record<string, string>): Record<string, string> {
  const cleaned = { ...search }
  if (cleaned.id !== undefined) delete cleaned.id
  if (cleaned.subpage !== undefined) delete cleaned.subpage
  if (cleaned.alias !== undefined) delete cleaned.alias
  if (cleaned.to !== undefined) delete cleaned.to
  if (cleaned.lab !== undefined) delete cleaned.lab
  return cleaned
}

function resolveLabsTarget(segments: string[], search: Record<string, string>): DeeplinkNavigationTarget {
  const normalizedSegments = segments.map((segment) => normalizeAlias(segment)).filter(Boolean)
  const subpageAlias = resolveLabsAlias(search.id || search.subpage || search.alias || search.lab)
  if (subpageAlias) {
    return buildInternalTarget(subpageAlias, stripLabsControlParams(search))
  }

  const directSegmentAlias = resolveLabsAlias(normalizedSegments[0] || normalizedSegments[1])
  if (directSegmentAlias) {
    return buildInternalTarget(directSegmentAlias, stripLabsControlParams(search))
  }

  if (normalizedSegments.includes('ollama')) {
    return buildInternalTarget('/labs/ollama-qwen35', stripLabsControlParams(search))
  }

    if (normalizedSegments.includes('star') || normalizedSegments.includes('star-office') || normalizedSegments.includes('star-office-ui')) {
      return buildInternalTarget('/labs/star-office-ui', stripLabsControlParams(search))
    }
    if (normalizedSegments.includes('companion')) {
      return buildInternalTarget('/labs/companion', stripLabsControlParams(search))
    }

    return buildInternalTarget('/labs', search)
}

function resolveChatTarget(segments: string[], search: Record<string, string>): DeeplinkNavigationTarget {
  const target: Record<string, string> = { ...search }

  if (segments[0] && segments[0] !== 'chat') {
    if (segments[0] === 'system') {
      target.tab = 'system'
    } else {
      target.session = segments[0]
    }
  }

  const tab = normalizeAlias(target.tab || '')
  if (tab && CHAT_TABS.has(tab)) {
    target.tab = tab
  } else {
    delete target.tab
  }

  const session = normalizeAlias(target.session || '')
  if (session && session !== 'main') {
    target.session = session
  } else if (target.session) {
    target.session = 'main'
  }

  return buildInternalTarget('/chat', target)
}

function resolveNavigationFromAlias(alias: string, segments: string[], search: Record<string, string>): DeeplinkNavigationTarget | null {
  const aliasRoute = resolveLabsAlias(alias)
  if (aliasRoute) {
    return buildInternalTarget(aliasRoute, stripLabsControlParams(search))
  }

  switch (alias) {
    case 'tts':
      return buildInternalTarget('/tts')
    case 'chat':
      return resolveChatTarget(segments.slice(segments[0] === 'chat' ? 1 : 0), search)
    case 'main':
      return buildInternalTarget('/chat', { session: 'main' })
    case 'system':
      return buildInternalTarget('/chat', { tab: 'system' })
    case 'announcement':
    case 'announcements':
      return resolveAnnouncementTarget(segments, search)
    case 'dashboard':
    case 'software-center':
      return buildInternalTarget('/dashboard')
    case 'discover':
    case 'community':
      return buildInternalTarget('/discover')
    case 'labs': {
      return resolveLabsTarget(segments, search)
    }
    case 'companion': {
      return buildInternalTarget('/labs/companion', stripLabsControlParams(search))
    }
    case 'subpage': {
      const subpageRoute = resolveLabsAlias(segments[0])
      if (!subpageRoute) {
        return null
      }
      return buildInternalTarget(subpageRoute, stripLabsControlParams(search))
    }
    case 'keys':
      return buildInternalTarget('/keys')
    case 'settings':
      return buildInternalTarget('/settings')
    case 'setup':
    case 'wizard':
    case 'setup-wizard':
      return buildInternalTarget('/setup-wizard')
    case 'logs':
    case 'channels':
      return buildInternalTarget('/dashboard')
    case 'redeem': {
      const redeemSearch = { ...(search.code ? { code: search.code } : {}) }
      return buildInternalTarget('/redeem', redeemSearch)
    }
    case 'link':
      if (search.to) {
        return resolveNavigationFromAlias(normalizeAlias(search.to), [], {})
      }
      return buildInternalTarget('/link')
    default:
      if (alias.startsWith('session:')) {
        const session = alias.slice('session:'.length)
        return buildInternalTarget('/chat', { session })
      }
      return null
  }
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function parseDirectPath(path: string): DeeplinkNavigationTarget | null {
  const normalized = normalizeValue(path)
  if (!normalized) return null
  if (normalized.startsWith('#')) {
    const raw = normalized.slice(1)
    if (!raw.startsWith('/')) return null
    const [to, queryString] = raw.split('?', 2)
    const search = queryString ? Object.fromEntries(new URLSearchParams(queryString)) : {}
    const directAlias = resolveNumericOrSubpageAlias(to.startsWith('/') ? to.slice(1) : to)
    if (directAlias) {
      return buildInternalTarget(directAlias, stripLabsControlParams(search))
    }

    if (to === '/chat' || to.startsWith('/chat/')) {
      const parts = to.split('/').filter(Boolean)
      return resolveChatTarget(parts.slice(1), search)
    }

    if (to === '/announcement' || to.startsWith('/announcement/')) {
      const parts = to.split('/').filter(Boolean)
      return resolveAnnouncementTarget(parts.slice(1), search)
    }

    if (to === '/announcements' || to.startsWith('/announcements/')) {
      const parts = to.split('/').filter(Boolean)
      return resolveAnnouncementTarget(parts.slice(1), search)
    }

    if (to === '/labs' || to.startsWith('/labs/')) {
      const parts = to.split('/').filter(Boolean)
      return resolveLabsTarget(parts.slice(1), search)
    }

    const route = toInternalRoute(to)
    if (!route) {
      return null
    }
    return buildInternalTarget(route, stripLabsControlParams(search))
  }

  if (!normalized.startsWith('/')) return null
  const [pathPart, queryString] = normalized.split('?', 2)
  if (!pathPart.trim()) return null
  const search = queryString ? Object.fromEntries(new URLSearchParams(queryString)) : {}
  const directAlias = resolveNumericOrSubpageAlias(pathPart.startsWith('/') ? pathPart.slice(1) : pathPart)
  if (directAlias) {
    return buildInternalTarget(directAlias, stripLabsControlParams(search))
  }

    if (pathPart === '/chat' || pathPart.startsWith('/chat/')) {
      const parts = pathPart.split('/').filter(Boolean)
      return resolveChatTarget(parts.slice(1), search)
    }

    if (pathPart === '/announcement' || pathPart.startsWith('/announcement/')) {
      const parts = pathPart.split('/').filter(Boolean)
      return resolveAnnouncementTarget(parts.slice(1), search)
    }

    if (pathPart === '/announcements' || pathPart.startsWith('/announcements/')) {
      const parts = pathPart.split('/').filter(Boolean)
      return resolveAnnouncementTarget(parts.slice(1), search)
    }

    if (pathPart === '/labs' || pathPart.startsWith('/labs/')) {
      const parts = pathPart.split('/').filter(Boolean)
      return resolveLabsTarget(parts.slice(1), search)
  }

  const route = toInternalRoute(pathPart)
  if (!route) {
    return null
  }
  return buildInternalTarget(route, stripLabsControlParams(search))
}

export function parseDeeplinkTarget(raw: string): DeeplinkNavigationTarget {
  const source = normalizeValue(raw)
  if (!source) {
    return buildInternalTarget('/chat')
  }

  if (isHttpUrl(source)) {
    return { kind: 'external', url: source }
  }

  const directPath = parseDirectPath(source)
  if (directPath) {
    return directPath
  }

  try {
    const url = new URL(source)
    const scheme = url.protocol.replace(':', '').toLowerCase()
    const search = toSearchRecord(url)

    const explicitTo = normalizeAlias(search.to || '')
    const host = normalizeAlias(url.hostname)
    const segments = url.pathname
      .split('/')
      .map((part) => normalizeAlias(part))
      .filter(Boolean)

    const alias = explicitTo || host || segments[0] || ''
    const trimmedSegments = alias === host ? segments : segments.slice(1)
    if (!alias) {
      return { kind: 'external', url: source }
    }

    const fromAlias = resolveNavigationFromAlias(alias, trimmedSegments, search)
    if (fromAlias) {
      return fromAlias
    }

    if (!INTERNAL_SCHEMES.has(scheme) && !host) {
      return { kind: 'external', url: source }
    }

    if (alias === 'chat' || segments[0] === 'chat') {
      return resolveChatTarget(trimmedSegments, search)
    }
    if (alias === 'announcement' || alias === 'announcements' || segments[0] === 'announcement' || segments[0] === 'announcements') {
      return resolveAnnouncementTarget(trimmedSegments, search)
    }
    if (alias === 'labs' || segments[0] === 'labs') {
      return resolveLabsTarget(trimmedSegments, search)
    }

    return { kind: 'external', url: source }
  } catch {
    return { kind: 'external', url: source }
  }
}

export function toHashFromDeeplinkTarget(target: DeeplinkNavigationTarget): string {
  if (target.kind === 'external') {
    return ''
  }

  const searchPairs = target.search
    ? new URLSearchParams(target.search)
    : null
  const search = searchPairs && searchPairs.toString()
    ? `?${searchPairs.toString()}`
    : ''

  return `#${target.to}${search}`
}
