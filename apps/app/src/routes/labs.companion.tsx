import { createFileRoute } from '@tanstack/react-router'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CompanionLive2dPanel } from '@/components/companion-live2d-panel'
import { CompanionLive2dViewer } from '@/components/companion-live2d-viewer'
import { tauriInvoke } from '@/lib/tauri'
import { openCompanionFloatingWindow } from '@/lib/companion-floating-window'
import { useLifecycleStore } from '@/stores/lifecycle-store'
import { useLocale } from '@/lib/locale-context'
import { Button } from '@ui/components/button'
import { ArrowLeft } from 'lucide-react'

export const Route = createFileRoute('/labs/companion')({
  component: LabsCompanionPage,
})

interface CompanionSettingsView {
  companion?: {
    enabled?: boolean
  }
}

interface SettingsSaveResult {
  updated: boolean
}

function LabsCompanionPage() {
  const { t, locale } = useLocale()
  const tr = (zh: string, en: string) => (locale === 'zh' ? zh : en)
  const navigate = useNavigate()
  const companionState = useLifecycleStore((state) => state.companion)
  const tasks = useLifecycleStore((state) => state.tasks)
  const [activeModelId, setActiveModelId] = useState<string | null>(null)
  const [openFloatingError, setOpenFloatingError] = useState<string>('')
  const [companionTtsEnabled, setCompanionTtsEnabled] = useState(false)
  const [savingCompanionTtsEnabled, setSavingCompanionTtsEnabled] = useState(false)
  const hasSelectedUsableModel = Boolean(
    activeModelId
    && activeModelId.trim(),
  )
  const companionMode = useMemo(() => {
    if (companionState?.speaking) return 'speaking'
    const hasThinkingTask = Object.values(tasks).some((task) => task.status === 'running')
    return hasThinkingTask ? 'thinking' : 'idle'
  }, [companionState?.speaking, tasks])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const activeModel = await tauriInvoke<string | null>('companion_live2d_get_active_model')
        if (active) {
          setActiveModelId(activeModel ?? null)
        }
      } catch {
        // Ignore startup sync failures: the panel list refresh will still sync the selected model.
      }
    })()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const settings = await tauriInvoke<CompanionSettingsView>('get_settings')
        if (active) {
          setCompanionTtsEnabled(Boolean(settings.companion?.enabled))
        }
      } catch {
        if (active) {
          setCompanionTtsEnabled(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const handleToggleCompanionTts = useCallback(async () => {
    if (savingCompanionTtsEnabled) {
      return
    }
    const nextEnabled = !companionTtsEnabled
    setSavingCompanionTtsEnabled(true)
    try {
      await tauriInvoke<SettingsSaveResult>('save_settings', {
        update: {
          companion: {
            enabled: nextEnabled,
          },
        },
      })
      setCompanionTtsEnabled(nextEnabled)
    } catch {
      // keep previous state when persistence fails
    } finally {
      setSavingCompanionTtsEnabled(false)
    }
  }, [companionTtsEnabled, savingCompanionTtsEnabled])

  const handleOpenFloatingWindow = useCallback(async () => {
    setOpenFloatingError('')

    try {
      const activeModelIdFromState = activeModelId?.trim()
      const selectedModelId = activeModelIdFromState
      const backendActiveModelId = await tauriInvoke<string | null>('companion_live2d_get_active_model')
      const resolvedModelId = (selectedModelId || backendActiveModelId)?.trim()
      const backendActiveModelPath = (await tauriInvoke<string | null>('companion_live2d_get_active_model_path'))?.trim() ?? ''

      if (!resolvedModelId && !backendActiveModelPath) {
        setOpenFloatingError(t('companion.live2d.preview.noModel'))
        return
      }

      if (resolvedModelId) {
        try {
          await tauriInvoke('companion_live2d_set_active_model', { input: { modelId: resolvedModelId } })
        } catch {
          // best effort
        }
      }

      const resolvedModelPath = resolvedModelId
        ? (
            await tauriInvoke<string | null>('companion_live2d_get_model_path', {
              input: { modelId: resolvedModelId },
            })
          )?.trim() ?? ''
        : backendActiveModelPath

      await openCompanionFloatingWindow({
        modelId: resolvedModelId,
        mode: companionMode,
        modelPath: resolvedModelPath,
      })
    } catch (error) {
      console.error('Failed to open floating window', error)
      const message = error instanceof Error ? error.message : String(error)
      setOpenFloatingError(`${t('companion.live2d.preview.failedToOpenFloatingWindow')}（${message}）`)
    }
  }, [activeModelId, companionMode, t])

  return (
    <div className="mx-auto grid w-full max-w-[1520px] gap-6 pb-6">
      <Button
        variant="outline"
        className="w-fit"
        onClick={() => {
          void navigate({ to: '/labs' })
        }}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t('companion.page.toLabs')}
      </Button>
      <div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="font-display text-4xl leading-tight">{t('settings.companion.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('settings.companion.description')}</p>
          </div>
          <Button
            type="button"
            variant={hasSelectedUsableModel ? 'brand' : 'outline'}
            disabled={!hasSelectedUsableModel}
            onClick={handleOpenFloatingWindow}
          >
            {tr('开启', 'Open')}
          </Button>
        </div>
        {openFloatingError ? <div className="mt-2 text-xs text-destructive">{openFloatingError}</div> : null}
      </div>
      <section className="rounded-lg border border-white/10 bg-black/20 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-white">{tr('桌面伴侣设置', 'Desktop Companion Settings')}</div>
            <p className="mt-0.5 text-xs text-white/70">{tr('开启语音播报（有消息时自动播报）', 'Enable voice playback (auto-read new messages)')}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void handleToggleCompanionTts()
            }}
            disabled={savingCompanionTtsEnabled}
            aria-pressed={companionTtsEnabled}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${
              companionTtsEnabled ? 'bg-emerald-500' : 'bg-white/20'
            } ${savingCompanionTtsEnabled ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                companionTtsEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(320px,1fr)]">
        <CompanionLive2dViewer
          key={activeModelId ?? '__none__'}
          activeModelId={activeModelId}
          companionMode={companionMode}
          mouthOpen={companionState?.mouthOpen}
          showOpenFloatingButton={false}
        />
        <CompanionLive2dPanel onActiveModelChange={setActiveModelId} />
      </div>
    </div>
  )
}
