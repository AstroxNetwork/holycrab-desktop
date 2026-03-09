import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'

export const SETUP_STATE_CHANGED_EVENT = 'holycrab://setup-state-changed'

export interface SetupStateChangedPayload {
  source?: string
}

export async function emitSetupStateChanged(payload: SetupStateChangedPayload = {}) {
  await emit(SETUP_STATE_CHANGED_EVENT, payload)
}

export async function listenSetupStateChanged(handler: () => void): Promise<UnlistenFn> {
  return listen<SetupStateChangedPayload>(SETUP_STATE_CHANGED_EVENT, () => {
    handler()
  })
}

