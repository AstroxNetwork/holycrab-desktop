import { tauriInvoke } from '@/lib/tauri'

export type ChannelKind = 'telegram' | 'feishu' | 'discord'

interface OpenClawSetupHandoffInput {
  channel: ChannelKind
}

export interface OpenClawSetupHandoffResult {
  ok: boolean
  dashboardUrl: string
  chatUrl: string
  prompt: string
  injected: boolean
  message: string
}

export async function handoffOpenClawSetup(input: OpenClawSetupHandoffInput) {
  return tauriInvoke<OpenClawSetupHandoffResult>('handoff_openclaw_setup', { input })
}

export async function getOpenClawChatUrl() {
  return tauriInvoke<string>('get_openclaw_chat_url')
}

export interface OpenClawReadinessResult {
  ok: boolean
  openclawBin?: string | null
  gatewayInstalled: boolean
  gatewayRunning: boolean
  portListening: boolean
  chatUrl: string
  chatHttpStatus?: number | null
  chatReachable: boolean
  gatewayLogPath?: string | null
  advice: string[]
}

export async function checkOpenClawReadiness(options?: { attemptFix?: boolean }) {
  return tauriInvoke<OpenClawReadinessResult>('check_openclaw_readiness', {
    input: { attemptFix: Boolean(options?.attemptFix) },
  })
}

export async function openExternalUrl(url: string) {
  return tauriInvoke<void>('open_external_url', { url })
}
