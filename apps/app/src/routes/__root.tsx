import { createRootRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ui/components/dialog'
import { Button } from '@ui/components/button'
import { useTheme } from '@ui/lib/theme'
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { BrushCleaning, Compass, FlaskConical } from 'lucide-react'
import holycrabIcon from '@/assets/brand/holycrab.png'
import telegramChannelIcon from '@/assets/channels/telegram.svg'
import feishuChannelIcon from '@/assets/channels/feishu.svg'
import discordChannelIcon from '@/assets/channels/discord.svg'
import slackChannelIcon from '@/assets/channels/slack.svg'
import imessageChannelIcon from '@/assets/channels/imessage.svg'
import whatsappChannelIcon from '@/assets/channels/whatsapp.svg'
import wechatChannelIcon from '@/assets/channels/wechat.svg'
import dingtalkChannelIcon from '@/assets/channels/dingtalk.svg'
import signalChannelIcon from '@/assets/channels/signal.svg'
import openclawRuntimeIcon from '@/assets/runtimes/openclaw.svg'
import {
  checkHolyCrabUpdate,
  getHolyCrabVersion,
  installHolyCrabUpdateAndRelaunch,
  predownloadHolyCrabUpdate,
  type UpdateProgress,
} from '@/lib/holycrab-updater'
import { useLocale } from '@/lib/locale-context'
import { ensureChatRuntimeStarted, markChatSessionAsRead } from '@/lib/chat-runtime'
import { isDevOnlyMenuEnabled } from '@/lib/dev-runtime-config'
import {
  getLifecycleSnapshot,
  listenLifecycleEvents,
  type LifecycleSessionState,
} from '@/lib/lifecycle-bus'
import { getOpenClawAgentSessions, type OpenClawAgentSessionItem } from '@/lib/openclaw-config'
import { useChatStore } from '@/stores/chat-store'
import { useLifecycleStore } from '@/stores/lifecycle-store'
import type { Update } from '@tauri-apps/plugin-updater'

function RootErrorComponent({ error }: { error: unknown }) {
  const errorMessage = error instanceof Error ? error.message : String(error)
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-lg border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive shadow-sm">
        <h1 className="mb-2 font-semibold">页面发生错误</h1>
        <p className="mb-2 break-all text-xs">{errorMessage}</p>
        <button
          type="button"
          className="rounded bg-destructive px-3 py-1 text-xs text-destructive-foreground"
          onClick={() => {
            window.location.reload()
          }}
        >
          重新加载
        </button>
      </div>
    </div>
  )
}

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RootErrorComponent,
})

type NavIconKind = 'chat' | 'labs' | 'discover' | 'software' | 'openclaw' | 'keys' | 'tts' | 'channels' | 'settings' | 'logs' | 'dev'
type AppRoute = '/chat' | '/dashboard' | '/community' | '/keys' | '/tts' | '/channels' | '/settings' | '/dev-config' | '/discover' | '/labs'
type NavGroup = 'chat' | 'dashboard' | 'community'
type NavTarget = { to: AppRoute; search?: Record<string, string> }

type SecondaryItem = {
  key: string
  to: AppRoute
  label: string
  description: string
  icon: NavIconKind
  badge?: string
  timeLabel?: string
  live?: boolean
  unreadCompleted?: boolean
  sessionChannel?: string
  sessionAvatarLabel?: string
  search?: Record<string, string>
  active: boolean
}

function resolveActiveGroup(pathname: string): NavGroup {
  if (pathname === '/chat') return 'chat'
  if (
    pathname === '/dashboard'
    || pathname === '/keys'
    || pathname === '/tts'
    || pathname === '/channels'
    || pathname === '/settings'
    || pathname === '/dev-config'
    || pathname === '/software-center'
    || pathname === '/logs'
  ) {
    return 'dashboard'
  }
  if (
    pathname === '/community'
    || pathname === '/discover'
    || pathname === '/labs'
    || pathname.startsWith('/labs/')
  ) {
    return 'community'
  }
  return 'chat'
}

function normalizeRouteForGroup(pathname: string): AppRoute {
  if (pathname === '/chat') return '/chat'
  if (pathname === '/dashboard' || pathname === '/software-center' || pathname === '/logs') return '/dashboard'
  if (pathname === '/channels') return '/channels'
  if (pathname === '/tts') return '/tts'
  if (pathname === '/keys') return '/keys'
  if (pathname === '/settings') return '/settings'
  if (pathname === '/dev-config') return '/dev-config'
  if (pathname === '/discover') return '/discover'
  if (pathname === '/labs' || pathname.startsWith('/labs/')) return '/labs'
  if (pathname === '/community') return '/discover'
  return '/chat'
}

function nextLocale(current: 'zh' | 'en') {
  return current === 'zh' ? 'en' : 'zh'
}

function readSearchParam(search: unknown, key: string): string {
  if (!search || !key) return ''
  if (typeof search === 'string') {
    const raw = search.startsWith('?') ? search.slice(1) : search
    return new URLSearchParams(raw).get(key)?.trim() ?? ''
  }
  if (typeof search === 'object') {
    const value = (search as Record<string, unknown>)[key]
    if (typeof value === 'string') return value.trim()
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) return item.trim()
      }
    }
  }
  return ''
}

function sameNavTarget(left: NavTarget, right: NavTarget) {
  if (left.to !== right.to) return false
  const leftSearch = left.search ?? {}
  const rightSearch = right.search ?? {}
  const leftKeys = Object.keys(leftSearch).sort()
  const rightKeys = Object.keys(rightSearch).sort()
  if (leftKeys.length !== rightKeys.length) return false
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index]
    if (key !== rightKeys[index]) return false
    if (leftSearch[key] !== rightSearch[key]) return false
  }
  return true
}

function sameSessionKey(left: string | null | undefined, right: string | null | undefined) {
  const a = (left ?? '').trim()
  const b = (right ?? '').trim()
  if (!a || !b) return false
  return isMainSessionAlias(a) && isMainSessionAlias(b) ? true : a === b
}

