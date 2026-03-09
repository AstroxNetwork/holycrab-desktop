import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@ui/components/button'
import { Card, CardContent } from '@ui/components/card'
import { Input } from '@ui/components/input'
import { getDevRuntimeConfig } from '@/lib/dev-runtime-config'
import { publishLifecycleTask } from '@/lib/lifecycle-bus'
import { canonicalProviderId, defaultBaseUrl, saveProviderSetup } from '@/lib/provider-setup'
import { getProviderState } from '@/lib/provider-state'
import { tauriInvoke } from '@/lib/tauri'
import { useLocale } from '@/lib/locale-context'
import { useLifecycleStore } from '@/stores/lifecycle-store'

export const Route = createFileRoute('/redeem')({
  component: RedeemPage,
})

function redeemApiBaseUrl() {
  return getDevRuntimeConfig().redeemApiBaseUrl.replace(/\/+$/, '')
}

interface RedeemVerifyPayload {
  provider: string
  model: string
  apiKey: string
  baseUrl?: string | null
  api?: string | null
  headers?: Record<string, unknown> | null
  authHeader?: boolean | null
  name?: string | null
  reasoning?: boolean | null
  contextWindow?: number | null
  maxTokens?: number | null
  input?: string[] | null
  extraParams?: Record<string, unknown>
}

interface RedeemVerifyResult {
  provider: string
  baseUrl: string
  model: string
  apiKey: string
  customParams: Record<string, unknown>
}

interface RedeemApiEnvelopeItem {
  resource?: string | Record<string, unknown> | null
}

type Translate = (key: string) => string

interface RedeemApiEnvelope {
  code: number
  message?: string | null
  data?: RedeemApiEnvelopeItem[] | null
}

function decodeParam(raw: string | null): string | null {
  if (!raw) return null
  let current = raw
  for (let i = 0; i < 2; i += 1) {
    try {
      const next = decodeURIComponent(current)
      if (next === current) return current
      current = next
    } catch {
      return current
    }
  }
  return current
}

function getHashSearchParams() {
  const hash = window.location.hash || ''
  const query = hash.includes('?') ? hash.split('?').slice(1).join('?') : ''
  return new URLSearchParams(query)
}

function extractCodeFromDeepLink(raw: string | null): string {
  const decoded = decodeParam(raw)
  if (!decoded) return ''
  try {
    const url = new URL(decoded)
    return (url.searchParams.get('code') || '').trim()
  } catch {
    const query = decoded.includes('?') ? decoded.split('?').slice(1).join('?') : decoded
    return (new URLSearchParams(query).get('code') || '').trim()
  }
}

function resolveInitialRedeemCode() {
  const params = getHashSearchParams()
  const directCode = (decodeParam(params.get('code')) || '').trim()
  if (directCode) return directCode
  return extractCodeFromDeepLink(params.get('url') || params.get('dl') || params.get('deepLink'))
}

function normalizeCustomApi(raw: unknown) {
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return normalized === 'anthropic-messages' ? 'anthropic-messages' : 'openai-completions'
}

function parseHeadersObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return {}
    }
    return {}
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return {}
}

