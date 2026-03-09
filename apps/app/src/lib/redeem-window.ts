import { tauriInvoke } from '@/lib/tauri'

let openRequest: Promise<void> | null = null

export async function openRedeemWindow() {
  if (openRequest) {
    await openRequest
    return
  }
  openRequest = tauriInvoke<void>('open_redeem_window')
  try {
    await openRequest
  } finally {
    openRequest = null
  }
}
