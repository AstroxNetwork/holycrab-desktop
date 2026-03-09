import { tauriInvoke } from '@/lib/tauri'
import claudeRuntimeIcon from '@/assets/runtimes/claude.svg'
import codexRuntimeIcon from '@/assets/runtimes/codex.svg'
import openclawRuntimeIcon from '@/assets/runtimes/openclaw.svg'

export interface RuntimeStatus {
  id: 'openclaw' | 'codex' | 'claude' | 'workany' | string
  name: string
  command: string
  installed: boolean
  version?: string | null
  status: 'installed' | 'missing' | string
}

export interface RuntimeInstallChannel {
  id: 'cli' | 'desktop' | string
  label: string
  supported: boolean
  recommended: boolean
  note?: string | null
}

export interface RuntimeLaunchTarget {
  id: 'dashboard' | 'terminal' | 'desktop' | string
  label: string
  available: boolean
}

export type RuntimeActionKind = 'install' | 'uninstall' | 'upgrade' | 'open'
export type RuntimeActionPlatform = 'any' | 'darwin' | 'linux' | 'windows' | string
export type RuntimeActionArch = 'any' | 'arm64' | 'aarch64' | 'x64' | 'amd64' | string

interface RuntimeActionBase {
  id?: string | null
  platform?: RuntimeActionPlatform | null
  arch?: RuntimeActionArch | null
  note?: string | null
}

export interface RuntimePtyShellAction extends RuntimeActionBase {
  type: 'ptyShell'
  script: string
  timeoutSec?: number | null
}

export interface RuntimeExternalUrlAction extends RuntimeActionBase {
  type: 'externalUrl'
  url: string
}

export type RuntimeActionDef = RuntimePtyShellAction | RuntimeExternalUrlAction

export interface RuntimeActions {
  install?: RuntimeActionDef[]
  uninstall?: RuntimeActionDef[]
  upgrade?: RuntimeActionDef[]
  open?: RuntimeActionDef[]
}

export interface RuntimeCatalogItem {
  id: string
  name: string
  summary: string
  iconUrl?: string | null
  iconText?: string | null
  installChannels: RuntimeInstallChannel[]
  launchTargets: RuntimeLaunchTarget[]
  actions?: RuntimeActions
}

export interface RuntimeViewModel extends RuntimeStatus {
  summary: string
  iconUrl?: string | null
  iconText?: string | null
  installChannels: RuntimeInstallChannel[]
  launchTargets: RuntimeLaunchTarget[]
  actions?: RuntimeActions
}

interface SoftwareCenterCatalogEnvelope {
  source?: string
  catalog?: {
    runtimes?: RuntimeCatalogItem[]
  }
}

interface RuntimeOverviewCache {
  timestamp: number
  data: RuntimeViewModel[]
}

const priorityOrder = ['openclaw', 'codex', 'claude', 'workany']
const REMOTE_FETCH_TIMEOUT_MS = 2500
const RUNTIME_OVERVIEW_CACHE_KEY = 'holycrab.runtime-overview'
const RUNTIME_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000
const fallbackRuntimeCommandById: Record<string, string> = {
  openclaw: 'openclaw',
  codex: 'codex',
  claude: 'claude',
  workany: 'open -a WorkAny',
}
let runtimeCatalogCache: RuntimeCatalogItem[] | null = null
let runtimeCatalogFetchedAt = 0
let runtimeCatalogInFlight: Promise<RuntimeCatalogItem[]> | null = null
let runtimeOverviewInFlight: Promise<RuntimeViewModel[]> | null = null