function parseOptionalPositiveInteger(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.floor(raw)
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw.trim(), 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

function parseOptionalStringArray(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const normalized = raw
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
  return normalized.length > 0 ? normalized : null
}

function isKnownProvider(provider: string) {
  if (!provider) return false
  if (provider === 'custom') return true
  return defaultBaseUrl(provider).trim().length > 0
}

function resolveProviderFromPayload(payloadProvider: string, model: string) {
  const normalizedPayload = payloadProvider.trim().toLowerCase().replace(/_/g, '-')
  if (normalizedPayload) {
    const payloadCanonical = canonicalProviderId(normalizedPayload)
    if (isKnownProvider(payloadCanonical)) return payloadCanonical
    const normalizedMapped = normalizeProviderId(normalizedPayload)
    if (
      normalizedMapped
      && (normalizedMapped !== 'openai' || normalizedPayload === 'openai' || normalizedPayload === 'gpt')
    ) {
      const mappedCanonical = canonicalProviderId(normalizedMapped)
      if (isKnownProvider(mappedCanonical)) return mappedCanonical
    }
  }

  const hintedProvider = inferProviderFromModelRef(model)
  if (hintedProvider) {
    const hintedCanonical = canonicalProviderId(normalizeProviderId(hintedProvider))
    if (isKnownProvider(hintedCanonical)) return hintedCanonical
  }
  return 'custom'
}

function normalizeProviderId(rawProvider: string) {
  const normalized = (rawProvider || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')

  if (!normalized) return 'openai'
  if (normalized === 'naci-anthropic') return 'naci-anthropic'
  if (normalized === 'naci-openai') return 'naci-openai'
  if (normalized === 'holycrab' || normalized === 'holycrab-openai' || normalized === 'holycrab-anthropic') {
    return 'holycrab'
  }
  if (normalized === 'zai') return 'zhipu'
  if (normalized === 'deepseek' || normalized === 'deepseek-ai') return 'deepseek-ai'
  if (normalized === 'moonshot-cn' || normalized === 'moonshotai-cn') return 'moonshot-cn'
  if (normalized === 'kimi') return 'moonshot'
  if (normalized === 'claude') return 'anthropic'
  if (normalized === 'gpt' || normalized === 'openai') return 'openai'

  return inferProvider(normalized)
}

function inferProviderFromModelRef(rawModel: string) {
  const model = (rawModel || '').trim()
  if (!model.includes('/')) return ''
  const parts = model.split('/').map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return ''
  if (parts[0].toLowerCase() === 'custom' && parts.length >= 3) {
    return parts[1]
  }
  return parts[0]
}

function normalizeRedeemResult(payload: RedeemVerifyPayload, t: Translate): RedeemVerifyResult {
  const model = (payload.model || '').trim()
  const provider = resolveProviderFromPayload(payload.provider, model)
  const apiKey = (payload.apiKey || '').trim()
  const payloadBaseUrl = (payload.baseUrl || '').trim()
  const resolvedBaseUrl = payloadBaseUrl || defaultBaseUrl(provider)
  const customParams: Record<string, unknown> = {}
  if (typeof payload.api === 'string' && payload.api.trim().length > 0) {
    customParams.api = normalizeCustomApi(payload.api)
  }
  if (payload.headers && Object.keys(payload.headers).length > 0) {
    customParams.headers = payload.headers
  }
  if (payload.authHeader !== null && payload.authHeader !== undefined) {
    customParams.authHeader = payload.authHeader === true
  }
  if (payload.name) customParams.name = payload.name
  if (payload.reasoning !== null && payload.reasoning !== undefined) customParams.reasoning = payload.reasoning
  if (payload.contextWindow) customParams.contextWindow = payload.contextWindow
  if (payload.maxTokens) customParams.maxTokens = payload.maxTokens
  if (payload.input && payload.input.length > 0) customParams.input = payload.input
  if (payload.extraParams) {
    for (const [key, value] of Object.entries(payload.extraParams)) {
      if (key in customParams) continue
      customParams[key] = value
    }
  }

  if (!model) {
    throw new Error(t('redeem.errors.emptyModel'))
  }
  if (!apiKey) {
    throw new Error(t('redeem.errors.emptyApiKey'))
  }

  return {
    provider,
    model,
    apiKey,
    baseUrl: resolvedBaseUrl,
    customParams,
  }
}

function applyProviderCustomParamDefaults(provider: string, customParams: Record<string, unknown>) {
  if (provider !== 'naci-anthropic') return customParams
  const next = { ...customParams }
  next.api = 'anthropic-messages'
  const headers = parseHeadersObject(next.headers)
  if (typeof headers['anthropic-version'] !== 'string' || !String(headers['anthropic-version']).trim()) {
    headers['anthropic-version'] = '2023-06-01'
  }
  next.headers = headers
  next.authHeader = true
  return next
}

function inferProvider(code: string) {
  const normalized = code.toLowerCase()
  const normalizedDashed = normalized.replace(/_/g, '-')
  if (normalized.includes('naci-anthropic')) return 'naci-anthropic'
  if (normalized.includes('naci-openai') || normalized.includes('naci')) return 'naci-openai'
  if (normalized.includes('holycrab') || normalized.includes('agtcloud')) return 'holycrab'
  if (normalized.includes('anthropic') || normalized.includes('claude')) return 'anthropic'
  if (normalized.includes('google') || normalized.includes('gemini')) return 'google'
  if (normalized.includes('openrouter')) return 'openrouter'
  if (normalizedDashed.includes('moonshot-cn') || normalizedDashed.includes('moonshotai-cn')) return 'moonshot-cn'
  if (normalized.includes('moonshot') || normalized.includes('kimi')) return 'moonshot'
  if (normalized.includes('deepseek')) return 'deepseek-ai'
  if (normalized.includes('xai') || normalized.includes('grok')) return 'xai'
  if (normalized.includes('venice')) return 'venice'
  if (normalized.includes('zhipu') || normalized.includes('glm') || normalized.includes('zai')) return 'zhipu'
  return 'openai'
}

function extractRedeemPayload(item: RedeemApiEnvelopeItem, t: Translate): RedeemVerifyPayload {
  const resource = item?.resource
  if (!resource) {
    throw new Error(t('redeem.errors.resourceMissing'))
  }

  let parsed: unknown
  if (typeof resource === 'string') {
    try {
      parsed = JSON.parse(resource)
    } catch {
      throw new Error(t('redeem.errors.resourceInvalidJson'))
    }
  } else {
    parsed = resource
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(t('redeem.errors.resourceInvalidFormat'))
  }

  const record = parsed as Record<string, unknown>
  const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(record, key)
  const reservedKeys = new Set([
    'provider',
    'mode',
    'model',
    'api_key',
    'apiKey',
    'baseUrl',
    'base_url',
    'api',
    'headers',
    'authHeader',
    'name',
    'reasoning',
    'contextWindow',
    'context_window',
    'maxTokens',
    'max_tokens',
    'input',
  ])
  const extraParams: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (reservedKeys.has(key)) continue
    extraParams[key] = value
  }

  const maybeContextWindow = parseOptionalPositiveInteger(record.contextWindow ?? record.context_window)
  const maybeMaxTokens = parseOptionalPositiveInteger(record.maxTokens ?? record.max_tokens)

  return {
    provider: String(record.provider || '').trim(),
    model: String(record.mode || record.model || '').trim(),
    apiKey: String(record.api_key || record.apiKey || '').trim(),
    baseUrl:
      typeof record.baseUrl === 'string'
        ? record.baseUrl
        : typeof record.base_url === 'string'
          ? record.base_url
          : null,
    api: hasOwn('api') && typeof record.api === 'string' ? record.api : null,
    headers: hasOwn('headers') ? parseHeadersObject(record.headers) : null,
    authHeader: hasOwn('authHeader') ? record.authHeader === true : null,
    name: typeof record.name === 'string' ? record.name.trim() : null,
    reasoning: typeof record.reasoning === 'boolean' ? record.reasoning : null,
    contextWindow: maybeContextWindow,
    maxTokens: maybeMaxTokens,
    input: parseOptionalStringArray(record.input),
    extraParams,
  }
}

function parseRedeemEnvelope(envelope: RedeemApiEnvelope, t: Translate): RedeemVerifyResult {
  if (!envelope || envelope.code !== 200) {
    throw new Error((envelope?.message || t('redeem.errors.generic')).toString())
  }

  const firstItem = Array.isArray(envelope.data) ? envelope.data[0] : null
  if (!firstItem) {
    throw new Error(t('redeem.errors.noData'))
  }

  return normalizeRedeemResult(extractRedeemPayload(firstItem, t), t)
}

async function verifyRedeemCode(code: string, t: Translate): Promise<RedeemVerifyResult> {
  const normalized = code.trim()
  if (!normalized) {
    throw new Error(t('redeem.errors.codeRequired'))
  }

  const endpoint = `${redeemApiBaseUrl()}/api/redeem/by_code/${encodeURIComponent(normalized)}`

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    })
  } catch {
    throw new Error(t('redeem.errors.serviceUnavailable'))
  }

  let envelope: RedeemApiEnvelope | null = null
  let rawText = ''
  try {
    rawText = await response.text()
    if (rawText) {
      envelope = JSON.parse(rawText) as RedeemApiEnvelope
    }
  } catch {
    envelope = null
  }

  if (!response.ok) {
    const message = (envelope?.message || `${t('redeem.errors.httpPrefix')} ${response.status}`).toString()
    throw new Error(message)
  }

  if (!envelope) {
    throw new Error(rawText
      ? `${t('redeem.errors.responseInvalidPrefix')}${rawText.slice(0, 120)}${t('redeem.errors.responseInvalidSuffix')}`
      : t('redeem.errors.responseEmpty'))
  }

  return parseRedeemEnvelope(envelope, t)
}

