import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export const RUNTIME_ACTION_OUTPUT_EVENT = 'holycrab://runtime-action-output'

export interface RuntimeActionOutputPayload {
  runtimeId: string
  action: string
  stream: 'meta' | 'stdout' | 'stderr' | string
  line: string
  done: boolean
  success?: boolean | null
  command?: string | null
}

export async function listenRuntimeActionOutput(
  handler: (payload: RuntimeActionOutputPayload) => void,
): Promise<UnlistenFn> {
  return listen<RuntimeActionOutputPayload>(RUNTIME_ACTION_OUTPUT_EVENT, (event) => {
    handler(event.payload)
  })
}

