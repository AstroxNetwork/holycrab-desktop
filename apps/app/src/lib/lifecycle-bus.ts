import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { tauriInvoke } from '@/lib/tauri'

export const LIFECYCLE_EVENT = 'holycrab://lifecycle'

export interface LifecycleSessionState {
  sessionKey: string
  live: boolean
  unreadCompleted: boolean
  updatedAtUnixMs: number
  source?: string | null
}

export interface LifecycleTaskState {
  key: string
  scope: string
  status: string
  updatedAtUnixMs: number
  message?: string | null
  source?: string | null
}

export interface LifecycleCompanionState {
  speaking: boolean
  mouthOpen?: number | null
  updatedAtUnixMs: number
  source?: string | null
}

export interface LifecycleSnapshot {
  sessions: LifecycleSessionState[]
  tasks: LifecycleTaskState[]
  companion?: LifecycleCompanionState
}

export interface LifecycleEventEnvelope {
  kind: 'session' | 'task' | 'companion' | string
  session?: LifecycleSessionState
  task?: LifecycleTaskState
  companion?: LifecycleCompanionState
}

export interface LifecycleCompanionPublishInput {
  speaking: boolean
  source?: string
  mouthOpen?: number | null
}

export interface LifecycleSessionPublishInput {
  sessionKey: string
  live?: boolean
  unreadCompleted?: boolean
  source?: string
}

export interface LifecycleTaskPublishInput {
  key: string
  scope: string
  status: 'running' | 'completed' | 'error' | 'idle' | string
  message?: string
  source?: string
}

export async function getLifecycleSnapshot() {
  return tauriInvoke<LifecycleSnapshot>('get_lifecycle_snapshot')
}

export async function publishLifecycleSession(input: LifecycleSessionPublishInput) {
  return tauriInvoke<LifecycleSessionState>('publish_lifecycle_session', { input })
}

export async function publishLifecycleTask(input: LifecycleTaskPublishInput) {
  return tauriInvoke<LifecycleTaskState>('publish_lifecycle_task', { input })
}

export async function publishLifecycleCompanion(input: LifecycleCompanionPublishInput) {
  return tauriInvoke<LifecycleCompanionState>('publish_lifecycle_companion', { input })
}

export async function listenLifecycleEvents(
  handler: (payload: LifecycleEventEnvelope) => void,
): Promise<UnlistenFn> {
  return listen<LifecycleEventEnvelope>(LIFECYCLE_EVENT, (event) => {
    if (!event.payload) return
    handler(event.payload)
  })
}