function sameKeyList(left: string[], right: string[]) {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function normalizeTimestampMs(raw: number | null | undefined): number | null {
  if (!Number.isFinite(raw) || !raw || raw <= 0) return null
  return raw < 1_000_000_000_000 ? raw * 1000 : raw
}

function isSameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

function formatTimeHHmm(value: Date): string {
  return new Intl.DateTimeFormat('default', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value)
}

function formatWeekday(value: Date, locale: 'zh' | 'en'): string {
  if (locale === 'zh') {
    const zhWeekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return zhWeekdays[value.getDay()] ?? ''
  }
  return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(value)
}

function formatMonthDay(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${month}/${day}`
}

function formatSessionTimeLabel(updatedAt: number | null | undefined, locale: 'zh' | 'en'): string | undefined {
  const timestampMs = normalizeTimestampMs(updatedAt)
  if (!timestampMs) return undefined
  const value = new Date(timestampMs)
  if (Number.isNaN(value.getTime())) return undefined

  const now = new Date()
  if (isSameDay(value, now)) {
    return formatTimeHHmm(value)
  }

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(value, yesterday)) {
    const prefix = locale === 'zh' ? '昨天' : 'Yesterday'
    return `${prefix} ${formatTimeHHmm(value)}`
  }

  const diffDays = Math.floor((now.getTime() - value.getTime()) / (24 * 60 * 60 * 1000))
  if (diffDays >= 0 && diffDays <= 6) {
    return formatWeekday(value, locale)
  }

  return formatMonthDay(value)
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

function stripSessionPreviewMarkers(raw: string): string {
  let current = raw.trim()
  while (current.startsWith('[')) {
    let token = ''
    let rest = current
    if (current.startsWith('[[')) {
      const end = current.indexOf(']]')
      if (end < 0) return current
      token = current.slice(2, end).trim().toLowerCase()
      rest = current.slice(end + 2).trimStart()
    } else {
      const end = current.indexOf(']')
      if (end < 0) return current
      token = current.slice(1, end).trim().toLowerCase()
      rest = current.slice(end + 1).trimStart()
    }

    const isMetaToken = token.startsWith('reply_to')
      || token.startsWith('agent:')
      || token.startsWith('chat:group:')
      || token.startsWith('mochat group:')
      || token.startsWith('group:')
    if (!isMetaToken) return current
    current = rest
  }
  return current
}

function looksLikeSessionLocator(raw: string): boolean {
  const compact = raw.trim()
  if (!compact || compact.includes(' ')) return false
  const lower = compact.toLowerCase()
  if (lower.startsWith('agent:') || lower.startsWith('session:') || lower.startsWith('chat:')) {
    return true
  }
  const colonCount = (compact.match(/:/g) ?? []).length
  if (colonCount < 2) return false
  if (!/[a-z]/i.test(compact)) return false
  return /^[a-z0-9:_./#-]+$/i.test(compact)
}

function normalizeSessionPreview(raw: string): string {
  return stripSessionPreviewMarkers(raw).replace(/\s+/g, ' ').trim()
}

function isToolActivityPreview(raw: string): boolean {
  const compact = raw.trim().toLowerCase()
  if (!compact) return false
  return compact.includes('tool activity')
    || compact.includes('tool call')
    || compact.includes('tool_call')
    || compact.includes('calling tool')
    || compact.includes('tool running')
    || compact.includes('工具调用')
    || compact.includes('工具执行')
    || compact.includes('调用工具')
}

function normalizeSessionChannel(raw: string): string {
  const compact = raw.trim().toLowerCase().replace(/[\s_-]/g, '')
  if (!compact) return 'main'
  if (compact === 'main') return 'main'
  if (compact === 'telegram') return 'telegram'
  if (compact === 'feishu' || compact === 'lark') return 'feishu'
  if (compact === 'discord') return 'discord'
  if (compact === 'slack') return 'slack'
  if (compact === 'imessage') return 'imessage'
  if (compact === 'whatsapp') return 'whatsapp'
  if (compact === 'wechat') return 'wechat'
  if (compact === 'dingtalk') return 'dingtalk'
  if (compact === 'signal') return 'signal'
  return compact
}

function toAvatarAbbr(value: string): string {
  const normalized = value.trim()
  if (!normalized) return '?'
  const pieces = normalized.split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/).filter(Boolean)
  if (pieces.length >= 2) {
    return `${pieces[0].charAt(0)}${pieces[1].charAt(0)}`.toUpperCase()
  }
  const first = pieces[0] ?? normalized
  if (/^[\u4e00-\u9fa5]/.test(first)) {
    return first.charAt(0)
  }
  const compact = first.replace(/[^a-zA-Z0-9]/g, '')
  if (!compact) return normalized.charAt(0).toUpperCase()
  return compact.slice(0, 2).toUpperCase()
}

function resolveSessionChannel(session: OpenClawAgentSessionItem): string {
  const candidates = [
    session.channel,
    extractScopeFromSessionKey(session.key),
    session.agentId,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return normalizeSessionChannel(candidate)
    }
  }
  return 'main'
}

const sessionChannelIconMap: Record<string, string> = {
  telegram: telegramChannelIcon,
  feishu: feishuChannelIcon,
  discord: discordChannelIcon,
  slack: slackChannelIcon,
  imessage: imessageChannelIcon,
  whatsapp: whatsappChannelIcon,
  wechat: wechatChannelIcon,
  dingtalk: dingtalkChannelIcon,
  signal: signalChannelIcon,
}

function SessionListAvatar({
  channel,
  label,
  active,
}: {
  channel?: string
  label?: string
  active: boolean
}) {
  const normalizedChannel = normalizeSessionChannel(channel || '')
  if (normalizedChannel === 'main') {
    return (
      <span
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
          active ? 'border-primary/45 bg-primary/10' : 'border-border/45 bg-card/45'
        }`}
      >
        <img src={holycrabIcon} alt="" className="h-[18px] w-[18px] rounded object-contain" />
      </span>
    )
  }

  const icon = sessionChannelIconMap[normalizedChannel]
  if (icon) {
    return (
      <span
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
          active ? 'border-primary/45 bg-primary/10' : 'border-border/45 bg-card/45'
        }`}
      >
        <img src={icon} alt="" className="h-[18px] w-[18px] object-contain opacity-90 dark:invert dark:opacity-95" />
      </span>
    )
  }

  return (
    <span
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[11px] font-semibold tracking-wide ${
        active
          ? 'border-primary/45 bg-primary/10 text-primary'
          : 'border-border/45 bg-card/45 text-muted-foreground'
      }`}
    >
      {toAvatarAbbr(label || channel || '?')}
    </span>
  )
}