const fallbackCatalog: Record<string, Omit<RuntimeCatalogItem, 'id'>> = {
  openclaw: {
    name: 'OpenClaw',
    summary: 'Local gateway and hooks runtime for your workflows.',
    iconUrl: openclawRuntimeIcon,
    iconText: 'OC',
    installChannels: [
      { id: 'cli', label: 'CLI', supported: true, recommended: true, note: 'Primary installation path.' },
      { id: 'desktop', label: 'Desktop App', supported: false, recommended: false, note: 'Coming soon.' },
    ],
    launchTargets: [
      { id: 'dashboard', label: 'Dashboard', available: true },
      { id: 'terminal', label: 'Terminal', available: true },
    ],
  },
  codex: {
    name: 'Codex',
    summary: 'Coding assistant for terminal and desktop workflows.',
    iconUrl: codexRuntimeIcon,
    iconText: 'CX',
    installChannels: [
      { id: 'cli', label: 'CLI', supported: true, recommended: true, note: null },
      { id: 'desktop', label: 'Desktop App', supported: true, recommended: false, note: null },
    ],
    launchTargets: [
      { id: 'terminal', label: 'Terminal', available: true },
      { id: 'desktop', label: 'Desktop', available: true },
    ],
  },
  claude: {
    name: 'Claude Code',
    summary: 'Agentic coding runtime with terminal-first usage.',
    iconUrl: claudeRuntimeIcon,
    iconText: 'CC',
    installChannels: [
      { id: 'cli', label: 'CLI', supported: true, recommended: true, note: null },
      { id: 'desktop', label: 'Desktop App', supported: true, recommended: false, note: null },
    ],
    launchTargets: [
      { id: 'terminal', label: 'Terminal', available: true },
      { id: 'desktop', label: 'Desktop', available: true },
    ],
  },
  workany: {
    name: 'WorkAny',
    summary: 'Desktop AI workspace with native macOS app downloads.',
    iconText: 'WA',
    installChannels: [
      {
        id: 'desktop',
        label: 'Desktop App',
        supported: true,
        recommended: true,
        note: 'Auto-selects Apple Silicon or Intel package.',
      },
    ],
    launchTargets: [{ id: 'desktop', label: 'App', available: true }],
  },
}

export async function fetchRuntimeCatalog(options?: { force?: boolean }) {
  const force = Boolean(options?.force)
  const now = Date.now()
  if (!force && runtimeCatalogCache && now - runtimeCatalogFetchedAt < RUNTIME_CATALOG_CACHE_TTL_MS) {
    return runtimeCatalogCache
  }

  if (!force && runtimeCatalogInFlight) {
    return runtimeCatalogInFlight
  }

  runtimeCatalogInFlight = (async () => {
    const remote = await fetchRuntimeCatalogFromServer()
    if (remote && remote.length > 0) {
      console.debug('[runtime-catalog] source=remote count=', remote.length)
      runtimeCatalogCache = remote
      runtimeCatalogFetchedAt = Date.now()
      return remote
    }
    const local = await tauriInvoke<RuntimeCatalogItem[]>('get_runtime_catalog').catch(() => [])
    if (local.length > 0) {
      console.debug('[runtime-catalog] source=local count=', local.length)
      runtimeCatalogCache = local
      runtimeCatalogFetchedAt = Date.now()
      return local
    }
    console.debug('[runtime-catalog] source=empty')
    runtimeCatalogCache = local
    runtimeCatalogFetchedAt = Date.now()
    return local
  })()

  try {
    return await runtimeCatalogInFlight
  } finally {
    runtimeCatalogInFlight = null
  }
}

export async function fetchRuntimeOverview(
  onPartial?: (partial: RuntimeViewModel[]) => void,
  options?: { forceStatuses?: boolean },
) {
  if (runtimeOverviewInFlight) {
    const cached = readRuntimeOverviewCache()
    if (onPartial && cached?.length) {
      onPartial(cached)
    }
    return runtimeOverviewInFlight
  }

  runtimeOverviewInFlight = (async () => {
    const catalog = await fetchRuntimeCatalog()
    if (onPartial) {
      const partial = mergeRuntimeData(placeholderStatusesFromCatalog(catalog), catalog)
      onPartial(partial)
    }

    const statuses = await tauriInvoke<RuntimeStatus[]>(
      options?.forceStatuses ? 'refresh_runtime_statuses' : 'get_runtime_statuses',
    )
    const merged = mergeRuntimeData(statuses, catalog)
    writeRuntimeOverviewCache(merged)
    return merged
  })()

  try {
    return await runtimeOverviewInFlight
  } finally {
    runtimeOverviewInFlight = null
  }
}

