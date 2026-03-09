export interface DevRuntimeConfig {
  keyMarketplaceUrl: string
  discoverApiDealsUrl: string
  discoverGuidesUrl: string
  redeemApiBaseUrl: string
  announcementsFeedUrl: string
}

const STORAGE_KEY = 'holycrab.dev.runtime.config.v1'

function cleanString(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return trimmed.replace(/^['"]|['"]$/g, '')
}

function envValue(key: string): string {
  return cleanString(import.meta.env[key])
}

const DEFAULT_DEV_RUNTIME_CONFIG: DevRuntimeConfig = {
  keyMarketplaceUrl: envValue('VITE_KEY_MARKETPLACE_URL') || 'https://software-center.holycrab.ai/keys',
  discoverApiDealsUrl: envValue('VITE_DISCOVER_API_DEALS_URL') || 'https://openrouter.ai/models',
  discoverGuidesUrl: envValue('VITE_DISCOVER_GUIDES_URL'),
  redeemApiBaseUrl: envValue('VITE_REDEEM_API_BASE_URL') || 'https://kptbza.holycrab.ai',
  announcementsFeedUrl: envValue('HOLYCRAB_ANNOUNCEMENTS_FEED_URL'),
}

function safeLocalStorageGet(key: string): string | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeLocalStorageSet(key: string, value: string) {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(key, value)
  } catch {
    // Ignore localStorage failures.
  }
}

function safeLocalStorageRemove(key: string) {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(key)
  } catch {
    // Ignore localStorage failures.
  }
}

function parseStoredConfig(): Partial<DevRuntimeConfig> {
  const raw = safeLocalStorageGet(STORAGE_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record = parsed as Record<string, unknown>
    return {
      keyMarketplaceUrl: cleanString(record.keyMarketplaceUrl),
      discoverApiDealsUrl: cleanString(record.discoverApiDealsUrl),
      discoverGuidesUrl: cleanString(record.discoverGuidesUrl),
      redeemApiBaseUrl: cleanString(record.redeemApiBaseUrl),
      announcementsFeedUrl: cleanString(record.announcementsFeedUrl),
    }
  } catch {
    return {}
  }
}

function normalizeConfig(input: Partial<DevRuntimeConfig>): DevRuntimeConfig {
  return {
    keyMarketplaceUrl: cleanString(input.keyMarketplaceUrl) || DEFAULT_DEV_RUNTIME_CONFIG.keyMarketplaceUrl,
    discoverApiDealsUrl: cleanString(input.discoverApiDealsUrl) || DEFAULT_DEV_RUNTIME_CONFIG.discoverApiDealsUrl,
    discoverGuidesUrl: cleanString(input.discoverGuidesUrl),
    redeemApiBaseUrl: cleanString(input.redeemApiBaseUrl) || DEFAULT_DEV_RUNTIME_CONFIG.redeemApiBaseUrl,
    announcementsFeedUrl: cleanString(input.announcementsFeedUrl) || DEFAULT_DEV_RUNTIME_CONFIG.announcementsFeedUrl,
  }
}

function isTruthyFlag(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  const normalized = raw.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export function isDevOnlyMenuEnabled(): boolean {
  return isTruthyFlag(import.meta.env.VITE_DEV_ONLY_MENU)
}

export function getDefaultDevRuntimeConfig(): DevRuntimeConfig {
  return { ...DEFAULT_DEV_RUNTIME_CONFIG }
}

export function getDevRuntimeConfig(): DevRuntimeConfig {
  return normalizeConfig({ ...DEFAULT_DEV_RUNTIME_CONFIG, ...parseStoredConfig() })
}

export function setDevRuntimeConfig(next: Partial<DevRuntimeConfig>): DevRuntimeConfig {
  const merged = normalizeConfig({ ...getDevRuntimeConfig(), ...next })
  safeLocalStorageSet(STORAGE_KEY, JSON.stringify(merged))
  return merged
}

export function resetDevRuntimeConfig(): DevRuntimeConfig {
  safeLocalStorageRemove(STORAGE_KEY)
  return getDefaultDevRuntimeConfig()
}
