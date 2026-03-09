import { tauriInvoke } from '@/lib/tauri'
import { getDevRuntimeConfig } from '@/lib/dev-runtime-config'

export interface AnnouncementMedia {
  url: string
  alt: string
}

export interface AnnouncementItem {
  id: string
  title: string
  summary: string
  publishedAt: string
  coverImage?: string
  heroImage?: AnnouncementMedia
  contentMarkdown: string
  tags: string[]
  pin: boolean
}

export interface AnnouncementFeedData {
  url: string
  items: AnnouncementItem[]
}

const READ_IDS_STORAGE_KEY = 'holycrab.announcements.read.v1'

function sanitizeRemoteImageUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim()
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' || url.protocol === 'http:') return value
  } catch {
    return undefined
  }
  return undefined
}

function parseAnnouncementItem(raw: unknown): AnnouncementItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const id = typeof obj.id === 'string' ? obj.id.trim() : ''
  const title = typeof obj.title === 'string' ? obj.title.trim() : ''
  if (!id || !title) return null

  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : ''
  const contentMarkdown = typeof obj.contentMarkdown === 'string'
    ? obj.contentMarkdown
    : typeof obj.bodyMarkdown === 'string'
      ? obj.bodyMarkdown
      : typeof obj.content === 'string'
        ? obj.content
        : ''
  const tags = Array.isArray(obj.tags)
    ? obj.tags
      .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
      .filter((tag) => tag.length > 0)
    : []
  const publishedAtRaw = typeof obj.publishedAt === 'string' ? obj.publishedAt.trim() : ''
  const publishedAt = publishedAtRaw || new Date(0).toISOString()
  const coverImage = sanitizeRemoteImageUrl(obj.coverImage)
  const heroSource = obj.heroImage
  let heroImage: AnnouncementMedia | undefined
  if (heroSource && typeof heroSource === 'object' && !Array.isArray(heroSource)) {
    const heroObj = heroSource as Record<string, unknown>
    const heroUrl = sanitizeRemoteImageUrl(heroObj.url)
    if (heroUrl) {
      heroImage = {
        url: heroUrl,
        alt: typeof heroObj.alt === 'string' ? heroObj.alt.trim() : title,
      }
    }
  }

  return {
    id,
    title,
    summary,
    publishedAt,
    coverImage,
    heroImage,
    contentMarkdown: contentMarkdown.trim(),
    tags,
    pin: obj.pin === true,
  }
}

function normalizeAnnouncementFeed(payload: unknown): AnnouncementItem[] {
  const source = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).items)
      ? (payload as Record<string, unknown>).items as unknown[]
      : []
  const parsed = source
    .map((item) => parseAnnouncementItem(item))
    .filter((item): item is AnnouncementItem => item !== null)

  const seen = new Set<string>()
  const deduped = parsed.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })

  return deduped.sort((left, right) => {
    if (left.pin !== right.pin) return left.pin ? -1 : 1
    const leftTs = Date.parse(left.publishedAt)
    const rightTs = Date.parse(right.publishedAt)
    return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0)
  })
}

export async function fetchAnnouncementsFeed() {
  const feedUrl = getDevRuntimeConfig().announcementsFeedUrl.trim()
  const response = await tauriInvoke<{ url?: string; payload?: unknown }>('fetch_announcements_feed', {
    input: {
      feedUrl,
    },
  })
  const url = typeof response?.url === 'string' ? response.url.trim() : ''
  const payload = response?.payload
  return {
    url,
    items: normalizeAnnouncementFeed(payload),
  } satisfies AnnouncementFeedData
}

function parseReadIds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter((id) => id.length > 0)
  } catch {
    return []
  }
}

export function loadReadAnnouncementIds() {
  if (typeof window === 'undefined') return [] as string[]
  return parseReadIds(window.localStorage.getItem(READ_IDS_STORAGE_KEY))
}

export function saveReadAnnouncementIds(nextIds: string[]) {
  if (typeof window === 'undefined') return
  const deduped = Array.from(new Set(nextIds.map((id) => id.trim()).filter((id) => id.length > 0)))
  window.localStorage.setItem(READ_IDS_STORAGE_KEY, JSON.stringify(deduped))
}

export function markAnnouncementRead(id: string) {
  const trimmed = id.trim()
  if (!trimmed) return
  const next = loadReadAnnouncementIds()
  if (next.includes(trimmed)) return
  next.push(trimmed)
  saveReadAnnouncementIds(next)
}
