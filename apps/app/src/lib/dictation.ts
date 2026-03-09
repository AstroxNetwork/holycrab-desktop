import { tauriInvoke } from '@/lib/tauri'

export type DictationModelState = 'missing' | 'downloading' | 'ready' | 'error'
export type DictationSessionState = 'idle' | 'listening' | 'processing'

export interface DictationDownloadProgress {
  downloadedBytes: number
  totalBytes?: number | null
}

export interface DictationModelStatus {
  state: DictationModelState
  modelId: string
  progress?: DictationDownloadProgress | null
  error?: string | null
  path?: string | null
}

export type DictationEvent =
  | { type: 'state'; state: DictationSessionState }
  | { type: 'level'; value: number }
  | { type: 'transcript'; text: string }
  | { type: 'error'; message: string }
  | { type: 'canceled'; message: string }

export function dictationModelStatus(modelId?: string) {
  return tauriInvoke<DictationModelStatus>('dictation_model_status', {
    model_id: modelId,
  })
}

export function dictationDownloadModel(modelId?: string) {
  return tauriInvoke<DictationModelStatus>('dictation_download_model', {
    model_id: modelId,
  })
}

export function dictationCancelDownload(modelId?: string) {
  return tauriInvoke<DictationModelStatus>('dictation_cancel_download', {
    model_id: modelId,
  })
}

export function dictationRemoveModel(modelId?: string) {
  return tauriInvoke<DictationModelStatus>('dictation_remove_model', {
    model_id: modelId,
  })
}

export function dictationStart(preferredLanguage?: string) {
  return tauriInvoke<DictationSessionState>('dictation_start', {
    preferred_language: preferredLanguage,
  })
}

export function dictationStop() {
  return tauriInvoke<DictationSessionState>('dictation_stop')
}

export function dictationCancel() {
  return tauriInvoke<DictationSessionState>('dictation_cancel')
}

export function dictationRequestPermission() {
  return tauriInvoke<boolean>('dictation_request_permission')
}

export async function listenDictationEvents(listener: (event: DictationEvent) => void) {
  const eventApi = await import('@tauri-apps/api/event')
  return eventApi.listen<DictationEvent>('dictation-event', (event) => {
    if (!event.payload) return
    listener(event.payload)
  })
}

export async function listenDictationDownload(
  listener: (status: DictationModelStatus) => void,
) {
  const eventApi = await import('@tauri-apps/api/event')
  return eventApi.listen<DictationModelStatus>('dictation-download', (event) => {
    if (!event.payload) return
    listener(event.payload)
  })
}