function SidebarIcon({ kind, className = 'h-4 w-4' }: { kind: NavIconKind; className?: string }) {
  if (kind === 'chat') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path d="M6 6.8h12a2.2 2.2 0 0 1 2.2 2.2v5.5a2.2 2.2 0 0 1-2.2 2.2h-5.3l-3.5 2.8v-2.8H6A2.2 2.2 0 0 1 3.8 14.5V9A2.2 2.2 0 0 1 6 6.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8 10.7h8M8 13.6h5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'discover') {
    return <Compass className={className} />
  }
  if (kind === 'labs') {
    return <FlaskConical className={className} />
  }
  if (kind === 'software') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    )
  }
  if (kind === 'openclaw') {
    return <img src={openclawRuntimeIcon} alt="" className={`${className} object-contain`} />
  }
  if (kind === 'keys') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path d="M7 14a5 5 0 1 1 4.6 3H10l-2 2H6v-2l2-2V14Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" />
      </svg>
    )
  }
  if (kind === 'channels') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path d="M5.2 7.5a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6Zm13.6 0a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6ZM12 14.6a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M7.4 10.3h9.2M6.8 11.2l3.9 4M17.2 11.2l-3.9 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'settings') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path d="M5 7h14M5 17h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="9" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="15" cy="17" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    )
  }
  if (kind === 'tts') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path d="M12 3.5c-2.7 0-4.9 2.2-4.9 4.9v5.8a4.9 4.9 0 1 0 9.8 0V8.4c0-2.7-2.2-4.9-4.9-4.9Zm0 0v-1.5m0 16.8v1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M6.9 8.9a4.9 4.9 0 0 1 5.6 0m-5.6 2.4a5 5 0 0 1 5.6 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (kind === 'logs') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <rect x="5" y="4" width="14" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 9h8M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'dev') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path d="M9 3h6l1.2 2.2 2.7.5-1.9 2.2.4 2.9-2.7-.9-1.7 2-1.7-2-2.7.9.4-2.9-1.9-2.2 2.7-.5L9 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M7 14.8h10v3.7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 18.5v-3.7Z" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    )
  }
  return null
}

