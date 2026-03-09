import { tauriInvoke } from '@/lib/tauri'
import type {
  RuntimeActionArch,
  RuntimeActionDef,
  RuntimeActionKind,
  RuntimeActionPlatform,
  RuntimeViewModel,
} from '@/lib/runtimes'

const MAX_SCRIPT_LEN = 16 * 1024
const MAX_TIMEOUT_SEC = 3600

export interface RuntimeActionContext {
  platform: RuntimeActionPlatform
  arch: RuntimeActionArch
}

export async function detectRuntimeActionContext(): Promise<RuntimeActionContext> {
  let platform = inferPlatform()
  const tauriPlatform = await tauriInvoke<string>('get_system_platform').catch(() => null)
  if (tauriPlatform) {
    platform = normalizePlatform(tauriPlatform)
  }
  let arch = inferArch()
  const tauriArch = await tauriInvoke<string>('get_system_arch').catch(() => null)
  if (tauriArch) {
    arch = normalizeArch(tauriArch)
  }
  return { platform, arch }
}

export function resolveRuntimeAction(
  runtime: Pick<RuntimeViewModel, 'actions'>,
  kind: RuntimeActionKind,
  context: RuntimeActionContext,
): RuntimeActionDef | null {
  const candidates = runtime.actions?.[kind]
  if (!candidates?.length) {
    return null
  }

  const ranked = candidates
    .map((action, index) => ({
      action,
      index,
      score: actionMatchScore(action, context),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      return a.index - b.index
    })

  return ranked[0]?.action ?? null
}

export function validateRuntimeAction(action: RuntimeActionDef): string | null {
  if (action.type === 'ptyShell') {
    if (!action.script.trim()) return 'PTY action script is empty.'
    if (action.script.length > MAX_SCRIPT_LEN) {
      return `PTY action script is too large (${action.script.length} > ${MAX_SCRIPT_LEN}).`
    }
    if (action.timeoutSec != null) {
      if (!Number.isFinite(action.timeoutSec)) return 'PTY action timeout must be a finite number.'
      if (action.timeoutSec <= 0 || action.timeoutSec > MAX_TIMEOUT_SEC) {
        return `PTY action timeout must be in 1..${MAX_TIMEOUT_SEC} seconds.`
      }
    }
    return null
  }

  const raw = action.url?.trim() || ''
  if (!raw) return 'External URL action is empty.'

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return 'External URL action is not a valid URL.'
  }

  if (parsed.protocol === 'https:') return null
  if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) return null
  return 'External URL must use https://, or http:// only for localhost/loopback.'
}

function actionMatchScore(action: RuntimeActionDef, context: RuntimeActionContext): number {
  const platformScore = platformMatchScore(action.platform, context.platform)
  if (platformScore < 0) return -1
  const archScore = archMatchScore(action.arch, context.arch)
  if (archScore < 0) return -1
  return platformScore + archScore
}

function platformMatchScore(actionPlatform: string | null | undefined, current: RuntimeActionPlatform) {
  const normalized = normalizePlatform(actionPlatform)
  const currentNormalized = normalizePlatform(current)
  if (normalized === 'any') return 1
  if (normalized === currentNormalized) return 2
  return -1
}

function archMatchScore(actionArch: string | null | undefined, current: RuntimeActionArch) {
  const normalized = normalizeArch(actionArch)
  const currentNormalized = normalizeArch(current)
  if (normalized === 'any') return 1
  if (normalized === currentNormalized) return 2
  return -1
}

function normalizePlatform(value: string | null | undefined): RuntimeActionPlatform {
  const raw = (value || '').trim().toLowerCase()
  if (!raw || raw === 'any') return 'any'
  if (raw.includes('darwin') || raw.includes('mac')) return 'darwin'
  if (raw.includes('win')) return 'windows'
  if (raw.includes('linux')) return 'linux'
  return raw
}

function normalizeArch(value: string | null | undefined): RuntimeActionArch {
  const raw = (value || '').trim().toLowerCase()
  if (!raw || raw === 'any') return 'any'
  if (raw === 'aarch64' || raw === 'arm64') return 'arm64'
  if (raw === 'amd64' || raw === 'x86_64' || raw === 'x64' || raw.includes('intel')) return 'x64'
  return raw
}

function inferPlatform(): RuntimeActionPlatform {
  if (typeof window === 'undefined') return 'any'
  const source = `${window.navigator.userAgent} ${window.navigator.platform}`.toLowerCase()
  return normalizePlatform(source)
}

function inferArch(): RuntimeActionArch {
  if (typeof window === 'undefined') return 'any'
  const source = `${window.navigator.userAgent} ${(window.navigator as { userAgentData?: { architecture?: string } }).userAgentData?.architecture ?? ''}`.toLowerCase()
  return normalizeArch(source)
}

function isLoopbackHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase()
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized.endsWith('.localhost')
}
