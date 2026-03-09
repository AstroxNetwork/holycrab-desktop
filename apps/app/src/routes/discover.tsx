import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { Button } from '@ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@ui/components/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@ui/components/dialog'
import { openExternalUrl } from '@/lib/openclaw-handoff'
import { useLocale } from '@/lib/locale-context'
import { externalLinks } from '@/lib/external-links'
import { openRedeemWindow } from '@/lib/redeem-window'
import { saveTelegramChannelSetup } from '@/lib/openclaw-config'
import { emitSetupStateChanged } from '@/lib/setup-events'
import { useChatStore } from '@/stores/chat-store'

export const Route = createFileRoute('/discover')({
  component: DiscoverPage,
})

const TELEGRAM_NEXT_STEP_PROMPT = 'I have configured the Telegram Bot Token. Guide me through the next step.'

function DiscoverPage() {
  const navigate = useNavigate()
  const { t, locale } = useLocale()
  const tr = (zh: string, en: string) => (locale === 'zh' ? zh : en)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [telegramDialogOpen, setTelegramDialogOpen] = useState(false)
  const [telegramBotToken, setTelegramBotToken] = useState('')
  const [savingTelegram, setSavingTelegram] = useState(false)
  const [telegramError, setTelegramError] = useState<string | null>(null)

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      console.error(err)
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const onSaveTelegramToken = async () => {
    const token = telegramBotToken.trim()
    if (!token) {
      setTelegramError(t('setupWizard.errors.telegramTokenRequired'))
      return
    }
    if (!token.includes(':')) {
      setTelegramError(t('setupWizard.errors.telegramTokenInvalidFormat'))
      return
    }

    setSavingTelegram(true)
    setTelegramError(null)
    try {
      await saveTelegramChannelSetup({
        runtime: 'openclaw',
        botToken: token,
      })
      await emitSetupStateChanged({ source: 'discover:telegram:save' })
      useChatStore.getState().patch({ draftInput: TELEGRAM_NEXT_STEP_PROMPT })
      setTelegramDialogOpen(false)
      setTelegramBotToken('')
      await navigate({ to: '/chat' })
    } catch (err) {
      console.error(err)
      setTelegramError(String(err))
    } finally {
      setSavingTelegram(false)
    }
  }

  return (
    <div className="grid gap-6">
      <Card className="overflow-hidden border-0 bg-[linear-gradient(135deg,hsl(var(--card))_0%,hsl(var(--brand-soft))_52%,hsl(var(--card))_100%)] shadow-lg">
        <CardHeader>
          <CardTitle className="font-display text-3xl">{t('discover.page.title')}</CardTitle>
          <p className="max-w-3xl text-sm text-muted-foreground">{t('discover.page.subtitle')}</p>
        </CardHeader>
      </Card>

      {error ? (
        <Card className="bg-destructive/10">
          <CardContent className="pt-6 text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={telegramDialogOpen} onOpenChange={setTelegramDialogOpen}>
        <DialogContent className="max-w-3xl bg-background/95">
          <DialogHeader>
            <DialogTitle>{t('setupWizard.telegram.title')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="space-y-4">
              {telegramError ? (
                <div className="rounded-xl border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {telegramError}
                </div>
              ) : null}
              <div className="text-sm font-medium">{t('setupWizard.telegram.howToGetToken')}</div>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
                <li>
                  {t('setupWizard.telegram.guide.step1Prefix')}{' '}
                  <button
                    type="button"
                    className="cursor-pointer underline underline-offset-2"
                    onClick={() => void openExternalUrl(externalLinks.botfather)}
                  >
                    @BotFather
                  </button>
                  {t('setupWizard.telegram.guide.step1Suffix')}
                </li>
                <li>{t('setupWizard.telegram.guide.step2')} <code>/newbot</code>.</li>
                <li>{t('setupWizard.telegram.guide.step3')}</li>
                <li>{t('setupWizard.telegram.guide.step4')}</li>
                <li>{t('setupWizard.telegram.guide.step5')}</li>
              </ol>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="discover-telegram-token">
                  {t('setupWizard.telegram.label.botToken')}
                </label>
                <input
                  id="discover-telegram-token"
                  className="h-11 w-full rounded-xl border border-border/70 bg-background/60 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  value={telegramBotToken}
                  onChange={(event) => setTelegramBotToken(event.target.value)}
                  placeholder={t('setupWizard.telegram.placeholder.botToken')}
                  autoComplete="off"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="brand"
                  onClick={() => void onSaveTelegramToken()}
                  disabled={savingTelegram}
                >
                  {savingTelegram ? t('setupWizard.telegram.button.saving') : t('setupWizard.telegram.button.saveConnect')}
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="mx-auto w-full max-w-[280px] rounded-[2rem] border border-border/70 bg-[#0d0f14] p-2 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]">
                <div className="rounded-[1.6rem] border border-border/40 bg-black/70 p-1">
                  <video
                    className="aspect-[9/19.5] w-full rounded-[1.3rem] object-cover"
                    src={externalLinks.botfatherVideo}
                    controls
                    preload="metadata"
                  />
                </div>
              </div>
              <div className="text-center text-xs text-muted-foreground">
                {t('setupWizard.telegram.videoHintPrefix')}{' '}
                <a
                  className="underline underline-offset-2"
                  href={externalLinks.botfatherVideo}
                  target="_blank"
                  rel="noreferrer"
                >
                  botfather.mp4
                </a>
                {t('setupWizard.telegram.videoHintSuffix')}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 md:grid-cols-3">
        <ActionCard
          title={t('discover.recommended.redeem.title')}
          description={t('discover.recommended.redeem.description')}
          busy={busy}
          actions={[
            <Button
              key="open-redeem-box"
              className="w-full"
              onClick={() => void runAction(async () => openRedeemWindow())}
              disabled={busy}
            >
              {t('discover.recommended.redeem.cta')}
            </Button>,
          ]}
        />
        <ActionCard
          title={tr('特别优惠', 'Special Offer')}
          description={tr('来自 Holycrab.ai 的限时折扣优惠', 'Limited Price Discount Offer from Holycrab.ai')}
          busy={busy}
          actions={[
            <Button
              key="open-key-market"
              className="w-full"
              onClick={() => void runAction(async () => openExternalUrl(externalLinks.keyMarketplace))}
              disabled={busy}
            >
              {tr('查看限时优惠', 'View Limited Offer')}
            </Button>,
          ]}
        />
        <ActionCard
          title={t('discover.recommended.telegram.title')}
          description={t('discover.recommended.telegram.description')}
          busy={busy || savingTelegram}
          actions={[
            <Button
              key="connect-openclaw-telegram"
              className="w-full"
              onClick={() => {
                setTelegramError(null)
                setTelegramDialogOpen(true)
              }}
              disabled={busy || savingTelegram}
            >
              {t('discover.recommended.telegram.cta')}
            </Button>,
          ]}
        />
      </div>
    </div>
  )
}

function ActionCard({
  title,
  description,
  busy,
  actions,
}: {
  title: string
  description?: string
  busy: boolean
  actions: ReactNode[]
}) {
  return (
    <Card className="bg-surface-elevated">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        <div className="grid gap-2">
          {actions.map((action, index) => (
            <div key={`${title}-${index}`} className={busy ? 'pointer-events-none opacity-80' : ''}>
              {action}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
