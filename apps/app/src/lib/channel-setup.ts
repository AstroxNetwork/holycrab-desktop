import { tauriInvoke } from '@/lib/tauri'

export type ChannelKind = 'telegram' | 'feishu' | 'discord'

interface SettingsView {
  controlPlaneUrl: string
  gatewayUrl: string
  rpcAddr: string
  openclawHooksUrl: string
  openclawTokenSet: boolean
  openclawWsTokenSet: boolean
}

export interface ChannelSetupView {
  hooksUrl: string
  hooksTokenSet: boolean
  wsTokenSet: boolean
  connected: boolean
}

export interface ChannelSetupUpdate {
  hooksUrl: string
  hooksToken?: string
  wsToken?: string
  clearHooksToken?: boolean
  clearWsToken?: boolean
}

interface SettingsSaveResult {
  changed: boolean
  pairingCleared: boolean
  restartRequired: boolean
}

export async function getChannelSetup() {
  const settings = await tauriInvoke<SettingsView>('get_settings')
  return toChannelSetup(settings)
}

export async function saveChannelSetup(update: ChannelSetupUpdate) {
  const settings = await tauriInvoke<SettingsView>('get_settings')
  const payload: Record<string, unknown> = {
    controlPlaneUrl: settings.controlPlaneUrl,
    gatewayUrl: settings.gatewayUrl,
    rpcAddr: settings.rpcAddr,
    openclawHooksUrl: update.hooksUrl.trim(),
  }

  if (update.clearHooksToken) {
    payload.openclawHooksToken = ''
  } else if (update.hooksToken && update.hooksToken.trim()) {
    payload.openclawHooksToken = update.hooksToken.trim()
  }

  if (update.clearWsToken) {
    payload.openclawWsToken = ''
  } else if (update.wsToken && update.wsToken.trim()) {
    payload.openclawWsToken = update.wsToken.trim()
  }

  const result = await tauriInvoke<SettingsSaveResult>('save_settings', { update: payload })
  const fresh = await tauriInvoke<SettingsView>('get_settings')
  return {
    ...result,
    setup: toChannelSetup(fresh),
  }
}

function toChannelSetup(settings: SettingsView): ChannelSetupView {
  const hooksUrl = settings.openclawHooksUrl || ''
  const hooksTokenSet = Boolean(settings.openclawTokenSet)
  const wsTokenSet = Boolean(settings.openclawWsTokenSet)
  return {
    hooksUrl,
    hooksTokenSet,
    wsTokenSet,
    connected: hooksUrl.trim().length > 0 && (hooksTokenSet || wsTokenSet),
  }
}
