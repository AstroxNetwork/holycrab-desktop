import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'

import { Button } from '@ui/components/button'
import { Input } from '@ui/components/input'
import { tauriInvoke } from '@/lib/tauri'
import { useLocale } from '@/lib/locale-context'

interface CompanionLive2dModel {
  id: string
  fileName: string
  storedName: string
  relativePath: string
  bytes: number
  uploadedAtUnixMs: number
  active: boolean
}

interface CompanionLive2dListResult {
  models: CompanionLive2dModel[]
  activeModel: string | null
}

export interface CompanionLive2dPanelProps {
  onActiveModelChange?: (modelId: string | null) => void
}

interface CompanionLive2dUploadPayload {
  fileName: string
  fileBase64: string
  setAsActive: boolean
}
interface CompanionLive2dDisplayModel extends CompanionLive2dModel {
  builtin?: boolean
}

const ALLOWED_LIVE2D_EXTENSIONS = new Set(['.zip', '.moc3', '.model3.json', '.moc', '.json'])
const MAX_UPLOAD_BYTES = 120 * 1024 * 1024
const BUILTIN_STATIC_MODEL_ID = '__builtin_static_model__'

function isSupportedLive2dFile(fileName: string): boolean {
  const normalized = fileName.trim().toLowerCase()
  for (const suffix of ALLOWED_LIVE2D_EXTENSIONS) {
    if (normalized.endsWith(suffix)) {
      return true
    }
  }
  return false
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${bytes} B`
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += chunk) {
    const chunkBytes = bytes.slice(i, i + chunk)
    chunks.push(String.fromCharCode(...chunkBytes))
  }
  return btoa(chunks.join(''))
}

async function invokeCompanionCommand<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (import.meta.env.DEV) {
    const safeArgs = { ...args }
    if (safeArgs.input && typeof safeArgs.input === 'object' && 'fileBase64' in safeArgs.input) {
      safeArgs.input = {
        ...(safeArgs.input as Record<string, unknown>),
        fileBase64: '[omitted]',
      }
    }
    console.debug('[companion-live2d] invoking', command, safeArgs)
  }
  return tauriInvoke<T>(command, args)
}

export function CompanionLive2dPanel(props: CompanionLive2dPanelProps = {}) {
  const { onActiveModelChange } = props
  const { t, locale } = useLocale()
  const tr = (zh: string, en: string) => (locale === 'zh' ? zh : en)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [models, setModels] = useState<CompanionLive2dModel[]>([])
  const [activeModelId, setActiveModelId] = useState<string | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [removingModelId, setRemovingModelId] = useState<string | null>(null)
  const [error, setError] = useState<string>('')
  const [uploadHint, setUploadHint] = useState<string>('')

  const refresh = useCallback(async () => {
    setLoadingModels(true)
    setError('')
    try {
      const result = await tauriInvoke<CompanionLive2dListResult>('companion_live2d_list_models')
      setModels(result.models)
      const nextActiveModelId = result.activeModel ?? null
      setActiveModelId(nextActiveModelId)
      onActiveModelChange?.(nextActiveModelId)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoadingModels(false)
    }
  }, [onActiveModelChange])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      setError(t('companion.live2d.error.empty'))
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`${t('companion.live2d.error.tooLarge')}: ${Math.ceil(file.size / (1024 * 1024))} MB`)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      return
    }
    if (!isSupportedLive2dFile(file.name)) {
      setError(`${t('companion.live2d.error.unsupportedType')}: ${file.name}`)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      return
    }
    setError('')
    setUploading(true)
    setUploadHint('')

    try {
      const buffer = await file.arrayBuffer()
      const fileBase64 = arrayBufferToBase64(buffer)
      const model = await invokeCompanionCommand<CompanionLive2dModel>('companion_live2d_upload_model', {
        input: {
          fileName: file.name,
          fileBase64,
          setAsActive: true,
        } satisfies CompanionLive2dUploadPayload,
      })
      setActiveModelId(model.id)
      onActiveModelChange?.(model.id)
      setUploadHint(`${model.fileName} ${t('companion.live2d.models.uploaded')}`)
      await refresh()
    } catch (err) {
      setError(`${t('companion.live2d.error.uploadFailed')}: ${err}`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }, [onActiveModelChange, refresh, t])

  const setActiveModel = useCallback(async (modelId: string) => {
    setError('')
    const previousActiveModelId = activeModelId
    setActiveModelId(modelId)
    onActiveModelChange?.(modelId)
    try {
      await invokeCompanionCommand('companion_live2d_set_active_model', { input: { modelId } })
      await refresh()
    } catch (err) {
      setActiveModelId(previousActiveModelId)
      onActiveModelChange?.(previousActiveModelId)
      setError(`${t('companion.live2d.error.setActiveFailed')}: ${err}`)
    }
  }, [activeModelId, onActiveModelChange, refresh, t])

  const removeModel = useCallback(async (modelId: string) => {
    setError('')
    setRemovingModelId(modelId)
    try {
      await invokeCompanionCommand('companion_live2d_remove_model', { input: { modelId } })
      await refresh()
    } catch (err) {
      setError(`${t('companion.live2d.error.removeFailed')}: ${err}`)
    } finally {
      setRemovingModelId(null)
    }
  }, [refresh, t])

  const displayModels = useMemo<CompanionLive2dDisplayModel[]>(() => {
    const defaultPreviewModel: CompanionLive2dDisplayModel = {
      id: BUILTIN_STATIC_MODEL_ID,
      fileName: tr('默认模型（预览）', 'Default Model (Preview)'),
      storedName: 'builtin-static',
      relativePath: tr('内置', 'Built-in'),
      bytes: 0,
      uploadedAtUnixMs: 0,
      active: activeModelId === BUILTIN_STATIC_MODEL_ID,
      builtin: true,
    }
    const remoteModels = models.map((model) => ({
      ...model,
      active: activeModelId === model.id,
      builtin: false,
    }))
    return [defaultPreviewModel, ...remoteModels]
  }, [activeModelId, models])

  return (
    <section className="space-y-3 rounded-xl border border-border/40 bg-surface-elevated/55 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{t('companion.live2d.models.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('companion.live2d.upload.helper')}</p>
        </div>
        <Input
          ref={fileInputRef}
          type="file"
          accept=".zip,.moc3,.model3.json,.moc,.json"
          className="hidden"
          onChange={handleUpload}
          disabled={uploading}
        />
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="h-8 px-3 text-xs"
        >
          {uploading ? t('companion.live2d.uploading') : t('companion.live2d.upload.button')}
        </Button>
      </div>

      {uploadHint ? <p className="text-xs text-muted-foreground">{uploadHint}</p> : null}
      {error ? (
        <div className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {loadingModels ? (
        <p className="text-xs text-muted-foreground">{t('companion.live2d.models.loading')}</p>
      ) : (
        <div className="space-y-2">
          {displayModels.map((model) => {
            const lastUpdated = model.uploadedAtUnixMs
              ? new Intl.DateTimeFormat([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }).format(new Date(model.uploadedAtUnixMs))
              : t('companion.state.updatedUnknown')

            return (
              <div key={model.id} className="rounded-lg border border-border/40 px-2.5 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${model.active ? 'bg-emerald-400' : 'bg-muted-foreground/40'}`} />
                      <div className="truncate text-sm font-medium">{model.fileName}</div>
                    </div>
                    {model.builtin ? (
                      <div className="text-[11px] text-muted-foreground">{tr('内置静态预览模型', 'Built-in static preview model')}</div>
                    ) : (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {formatBytes(model.bytes)} · {lastUpdated}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant={model.active ? 'secondary' : 'outline'}
                      onClick={() => setActiveModel(model.id)}
                      disabled={model.active}
                      className="h-7 px-2 text-[11px]"
                    >
                      {model.active ? t('companion.live2d.item.active') : t('companion.live2d.item.setActive')}
                    </Button>
                    {!model.builtin ? (
                      <Button
                        variant="outline"
                        onClick={() => removeModel(model.id)}
                        disabled={removingModelId === model.id}
                        className="h-7 px-2 text-[11px]"
                      >
                        {removingModelId === model.id
                          ? t('companion.live2d.item.removing')
                          : t('companion.live2d.item.remove')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