function placeholderStatusesFromCatalog(catalog: RuntimeCatalogItem[]): RuntimeStatus[] {
  return catalog.map((item) => ({
    id: item.id,
    name: item.name,
    command: fallbackRuntimeCommandById[item.id] || item.id,
    installed: false,
    version: null,
    status: 'checking',
  }))
}

export function mergeRuntimeData(statuses: RuntimeStatus[], catalog: RuntimeCatalogItem[]): RuntimeViewModel[] {
  const byId = new Map(catalog.map((item) => [item.id, item]))
  const merged: RuntimeViewModel[] = statuses.map((status) => {
    const meta = byId.get(status.id) ?? fallbackFromId(status.id, status.name)
    const fallbackMeta = fallbackFromId(status.id, status.name)
    return {
      ...status,
      name: meta.name ?? status.name,
      summary: meta.summary || fallbackMeta.summary,
      iconUrl: meta.iconUrl ?? fallbackMeta.iconUrl ?? null,
      iconText: meta.iconText ?? fallbackMeta.iconText ?? null,
      installChannels: meta.installChannels?.length ? meta.installChannels : fallbackMeta.installChannels,
      launchTargets: meta.launchTargets?.length ? meta.launchTargets : fallbackMeta.launchTargets,
      actions: meta.actions ?? fallbackMeta.actions,
    }
  })
  return sortRuntimeStatuses(merged)
}

function fallbackFromId(id: string, name: string): Omit<RuntimeCatalogItem, 'id'> {
  return fallbackCatalog[id] ?? {
    name,
    summary: 'Runtime configuration is not yet defined.',
    iconText: name.slice(0, 2).toUpperCase(),
    installChannels: [{ id: 'cli', label: 'CLI', supported: true, recommended: true, note: null }],
    launchTargets: [{ id: 'terminal', label: 'Terminal', available: true }],
  }
}

export function runtimeIconText(runtime: Pick<RuntimeViewModel, 'iconText' | 'name'>) {
  return (runtime.iconText?.trim() || runtime.name.slice(0, 2)).toUpperCase()
}

export function sortRuntimeStatuses<T extends RuntimeStatus>(items: T[]) {
  const ordered = [...items].sort((a, b) => {
    const aMissing = a.installed ? 1 : 0
    const bMissing = b.installed ? 1 : 0
    if (aMissing !== bMissing) return aMissing - bMissing
    const aIndex = priorityOrder.indexOf(a.id)
    const bIndex = priorityOrder.indexOf(b.id)
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex)
  })
  return ordered
}

export function runtimeOpenHint(runtime: Pick<RuntimeViewModel, 'launchTargets'>) {
  const preferred = runtime.launchTargets.find((target) => target.available)
  return preferred ? `Open ${preferred.label}` : 'Open'
}

export function preferredInstallChannel(runtime: Pick<RuntimeViewModel, 'installChannels'>) {
  return (
    runtime.installChannels.find((channel) => channel.supported && channel.recommended)
    ?? runtime.installChannels.find((channel) => channel.supported)
    ?? runtime.installChannels[0]
  )
}

export function readRuntimeOverviewCache() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(RUNTIME_OVERVIEW_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RuntimeOverviewCache
    if (!parsed || !Array.isArray(parsed.data)) return null
    return parsed.data
  } catch {
    return null
  }
}

function writeRuntimeOverviewCache(data: RuntimeViewModel[]) {
  if (typeof window === 'undefined') return
  try {
    const payload: RuntimeOverviewCache = {
      timestamp: Date.now(),
      data,
    }
    window.localStorage.setItem(RUNTIME_OVERVIEW_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // localStorage unavailable
  }
}

async function fetchRuntimeCatalogFromServer() {
  const urls = softwareCenterUrls()
  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(url, REMOTE_FETCH_TIMEOUT_MS)
      if (!response.ok) continue
      const payload = await response.json() as SoftwareCenterCatalogEnvelope
      const runtimes = payload.catalog?.runtimes
      if (Array.isArray(runtimes) && runtimes.length > 0) {
        return runtimes
      }
    } catch {
      continue
    }
  }
  return null
}

function softwareCenterUrls() {
  // Remote software-center fetch is intentionally disabled for local-only mode.
  return [] as string[]
}

function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { signal: controller.signal })
    .finally(() => window.clearTimeout(timer))
}
