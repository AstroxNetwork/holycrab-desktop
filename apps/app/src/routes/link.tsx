import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@ui/components/card'
import { useLocale } from '@/lib/locale-context'
import { openSetupWizardWindow } from '@/lib/setup-wizard-window'

export const Route = createFileRoute('/link')({
  component: LinkDispatcherPage,
})

function decodeParam(raw: string | null): string | null {
  if (!raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function LinkDispatcherPage() {
  const { t } = useLocale()

  const params = useMemo(() => {
    // We use hash routing, so parse from location.hash for robustness.
    const hash = window.location.hash || ''
    const query = hash.includes('?') ? hash.split('?').slice(1).join('?') : ''
    return new URLSearchParams(query)
  }, [])

  const deepLinkUrl = decodeParam(params.get('url') || params.get('dl') || params.get('deepLink'))
  const directCode = (decodeParam(params.get('code')) || '').trim()
  const to = (params.get('to') || '').toLowerCase()

  const { targetHash, parseError } = useMemo(() => {
    const redeemTarget = directCode ? `#/redeem?code=${encodeURIComponent(directCode)}` : '#/redeem'
    const dashboardKeysTarget = '#/keys'
    const companionLabsTarget = '#/labs/companion'
    const dashboardSettingsTarget = '#/settings'
    const dashboardDevTarget = '#/dev-config'
    const communityLabsTarget = '#/community?panel=labs'
    const communityDiscoverTarget = '#/community?panel=discover'

    // Prefer explicit routing hints.
    if (to === 'keys') return { targetHash: dashboardKeysTarget, parseError: null as string | null }
    if (to === 'companion') return { targetHash: companionLabsTarget, parseError: null }
    if (to === 'setup-wizard' || to === 'wizard' || to === 'setup') return { targetHash: '#/setup-wizard', parseError: null }
    if (to === 'settings') return { targetHash: dashboardSettingsTarget, parseError: null }
    if (to === 'dev' || to === 'dev-config') return { targetHash: dashboardDevTarget, parseError: null }
    if (to === 'labs') return { targetHash: communityLabsTarget, parseError: null }
    if (to === 'discover' || to === 'community') return { targetHash: communityDiscoverTarget, parseError: null }
    if (to === 'redeem') return { targetHash: redeemTarget, parseError: null }

    if (!deepLinkUrl) return { targetHash: '#/chat', parseError: null }

    try {
      const u = new URL(deepLinkUrl)

      // Examples we accept:
      // - holycrab://keys
      // - holycrab://link?to=keys
      // - holycrab://setup-wizard
      const host = (u.host || '').toLowerCase()
      const path = (u.pathname || '').toLowerCase()
      const uTo = (u.searchParams.get('to') || '').toLowerCase()
      const deepCode = (decodeParam(u.searchParams.get('code')) || '').trim()
      const redeemFromDeepLink = deepCode ? `#/redeem?code=${encodeURIComponent(deepCode)}` : '#/redeem'

      if (uTo === 'keys') return { targetHash: dashboardKeysTarget, parseError: null }
      if (uTo === 'setup-wizard' || uTo === 'wizard' || uTo === 'setup') return { targetHash: '#/setup-wizard', parseError: null }
      if (uTo === 'settings') return { targetHash: dashboardSettingsTarget, parseError: null }
      if (uTo === 'companion') return { targetHash: companionLabsTarget, parseError: null }
      if (uTo === 'dev' || uTo === 'dev-config') return { targetHash: dashboardDevTarget, parseError: null }
      if (uTo === 'labs') return { targetHash: communityLabsTarget, parseError: null }
      if (uTo === 'discover' || uTo === 'community') return { targetHash: communityDiscoverTarget, parseError: null }
      if (uTo === 'redeem') return { targetHash: redeemFromDeepLink, parseError: null }

      if (host === 'keys' || path.startsWith('/keys')) return { targetHash: dashboardKeysTarget, parseError: null }
      if (host === 'companion' || path.startsWith('/companion')) return { targetHash: companionLabsTarget, parseError: null }
      if (host === 'setup-wizard' || path.startsWith('/setup-wizard')) return { targetHash: '#/setup-wizard', parseError: null }
      if (host === 'settings' || path.startsWith('/settings')) return { targetHash: dashboardSettingsTarget, parseError: null }
      if (host === 'dev' || host === 'dev-config' || path.startsWith('/dev-config')) return { targetHash: dashboardDevTarget, parseError: null }
      if (host === 'labs' || path.startsWith('/labs')) return { targetHash: communityLabsTarget, parseError: null }
      if (host === 'discover' || host === 'community' || path.startsWith('/discover') || path.startsWith('/community')) {
        return { targetHash: communityDiscoverTarget, parseError: null }
      }
      if (host === 'redeem' || path.startsWith('/redeem')) return { targetHash: redeemFromDeepLink, parseError: null }
      if (
        host === 'software-center'
        || host === 'dashboard'
        || path.startsWith('/software-center')
        || path.startsWith('/dashboard')
      ) {
        return { targetHash: '#/dashboard', parseError: null }
      }
      if (host === 'logs' || host === 'channels' || path.startsWith('/logs') || path.startsWith('/channels')) {
        return { targetHash: '#/dashboard', parseError: null }
      }

      return { targetHash: '#/chat', parseError: null }
    } catch (e) {
      return { targetHash: '#/chat', parseError: String(e) }
    }
  }, [deepLinkUrl, to, directCode])

  useEffect(() => {
    if (targetHash === '#/setup-wizard') {
      void openSetupWizardWindow('openclaw')
        .catch((error) => {
          console.error('failed to open setup wizard window from deep link', error)
        })
        .finally(() => {
          if (window.location.hash !== '#/chat') {
            window.location.hash = '#/chat'
          }
        })
      return
    }

    // Avoid infinite loops.
    if (window.location.hash === targetHash) return
    window.location.hash = targetHash
  }, [targetHash])

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 pb-6">
      <Card className="bg-surface-elevated">
        <CardHeader>
          <CardTitle>{t('link.page.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <div>{t('link.page.subtitle')}</div>
          {deepLinkUrl ? <div className="font-mono text-xs break-all">{deepLinkUrl}</div> : null}
          {parseError ? <div className="text-xs text-red-600">{parseError}</div> : null}
        </CardContent>
      </Card>
    </div>
  )
}