function formatYmd(date: Date) {
  const y = String(date.getFullYear())
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function slugifyPart(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function buildAutoName({
  provider,
  model,
  existingNames,
  now,
}: {
  provider: string
  model: string
  existingNames: string[]
  now: Date
}) {
  const providerSlug = slugifyPart(provider || 'provider')
  const modelSlug = slugifyPart(model || 'model') || 'model'
  const datePart = formatYmd(now)
  const prefix = `${providerSlug}-${modelSlug}-${datePart}-`

  let maxN = 0
  for (const name of existingNames) {
    if (!name?.startsWith(prefix)) continue
    const tail = name.slice(prefix.length)
    const n = Number.parseInt(tail, 10)
    if (Number.isFinite(n) && n > maxN) maxN = n
  }

  return `${prefix}${String(maxN + 1).padStart(2, '0')}`
}

async function closeCurrentWindow() {
  try {
    await tauriInvoke<void>('close_redeem_window')
    return
  } catch {
    // continue to frontend fallback close
  }

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().close()
  } catch {
    try {
      window.close()
    } catch {
      // noop
    }
  }
}

function RedeemPage() {
  const { t } = useLocale()
  const initialCode = useMemo(() => resolveInitialRedeemCode(), [])
  const [code, setCode] = useState(initialCode)
  const [verifying, setVerifying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verifiedResult, setVerifiedResult] = useState<RedeemVerifyResult | null>(null)
  const [verifiedCode, setVerifiedCode] = useState('')
  const [savedName, setSavedName] = useState<string | null>(null)
  const lifecycleTasks = useLifecycleStore((state) => state.tasks)
  const claimedForCurrentCode = !!verifiedResult && verifiedCode === code.trim()
  const verifyingNow = verifying || lifecycleTasks['redeem:verify']?.status === 'running'
  const savingNow = saving || lifecycleTasks['redeem:save']?.status === 'running'

  useEffect(() => {
    if (!verifiedCode) return
    if (verifiedCode === code.trim()) return
    setVerifiedResult(null)
    setSavedName(null)
    setError(null)
  }, [code, verifiedCode])

  const onRedeem = async () => {
    setError(null)
    setSavedName(null)
    setVerifying(true)
    void publishLifecycleTask({
      key: 'redeem:verify',
      scope: 'redeem',
      status: 'running',
      message: 'verifying redeem code',
      source: 'redeem-page',
    }).catch(() => {})
    try {
      const result = await verifyRedeemCode(code, t)
      setVerifiedResult(result)
      setVerifiedCode(code.trim())
      void publishLifecycleTask({
        key: 'redeem:verify',
        scope: 'redeem',
        status: 'completed',
        message: 'redeem code verified',
        source: 'redeem-page',
      }).catch(() => {})
    } catch (err) {
      setVerifiedResult(null)
      setVerifiedCode('')
      setError(String(err instanceof Error ? err.message : err))
      void publishLifecycleTask({
        key: 'redeem:verify',
        scope: 'redeem',
        status: 'error',
        message: String(err),
        source: 'redeem-page',
      }).catch(() => {})
    } finally {
      setVerifying(false)
    }
  }

  const onSaveAndClose = async () => {
    if (!verifiedResult) return
    setError(null)
    setSaving(true)
    void publishLifecycleTask({
      key: 'redeem:save',
      scope: 'redeem',
      status: 'running',
      message: 'saving redeemed provider profile',
      source: 'redeem-page',
    }).catch(() => {})
    try {
      const latestState = await getProviderState()
      const normalizedProvider = canonicalProviderId(verifiedResult.provider)
      const names = latestState.profiles.map((profile) => profile.name)
      const targetName = buildAutoName({
        provider: verifiedResult.provider,
        model: verifiedResult.model,
        existingNames: names,
        now: new Date(),
      })

      const mergedCustomParams = applyProviderCustomParamDefaults(
        normalizedProvider,
        { ...verifiedResult.customParams },
      )

      await saveProviderSetup({
        name: targetName,
        mode: 'custom',
        provider: verifiedResult.provider,
        baseUrl: verifiedResult.baseUrl,
        apiKey: verifiedResult.apiKey,
        model: verifiedResult.model,
        customParams: JSON.stringify(mergedCustomParams),
        setActive: true,
      })

      setSavedName(targetName)
      await closeCurrentWindow()
      void publishLifecycleTask({
        key: 'redeem:save',
        scope: 'redeem',
        status: 'completed',
        message: `redeem profile saved: ${targetName}`,
        source: 'redeem-page',
      }).catch(() => {})
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
      void publishLifecycleTask({
        key: 'redeem:save',
        scope: 'redeem',
        status: 'error',
        message: String(err),
        source: 'redeem-page',
      }).catch(() => {})
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[72vh] w-full max-w-3xl items-center justify-center pb-6">
      <Card className="w-full border border-rose-300/40 bg-gradient-to-br from-rose-500/18 via-red-500/12 to-amber-400/18 shadow-[0_20px_60px_-30px_rgba(251,113,133,0.7)]">
        <CardContent className="space-y-4 p-6 md:p-8">
          <h1 className="font-display text-3xl leading-tight">{t('redeem.page.title')}</h1>

          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={t('redeem.input.placeholder')}
            autoComplete="off"
            disabled={verifyingNow || savingNow}
          />

          <div className="flex flex-wrap items-center gap-2">
            {!claimedForCurrentCode ? (
              <Button variant="brand" onClick={() => void onRedeem()} disabled={verifyingNow || savingNow || !code.trim()}>
                {verifyingNow ? t('redeem.button.claiming') : t('redeem.button.claim')}
              </Button>
            ) : null}

            {verifiedResult ? (
              <Button variant="secondary" onClick={() => void onSaveAndClose()} disabled={savingNow || verifyingNow}>
                {savingNow ? t('redeem.button.saving') : t('redeem.button.saveClose')}
              </Button>
            ) : null}
          </div>

          {error ? (
            <div className="rounded-xl border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
              {error}
            </div>
          ) : null}

          {verifiedResult ? (
            <div className="grid gap-2 rounded-xl border border-amber-200/35 bg-background/55 p-3 text-sm">
              <div><span className="text-muted-foreground">{t('redeem.labels.provider')}:</span> {verifiedResult.provider}</div>
              <div><span className="text-muted-foreground">{t('redeem.labels.model')}:</span> {verifiedResult.model}</div>
              <div className="break-all"><span className="text-muted-foreground">{t('redeem.labels.baseUrl')}:</span> {verifiedResult.baseUrl}</div>
              <div className="break-all"><span className="text-muted-foreground">{t('redeem.labels.apiKey')}:</span> {verifiedResult.apiKey}</div>
            </div>
          ) : null}

          {savedName ? (
            <div className="rounded-xl border border-emerald-300/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
              {t('redeem.messages.saved')}{savedName}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
