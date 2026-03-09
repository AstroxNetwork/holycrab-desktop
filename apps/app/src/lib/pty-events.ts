import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface PtyOutputPayload {
  sessionId: string
  data: string
  done?: boolean
  exitCode?: number
}

export async function listenPtyOutput(
  sessionId: string,
  onPayload: (payload: PtyOutputPayload) => void,
): Promise<UnlistenFn> {
  return await listen<PtyOutputPayload>('pty:output', (event) => {
    if (!event.payload) return
    if (event.payload.sessionId !== sessionId) return
    onPayload(event.payload)
  })
}

