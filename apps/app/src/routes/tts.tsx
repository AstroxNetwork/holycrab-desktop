import { createFileRoute } from '@tanstack/react-router'
import { CompanionTtsPanel } from '@/components/companion-tts-panel'
import { useLocale } from '@/lib/locale-context'

export const Route = createFileRoute('/tts')({
  component: TtsPage,
})

function TtsPage() {
  const { t } = useLocale()

  return (
    <div className="mx-auto grid w-full max-w-[1520px] gap-6 pb-6">
      <div>
        <h1 className="font-display text-4xl leading-tight">{t('tts.page.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('tts.page.subtitle')}</p>
      </div>
      <CompanionTtsPanel />
    </div>
  )
}
