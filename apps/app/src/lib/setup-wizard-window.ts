import { tauriInvoke } from '@/lib/tauri'

let openRequest: Promise<void> | null = null

export type SetupWizardTarget = 'openclaw'

export async function openSetupWizardWindow(target: SetupWizardTarget = 'openclaw') {
  if (openRequest) {
    await openRequest
    return
  }
  openRequest = tauriInvoke<void>('open_setup_wizard_window', { input: { target } })
  try {
    await openRequest
  } finally {
    openRequest = null
  }
}
