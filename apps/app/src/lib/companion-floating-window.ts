import { tauriInvoke } from '@/lib/tauri'

type OpenCompanionFloatingWindowInput = {
  modelId?: string
  mode?: string
  modelPath?: string
}

let openRequest: Promise<void> | null = null

export async function openCompanionFloatingWindow(input: OpenCompanionFloatingWindowInput = {}) {
  if (openRequest) {
    await openRequest
    return
  }

  openRequest = tauriInvoke<void>('open_companion_floating_window', {
    input: {
      modelId: input.modelId?.trim() || undefined,
      mode: input.mode?.trim() || undefined,
      modelPath: input.modelPath?.trim() || undefined,
    },
  })

  try {
    await openRequest
  } finally {
    openRequest = null
  }
}