function RootLayout() {
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const { locale, setLocale, t } = useLocale()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const routeSearch = useRouterState({ select: (state) => state.location.search as unknown })
  const inWizard = pathname === '/setup-wizard'
  const inRedeem = pathname === '/redeem'
  const hashPath = typeof window === 'undefined' ? '' : window.location.hash
  const inCompanionFloatingWindow = pathname === '/companion/floating'
    || window.location.pathname.includes('/companion/floating')
    || window.location.hash.includes('/companion/floating')
    || readSearchParam(routeSearch, 'floatingWindow') === '1'
    || readSearchParam(window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '', 'floatingWindow') === '1'
    || hashPath.startsWith('#/companion/floating')
    || window.location.href.includes('/#/companion/floating')
    || window.location.href.includes('#/companion/floating')
  const hideChrome = inWizard || inRedeem || inCompanionFloatingWindow || (pathname === '/keys' && isWizardMode(routeSearch))
  const forceMainScrollbar =
    pathname === '/dashboard'
    || pathname === '/software-center'
    || pathname === '/settings'
    || pathname === '/tts'
    || pathname === '/channels'
    || pathname === '/dev-config'
    || pathname === '/keys'
    || pathname === '/community'
  const mainRef = useRef<HTMLElement | null>(null)
  const [mainOverflow, setMainOverflow] = useState(false)
  const [holyCrabVersion, setHolyCrabVersion] = useState<string>('-')

  const [updateAvailableVersion, setUpdateAvailableVersion] = useState<string | null>(null)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [updateFlowState, setUpdateFlowState] = useState<
    'idle' | 'checking' | 'no_update' | 'downloading' | 'installing' | 'error'
  >('idle')
  const [updateFlowError, setUpdateFlowError] = useState<string | null>(null)
  const [updateFlowProgress, setUpdateFlowProgress] = useState<UpdateProgress>({
    status: 'idle',
    downloadedBytes: 0,
  })
  const lifecycleSessionsRef = useRef<Map<string, LifecycleSessionState>>(new Map())
  const liveSessionKeys = useChatStore((state) => state.liveSessionKeys)
  const unreadCompletedSessionKeys = useChatStore((state) => state.unreadCompletedSessionKeys)

  // When an update is available, we keep a prefetched `Update` resource (and its downloaded bytes)
  // so the user can install immediately without waiting for download at click time.
  const prefetchedUpdateRef = useRef<Update | null>(null)
  const [prefetchProgress, setPrefetchProgress] = useState<UpdateProgress>({
    status: 'idle',
    downloadedBytes: 0,
  })

  const groupNavItems: Array<{ group: NavGroup; to: '/chat' | '/dashboard' | '/community'; label: string; icon: NavIconKind }> = [
    { group: 'chat', to: '/chat', label: t('nav.chat'), icon: 'chat' },
    { group: 'dashboard', to: '/dashboard', label: t('nav.softwareCenter'), icon: 'software' },
    { group: 'community', to: '/community', label: t('nav.community'), icon: 'discover' },
  ]
  const activeGroup = resolveActiveGroup(pathname)
  const activeRoute = normalizeRouteForGroup(pathname)
  const mockUpdateEnabled = import.meta.env.DEV && readSearchParam(routeSearch, 'mockUpdate') === '1'
  const displayUpdateVersion = updateAvailableVersion ?? (mockUpdateEnabled ? '9.9.9-mock' : null)
  const chatSearchSessionRaw = readSearchParam(routeSearch, 'session') || 'main'
  const chatSearchSession = isMainSessionAlias(chatSearchSessionRaw) ? 'main' : chatSearchSessionRaw
  const chatSearchTab = readSearchParam(routeSearch, 'tab')
  const isSessionLive = useCallback((sessionKey: string) => {
    return liveSessionKeys.some((key) => sameSessionKey(key, sessionKey))
  }, [liveSessionKeys])
  const isSessionUnreadCompleted = useCallback((sessionKey: string) => {
    return unreadCompletedSessionKeys.some((key) => sameSessionKey(key, sessionKey))
  }, [unreadCompletedSessionKeys])
  const [secondaryFilter, setSecondaryFilter] = useState('')
  const [chatSessions, setChatSessions] = useState<OpenClawAgentSessionItem[]>([])
  const mainSession = chatSessions.find((session) => isMainSessionAlias(session.key))
  const mainSessionPreview = typeof mainSession?.preview === 'string'
    ? normalizeSessionPreview(mainSession.preview)
    : ''
  const mainSessionToolActive = typeof mainSession?.preview === 'string'
    ? isToolActivityPreview(mainSession.preview)
    : false
  const defaultTargetByGroup: Record<NavGroup, NavTarget> = {
    chat: { to: '/chat' },
    dashboard: { to: '/dashboard' },
    community: { to: '/discover' },
  }
  const [lastTargetByGroup, setLastTargetByGroup] = useState<Record<NavGroup, NavTarget>>(defaultTargetByGroup)
  const hasUnreadSessionIndicators = unreadCompletedSessionKeys.length > 0

  const loadChatSessions = useCallback(async () => {
    try {
      const snapshot = await getOpenClawAgentSessions()
      setChatSessions(Array.isArray(snapshot.sessions) ? snapshot.sessions : [])
    } catch (error) {
      console.error(error)
    }
  }, [])

  const syncSessionIndicatorsFromLifecycle = useCallback(() => {
    const sessions = [...lifecycleSessionsRef.current.values()]
      .sort((left, right) => right.updatedAtUnixMs - left.updatedAtUnixMs)
    const nextLive = sessions
      .filter((session) => session.live)
      .map((session) => session.sessionKey)
    const nextUnread = sessions
      .filter((session) => session.unreadCompleted)
      .map((session) => session.sessionKey)

    const current = useChatStore.getState()
    if (
      sameKeyList(current.liveSessionKeys, nextLive)
      && sameKeyList(current.unreadCompletedSessionKeys, nextUnread)
    ) {
      return
    }
    useChatStore.setState({
      liveSessionKeys: nextLive,
      unreadCompletedSessionKeys: nextUnread,
    })
  }, [])

  const applyLifecycleSession = useCallback((session: LifecycleSessionState | null | undefined) => {
    if (!session) return
    const key = session?.sessionKey?.trim()
    if (!key) return
    lifecycleSessionsRef.current.set(key, {
      sessionKey: key,
      live: Boolean(session.live),
      unreadCompleted: Boolean(session.unreadCompleted),
      updatedAtUnixMs: Number.isFinite(session.updatedAtUnixMs) ? session.updatedAtUnixMs : Date.now(),
      source: session.source ?? null,
    })
    syncSessionIndicatorsFromLifecycle()
  }, [syncSessionIndicatorsFromLifecycle])

  const secondaryItemsByGroup: Record<NavGroup, SecondaryItem[]> = {
    chat: [
      {
        key: 'chat-system',
        to: '/chat',
        search: { tab: 'system' },
        label: locale === 'zh' ? '系统消息' : 'System Messages',
        description: locale === 'zh' ? '公告、更新与产品消息' : 'Announcements, updates, and product messages',
        icon: 'chat',
        active: pathname === '/chat' && chatSearchTab === 'system',
      },
      {
        key: 'chat-main-session',
        to: '/chat',
        search: { session: 'main' },
        label: 'Main:main',
        description: mainSessionPreview || (locale === 'zh' ? '默认主会话' : 'Default main session'),
        icon: 'chat',
        sessionChannel: 'main',
        sessionAvatarLabel: 'Main',
        timeLabel: formatSessionTimeLabel(mainSession?.updatedAt, locale === 'zh' ? 'zh' : 'en'),
        live: isSessionLive('main') || mainSessionToolActive,
        unreadCompleted: isSessionUnreadCompleted('main'),
        active: pathname === '/chat' && chatSearchTab !== 'system' && chatSearchSession === 'main',
      },
      ...chatSessions
        .filter((session) => !isMainSessionAlias(session.key))
        .map<SecondaryItem>((session) => {
        const scopeRaw = (session.channel || extractScopeFromSessionKey(session.key) || session.agentId || 'main').trim()
        const scope = scopeRaw ? `${scopeRaw.charAt(0).toUpperCase()}${scopeRaw.slice(1)}` : 'Main'
        const sessionShort = session.sessionId.slice(0, 8)
        const title = typeof session.title === 'string' && session.title.trim()
          ? session.title.trim()
          : session.key
        const preview = typeof session.preview === 'string'
          ? normalizeSessionPreview(session.preview)
          : ''
        const toolActive = typeof session.preview === 'string'
          ? isToolActivityPreview(session.preview)
          : false
        const cleanTitle = normalizeSessionPreview(title)
        const model = typeof session.model === 'string' ? session.model.trim() : ''
        const fallbackDescription = (!looksLikeSessionLocator(cleanTitle) && cleanTitle)
          || model
          || (locale === 'zh' ? '暂无消息' : 'No recent messages')
        const sessionChannel = resolveSessionChannel(session)
        return {
          key: `chat-session:${session.key}`,
          to: '/chat' as AppRoute,
          search: { session: session.key },
          label: `${scope}:${sessionShort}`,
          description: preview || fallbackDescription,
          icon: 'chat',
          sessionChannel,
          sessionAvatarLabel: scopeRaw || session.key,
          timeLabel: formatSessionTimeLabel(session.updatedAt, locale === 'zh' ? 'zh' : 'en'),
          live: isSessionLive(session.key) || toolActive,
          unreadCompleted: isSessionUnreadCompleted(session.key),
          active: pathname === '/chat' && chatSearchTab !== 'system' && chatSearchSession === session.key,
        }
      }),
    ],
    dashboard: [
      {
        key: 'dashboard-console',
        to: '/dashboard',
        label: locale === 'zh' ? 'OpenClaw 设置' : 'OpenClaw Settings',
        description: locale === 'zh' ? 'Gateway、Agent、Runtime 状态' : 'Gateway, Agent, and Runtime status',
        icon: 'openclaw',
        active: activeRoute === '/dashboard',
      },
      {
        key: 'dashboard-keys',
        to: '/keys',
        label: t('nav.keys'),
        description: locale === 'zh' ? 'Provider keys 与模型配置' : 'Provider keys and model configuration',
        icon: 'keys',
        active: activeRoute === '/keys',
      },
      {
        key: 'dashboard-tts',
        to: '/tts',
        label: t('nav.tts'),
        description: locale === 'zh' ? '语音模型设置与测试' : 'Voice model settings and playback testing',
        icon: 'tts',
        active: activeRoute === '/tts',
      },
      {
        key: 'dashboard-channels',
        to: '/channels',
        label: t('nav.channels'),
        description: locale === 'zh' ? '渠道配置与测试' : 'Channel config and tests',
        icon: 'channels',
        active: activeRoute === '/channels',
      },
      {
        key: 'dashboard-settings',
        to: '/settings',
        label: t('nav.settings'),
        description: locale === 'zh' ? '系统与安全设置' : 'System and security settings',
        icon: 'settings',
        active: activeRoute === '/settings',
      },
    ],
    community: [
      {
        key: 'community-labs',
        to: '/labs',
        label: locale === 'zh' ? '实验区' : 'Labs',
        description: locale === 'zh' ? '有潜力的实验性功能，一起挖掘' : 'Promising experimental features to explore together',
        icon: 'labs',
        badge: 'Beta',
        active: activeRoute === '/labs',
      },
      {
        key: 'community-discover',
        to: '/discover',
        label: t('nav.discover'),
        description: locale === 'zh' ? '活动、兑换与连接引导' : 'Events, redeem, and connection guidance',
        icon: 'discover',
        active: activeRoute === '/discover',
      },
    ],
  }

  if (isDevOnlyMenuEnabled()) {
    secondaryItemsByGroup.dashboard.push({
      key: 'dashboard-dev',
      to: '/dev-config',
      label: 'Dev',
      description: 'Dev Runtime Config',
      icon: 'dev',
      active: activeRoute === '/dev-config',
    })
  }

  const onSwitchGroup = (group: NavGroup) => {
    const target = lastTargetByGroup[group] || defaultTargetByGroup[group]
    if (target.search && Object.keys(target.search).length > 0) {
      void navigate({ to: target.to, search: target.search as never })
      return
    }
    void navigate({ to: target.to })
  }

  useEffect(() => {
    setSecondaryFilter('')
  }, [activeGroup])

  useEffect(() => {
    void loadChatSessions()
  }, [loadChatSessions])

  useEffect(() => {
    if (activeGroup !== 'chat') return
    const timer = window.setInterval(() => {
      void loadChatSessions()
    }, 12_000)
    return () => {
      window.clearInterval(timer)
    }
  }, [activeGroup, loadChatSessions])

  useEffect(() => {
    const onFocus = () => {
      void loadChatSessions()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
    }
  }, [loadChatSessions])

  useEffect(() => {
    const group = resolveActiveGroup(pathname)
    const route = normalizeRouteForGroup(pathname) as AppRoute
    const nextTarget: NavTarget = { to: route }
    if (group === 'chat' && route === '/chat') {
      if (chatSearchTab === 'system') {
        nextTarget.search = { tab: 'system' }
      } else if (chatSearchSession && chatSearchSession !== 'main') {
        nextTarget.search = { session: chatSearchSession }
      }
    }
    setLastTargetByGroup((prev) => {
      const current = prev[group]
      if (current && sameNavTarget(current, nextTarget)) return prev
      return { ...prev, [group]: nextTarget }
    })
  }, [pathname, chatSearchSession, chatSearchTab])

  const onSelectSecondaryItem = (item: SecondaryItem) => {
    if (item.search && Object.keys(item.search).length > 0) {
      void navigate({ to: item.to, search: item.search as never })
      return
    }
    void navigate({ to: item.to })
  }

  const clearUnreadSessionIndicators = useCallback(() => {
    if (!hasUnreadSessionIndicators) return

    const unreadKeys = unreadCompletedSessionKeys
      .map((key) => key.trim())
      .filter(Boolean)

    for (const sessionKey of unreadKeys) {
      markChatSessionAsRead(sessionKey)
    }

    if (lifecycleSessionsRef.current.size > 0) {
      const now = Date.now()
      const nextMap = new Map<string, LifecycleSessionState>()
      for (const [key, session] of lifecycleSessionsRef.current.entries()) {
        nextMap.set(key, {
          ...session,
          unreadCompleted: false,
          updatedAtUnixMs: now,
          source: 'sidebar',
        })
      }
      lifecycleSessionsRef.current = nextMap
      syncSessionIndicatorsFromLifecycle()
    }
  }, [hasUnreadSessionIndicators, unreadCompletedSessionKeys, syncSessionIndicatorsFromLifecycle])

  const secondaryItems = secondaryItemsByGroup[activeGroup].filter((item) => {
    const q = secondaryFilter.trim().toLowerCase()
    if (!q) return true
    return `${item.label} ${item.description}`.toLowerCase().includes(q)
  })

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

  function isWizardMode(search: unknown): boolean {
    if (!search) return false
    if (typeof search === 'string') {
      const raw = search.startsWith('?') ? search.slice(1) : search
      return new URLSearchParams(raw).get('wizard') === '1'
    }
    if (typeof search === 'object') {
      const value = (search as Record<string, unknown>).wizard
      return value === true || String(value) === '1'
    }
    return false
  }

  useEffect(() => {
    void getHolyCrabVersion()
      .then((v) => setHolyCrabVersion(v))
      .catch(() => {})
  }, [])

  useEffect(() => {
    void ensureChatRuntimeStarted()
  }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | null = null

    const bootstrap = async () => {
      try {
        const snapshot = await getLifecycleSnapshot()
    if (!disposed) {
          const nextMap = new Map<string, LifecycleSessionState>()
          for (const session of snapshot.sessions || []) {
            const key = session.sessionKey?.trim()
            if (!key) continue
            nextMap.set(key, { ...session, sessionKey: key })
          }
          lifecycleSessionsRef.current = nextMap
          syncSessionIndicatorsFromLifecycle()
          useLifecycleStore.getState().replaceCompanion(snapshot.companion ?? null)
          useLifecycleStore.getState().replaceTasks(snapshot.tasks || [])
        }
      } catch {
        // lifecycle bus is best-effort; chat runtime keeps local fallback state.
      }

      try {
        const off = await listenLifecycleEvents((event) => {
          if (event.kind === 'session' && event.session) {
            applyLifecycleSession(event.session)
            return
          }
          if (event.kind === 'task' && event.task) {
            useLifecycleStore.getState().patchTask(event.task)
            return
          }
          if (event.kind === 'companion') {
            useLifecycleStore.getState().patchCompanion(event.companion ?? null)
          }
        })
        if (disposed) {
          void off()
          return
        }
        unlisten = off
      } catch {
        // ignore listener failure
      }
    }

    void bootstrap()

    return () => {
      disposed = true
      if (unlisten) {
        void unlisten()
        unlisten = null
      }
    }
  }, [applyLifecycleSession, syncSessionIndicatorsFromLifecycle])

  useEffect(() => {
    // Background update checks:
    // - keep it quiet (no UI errors); just surface a small "update available" affordance.
    // - when an update exists, prefetch it in the background so install is one-click.
    let disposed = false
    let inflight = false
    let lastCheckAt = 0

    const checkSilently = async (reason: 'boot' | 'interval' | 'focus') => {
      if (disposed) return
      if (inflight) return

      const now = Date.now()
      // Don't spam on quick focus toggles.
      if (reason === 'focus' && now - lastCheckAt < 60_000) return

      inflight = true
      lastCheckAt = now
      try {
        const update = await checkHolyCrabUpdate(locale)
        if (disposed) {
          if (update) await update.close().catch(() => {})
          return
        }

        if (!update) {
          setUpdateAvailableVersion(null)
          setPrefetchProgress({ status: 'idle', downloadedBytes: 0 })
          const prev = prefetchedUpdateRef.current
          prefetchedUpdateRef.current = null
          if (prev) await prev.close().catch(() => {})
          return
        }

        setUpdateAvailableVersion(update.version)

        // If we already prefetched this same version, don't start another download.
        const existing = prefetchedUpdateRef.current
        if (existing && existing.version === update.version) {
          await update.close().catch(() => {})
          return
        }

        // Replace prefetched update resource.
        prefetchedUpdateRef.current = update
        if (existing) await existing.close().catch(() => {})

        // Prefetch in the background.
        setPrefetchProgress({ status: 'downloading', downloadedBytes: 0 })
        try {
          await predownloadHolyCrabUpdate(update, (progress) => {
            if (disposed) return
            setPrefetchProgress(progress)
          })
        } catch {
          // Keep quiet; user can always click Update and we'll retry with a fresh check.
          setPrefetchProgress({ status: 'idle', downloadedBytes: 0 })
          const cur = prefetchedUpdateRef.current
          if (cur === update) {
            prefetchedUpdateRef.current = null
          }
          await update.close().catch(() => {})
        }
      } catch {
        // ignore
      } finally {
        inflight = false
      }
    }

    const tBoot = window.setTimeout(() => {
      void checkSilently('boot')
    }, 8_000)

    const interval = window.setInterval(() => {
      void checkSilently('interval')
    }, 6 * 60 * 60 * 1000)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkSilently('focus')
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      disposed = true
      const cur = prefetchedUpdateRef.current
      prefetchedUpdateRef.current = null
      if (cur) void cur.close().catch(() => {})
      window.clearTimeout(tBoot)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [locale])

  const runOneClickUpdate = async () => {
    setUpdateDialogOpen(true)
    setUpdateFlowError(null)
    setUpdateFlowProgress({ status: 'idle', downloadedBytes: 0 })
    setUpdateFlowState('checking')

    // Prefer a prefetched update resource when possible (instant install).
    const prefetched = prefetchedUpdateRef.current
    if (prefetched && prefetchProgress.status === 'downloaded') {
      try {
        setUpdateAvailableVersion(prefetched.version)
        setUpdateFlowProgress(prefetchProgress)
        setUpdateFlowState('installing')
        await installHolyCrabUpdateAndRelaunch(prefetched)
      } catch (err) {
        const msg = String(err instanceof Error ? err.message : err)
        setUpdateFlowError(msg)
        setUpdateFlowState('error')
      }
      return
    }

    let update: Awaited<ReturnType<typeof checkHolyCrabUpdate>> | null = null
    try {
      update = await checkHolyCrabUpdate(locale)
      if (!update) {
        setUpdateAvailableVersion(null)
        setUpdateFlowState('no_update')
        return
      }

      setUpdateAvailableVersion(update.version)
      setUpdateFlowState('downloading')
      await predownloadHolyCrabUpdate(update, (progress) => {
        setUpdateFlowProgress(progress)
      })

      setUpdateFlowState('installing')
      await installHolyCrabUpdateAndRelaunch(update)
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err)
      setUpdateFlowError(msg)
      setUpdateFlowState('error')
      // Best-effort: don't keep a stale "update available" indicator if the check failed.
      // We'll re-check on next interval / focus.
    } finally {
      if (update) await update.close().catch(() => {})
    }
  }

  const clearOneClickUpdateState = () => {
    setUpdateFlowError(null)
    setUpdateFlowProgress({ status: 'idle', downloadedBytes: 0 })
    setUpdateFlowState('idle')

    setUpdateAvailableVersion(null)
    setPrefetchProgress({ status: 'idle', downloadedBytes: 0 })

    const cur = prefetchedUpdateRef.current
    prefetchedUpdateRef.current = null
    if (cur) void cur.close().catch(() => {})
  }

  useEffect(() => {
    const checkOverflow = () => {
      const mainNode = mainRef.current
      setMainOverflow(!!mainNode && mainNode.scrollHeight > mainNode.clientHeight + 1)
    }

    const raf = requestAnimationFrame(checkOverflow)
    const handleResize = () => checkOverflow()
    window.addEventListener('resize', handleResize)

    const observer = new ResizeObserver(() => checkOverflow())
    if (mainRef.current) observer.observe(mainRef.current)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', handleResize)
      observer.disconnect()
    }
  }, [pathname, inWizard])

  const onDragRegionMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) return
    void getCurrentWindow()
      .startDragging()
      .catch((error) => {
        console.error('startDragging failed', error)
      })
  }

  return (
    <div
      className={`h-screen overflow-hidden ${inCompanionFloatingWindow ? 'bg-transparent' : 'bg-surface'} text-foreground`}
      style={inCompanionFloatingWindow ? { backgroundColor: 'transparent' } : undefined}
    >
      {!hideChrome ? (
        <>
          <div
            data-tauri-drag-region
            onMouseDown={onDragRegionMouseDown}
            className="fixed inset-x-0 top-0 z-40 h-10 bg-background/80 backdrop-blur-md"
          />
          <div className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(ellipse_at_top,hsl(var(--brand-soft))_0%,transparent_65%)]" />
        </>
      ) : null}
      <div className={`box-border flex h-full w-full ${inCompanionFloatingWindow ? '' : 'pt-10'}`}>
        {!hideChrome && (
          <aside
            className="flex h-full w-[84px] shrink-0 flex-col items-center border-r border-border/45 bg-background/75 py-4 backdrop-blur-xl"
          >
            <div
              data-tauri-drag-region
              onMouseDown={onDragRegionMouseDown}
              className="mb-4 flex items-center justify-center rounded-xl px-1 py-1"
            >
              <div
                data-tauri-drag-region
                className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-card/35"
              >
                <img
                  data-tauri-drag-region
                  src={holycrabIcon}
                  alt="HolyCrab icon"
                  className="pointer-events-none h-6 w-6 rounded-md object-contain"
                />
              </div>
            </div>

            {displayUpdateVersion ? (
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => void runOneClickUpdate()}
                className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/45 bg-primary/12 text-primary transition-colors hover:bg-primary/20"
                aria-label={t('updates.oneClick.label')}
                title={`${t('updates.oneClick.label')} (${displayUpdateVersion})`}
              >
                <span className="relative inline-flex">
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                    <path d="M12 4v9.5m0 0 3.2-3.2M12 13.5l-3.2-3.2M5.8 18.5h12.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-current" />
                </span>
              </button>
            ) : (
              <div
                className="mb-3 inline-flex min-h-8 items-center rounded-xl bg-transparent px-1.5 text-[11px] font-medium text-muted-foreground"
                title={`HolyCrab ${holyCrabVersion}`}
              >
                v{holyCrabVersion}
              </div>
            )}

            <nav className="mt-2 flex w-full flex-col items-center gap-2">
              {groupNavItems.map((item) => {
                const active = activeGroup === item.group
                return (
                  <button
                    key={item.to}
                    type="button"
                    onClick={() => onSwitchGroup(item.group)}
                    className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-colors ${
                      active
                        ? 'bg-interactive-brand text-interactive-brand-foreground'
                        : 'text-content-secondary hover:bg-layer-subtle/70 hover:text-content-primary'
                    }`}
                    aria-label={item.label}
                    title={item.label}
                  >
                    <SidebarIcon kind={item.icon} className="h-5 w-5" />
                  </button>
                )
              })}
            </nav>

            <div className="min-h-0 flex-1" />

            <div className="mb-2 flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={() => setLocale(nextLocale(locale as 'zh' | 'en'))}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-xs font-semibold text-muted-foreground transition-colors hover:bg-card/55 hover:text-foreground"
                aria-label={locale === 'zh' ? t('locale.switch.english') : t('locale.switch.chinese')}
                title={locale === 'zh' ? t('locale.switch.english') : t('locale.switch.chinese')}
              >
                {locale === 'zh' ? '中' : 'EN'}
              </button>
              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-card/55 hover:text-foreground"
                aria-label={theme === 'dark' ? t('theme.lightMode') : t('theme.darkMode')}
                title={theme === 'dark' ? t('theme.lightMode') : t('theme.darkMode')}
              >
                {theme === 'dark' ? (
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                    <path d="M19 14.8A8 8 0 1 1 9.2 5a6.8 6.8 0 1 0 9.8 9.8Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            </div>
          </aside>
        )}

        {!hideChrome && (
          <aside className="flex h-full w-[320px] shrink-0 flex-col border-r border-border/35 bg-background/60 backdrop-blur-lg">
            <div className="border-b border-border/35 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-lg font-semibold text-foreground">
                  {groupNavItems.find((item) => item.group === activeGroup)?.label}
                </div>
                {activeGroup === 'chat' ? (
                  <button
                    type="button"
                    onClick={clearUnreadSessionIndicators}
                    disabled={!hasUnreadSessionIndicators}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-card/55 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    title={locale === 'zh' ? '清除未读标志' : 'Clear unread indicators'}
                    aria-label={locale === 'zh' ? '清除未读标志' : 'Clear unread indicators'}
                  >
                    <BrushCleaning className="h-4.5 w-4.5" />
                  </button>
                ) : null}
              </div>
              <div className="mt-3">
                <input
                  value={secondaryFilter}
                  onChange={(event) => setSecondaryFilter(event.target.value)}
                  placeholder={locale === 'zh' ? '搜索...' : 'Search...'}
                  className="h-10 w-full rounded-lg bg-card/45 px-3 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:bg-card/65"
                />
              </div>
            </div>

            <div className="hc-scrollbar-stealth min-h-0 flex-1 overflow-y-auto px-2 py-2">
              <div className="space-y-0.5">
                {secondaryItems.map((item) => {
                  const active = item.active
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => onSelectSecondaryItem(item)}
                      className={`flex w-full items-center justify-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        active
                          ? 'bg-primary/12 text-foreground'
                          : 'text-foreground/90 hover:bg-card/55'
                      }`}
                    >
                      {activeGroup === 'chat' && item.key !== 'chat-system' ? (
                        <SessionListAvatar
                          channel={item.sessionChannel}
                          label={item.sessionAvatarLabel || item.label}
                          active={active}
                        />
                      ) : (
                        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground ${active ? 'text-primary' : ''}`}>
                          <SidebarIcon kind={item.icon} className="h-[18px] w-[18px]" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1 text-left">
                        <span className="flex items-start justify-between gap-2 text-[13px] font-semibold">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate">{item.label}</span>
                            {item.badge ? (
                              <span className="rounded-full bg-primary/16 px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wide text-primary">
                                {item.badge}
                              </span>
                            ) : null}
                          </span>
                          {item.timeLabel ? (
                            <span className="shrink-0 text-[11px] font-medium text-muted-foreground/85">{item.timeLabel}</span>
                          ) : null}
                        </span>
                        <span className="flex items-center gap-1.5 text-left text-xs text-muted-foreground">
                          {item.live ? (
                            <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-emerald-400 animate-pulse" />
                          ) : item.unreadCompleted ? (
                            <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                          ) : null}
                          <span className="truncate">{item.description}</span>
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </aside>
        )}

        <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <main
            ref={mainRef}
            className={`min-w-0 flex-1 ${
              inCompanionFloatingWindow
                ? 'p-0'
                : `px-5 py-5 pb-5 ${
                  inWizard
                    ? 'hc-scrollbar-stealth overflow-y-auto'
                    : forceMainScrollbar
                      ? 'hc-scrollbar overflow-y-scroll'
                      : pathname === '/chat'
                        ? 'overflow-y-hidden'
                      : mainOverflow
                        ? 'hc-scrollbar-stealth overflow-y-auto'
                        : 'overflow-y-hidden'
                }`
            }`}
          >
            <div className={inWizard
              ? 'w-full'
              : inCompanionFloatingWindow
                ? 'h-full w-full'
              : pathname === '/chat'
                ? 'mx-auto flex h-full w-full max-w-[1520px] flex-col'
                : 'mx-auto w-full max-w-[1520px]'}
            >
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('updates.oneClick.title')}</DialogTitle>
            <DialogDescription>
              {t('updates.oneClick.subtitle')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <div>
                {t('settings.updates.currentVersion')}: <span className="font-mono">{holyCrabVersion}</span>
              </div>
              {updateAvailableVersion ? (
                <div>
                  {t('settings.updates.availableVersion')}: <span className="font-mono">{updateAvailableVersion}</span>
                </div>
              ) : null}
            </div>

            {updateFlowState === 'checking' ? (
              <div className="text-muted-foreground">{t('updates.oneClick.status.checking')}</div>
            ) : updateFlowState === 'downloading' ? (
              <div className="text-muted-foreground">
                {t('updates.oneClick.status.downloading')}{' '}
                <span className="font-mono">
                  {formatBytes(updateFlowProgress.downloadedBytes)}
                  {updateFlowProgress.totalBytes ? ` / ${formatBytes(updateFlowProgress.totalBytes)}` : ''}
                </span>
              </div>
            ) : updateFlowState === 'installing' ? (
              <div className="text-muted-foreground">{t('updates.oneClick.status.installing')}</div>
            ) : updateFlowState === 'no_update' ? (
              <div className="text-muted-foreground">{t('settings.updates.noUpdates')}</div>
            ) : updateFlowState === 'error' ? (
              <div className="whitespace-pre-wrap rounded-xl bg-red-500/10 p-3 text-sm text-red-200">
                {t('settings.updates.error')}: {updateFlowError || ''}
              </div>
            ) : null}

            {prefetchProgress.status === 'downloading' ? (
              <div className="text-xs text-muted-foreground">
                {t('updates.oneClick.status.downloading')}{' '}
                <span className="font-mono">
                  {formatBytes(prefetchProgress.downloadedBytes)}
                  {prefetchProgress.totalBytes ? ` / ${formatBytes(prefetchProgress.totalBytes)}` : ''}
                </span>{' '}
                (background)
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={clearOneClickUpdateState}>
              {t('settings.updates.clear')}
            </Button>
            <Button variant="outline" onClick={() => setUpdateDialogOpen(false)}>
              {t('updates.oneClick.close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
