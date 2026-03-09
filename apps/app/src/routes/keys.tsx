import { createFileRoute, useRouterState } from '@tanstack/react-router'
import { Button } from '@ui/components/button'
import { ProviderKeysManager } from '@/components/provider-keys-manager'
import { useLocale } from '@/lib/locale-context'
import { openExternalUrl } from '@/lib/openclaw-handoff'
import { externalLinks } from '@/lib/external-links'
import { openSetupWizardWindow } from '@/lib/setup-wizard-window'

export const Route = createFileRoute('/keys')({
  component: KeysPage,
})

function KeysPage() {
  const { t } = useLocale()
  const routeSearch = useRouterState({ select: (state) => state.location.search as unknown })
  const wizardMode = isWizardMode(routeSearch)

  const onOpenMarketplace = async () => {
    // Marketplace is web-first. It should return via a deep link such as:
    //   holycrab://keys
    //   holycrab://link?to=keys
    await openExternalUrl(externalLinks.keyMarketplace)
  }

  return (
    <div className="mx-auto grid w-full max-w-[1520px] gap-6 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl leading-tight">{t('keys.page.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('keys.page.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {wizardMode ? (
            <>
              <Button variant="brand" onClick={() => void openSetupWizardWindow('openclaw')}>
                {t('keys.page.backToWizard')}
              </Button>
              <Button variant="outline" onClick={() => void onOpenMarketplace()}>
                {t('keys.page.openMarketplace')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => void onOpenMarketplace()}>
                {t('keys.page.openMarketplace')}
              </Button>
            </>
          )}
        </div>
      </div>

      <ProviderKeysManager />
    </div>
  )
}

function isWizardMode(search: unknown): boolean {
  if (!search) return false
  if (typeof search === 'string') {
    const raw = search.startsWith('?') ? search.slice(1) : search
    return new URLSearchParams(raw).get('wizard') === '1'
  }
  if (typeof search === 'object') {
    const value = (search as Record<string, unknown>).wizard
    return value === true || String(value) === '1'
  }
  return false
}
