import { useEffect, useMemo, useState } from 'react'
import { Button } from '@ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@ui/components/card'
import { Combobox } from '@ui/components/combobox'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ui/components/dialog'
import { Input } from '@ui/components/input'
import { useLocale } from '@/lib/locale-context'
import {
  canonicalProviderId,
  defaultBaseUrl,
  deleteProviderProfile,
  normalizeProviderIdToken,
  saveProviderSetup,
  type ProviderProfileView,
  type ProviderSetupView,
} from '@/lib/provider-setup'
import { markProviderProfilesChanged } from '@/lib/provider-profile-events'
import { getProviderState, type ProviderCatalogItem } from '@/lib/provider-state'

type StatusTone = 'neutral' | 'ok' | 'error'

interface DraftProfile {
  name: string
  provider: string
  model: string
  baseUrl: string
  apiKey: string
  headers: string
  authHeader: boolean
  inputText: boolean
  inputImage: boolean
  preservedCustomParams: Record<string, unknown>
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

  const next = String(maxN + 1).padStart(2, '0')
  return `${prefix}${next}`
}

function buildFallbackProviders() {
  return [
    { id: 'openai', name: 'OpenAI', summary: '', defaultBaseUrl: defaultBaseUrl('openai'), defaultModel: 'gpt-5.2' },
    {
      id: 'anthropic',
      name: 'Anthropic',
      summary: '',
      defaultBaseUrl: defaultBaseUrl('anthropic'),
      defaultModel: 'claude-sonnet-4-5',
    },
    {
      id: 'holycrab',
      name: 'HolyCrab',
      summary: '',
      defaultBaseUrl: defaultBaseUrl('holycrab'),
      defaultModel: 'gpt-5.2-codex',
    },
    {
      id: 'naci-openai',
      name: 'NACI (OpenAI)',
      summary: '',
      defaultBaseUrl: defaultBaseUrl('naci-openai'),
      defaultModel: 'gpt-4.1',
    },
    {
      id: 'naci-anthropic',
      name: 'NACI (Anthropic)',
      summary: '',
      defaultBaseUrl: defaultBaseUrl('naci-anthropic'),
      defaultModel: 'claude-sonnet-4-5',
    },
    { id: 'google', name: 'Google', summary: '', defaultBaseUrl: defaultBaseUrl('google'), defaultModel: 'gemini-2.5-pro' },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      summary: '',
      defaultBaseUrl: defaultBaseUrl('openrouter'),
      defaultModel: 'anthropic/claude-sonnet-4-5',
    },
    {
      id: 'qwen',
      name: 'Qwen (Alibaba)',
      summary: '',
      defaultBaseUrl: defaultBaseUrl('qwen'),
      defaultModel: 'qwen3-coder-480b-a35b-instruct',
    },
    { id: 'moonshot', name: 'Moonshot (Kimi)', summary: '', defaultBaseUrl: defaultBaseUrl('moonshot'), defaultModel: 'kimi-k2.5' },
    { id: 'moonshot-cn', name: 'Moonshot (CN)', summary: '', defaultBaseUrl: defaultBaseUrl('moonshot-cn'), defaultModel: 'kimi-k2.5' },
    { id: 'deepseek', name: 'DeepSeek', summary: '', defaultBaseUrl: defaultBaseUrl('deepseek'), defaultModel: 'deepseek-reasoner' },
    { id: 'litellm', name: 'LiteLLM', summary: '', defaultBaseUrl: defaultBaseUrl('litellm'), defaultModel: 'gpt-4.1' },
    { id: 'minimax', name: 'MiniMax', summary: '', defaultBaseUrl: defaultBaseUrl('minimax'), defaultModel: 'MiniMax-M2.5' },
    { id: 'minimax-cn', name: 'MiniMax (CN)', summary: '', defaultBaseUrl: defaultBaseUrl('minimax-cn'), defaultModel: 'MiniMax-M2.5' },
    { id: 'zhipu', name: 'Zhipu', summary: '', defaultBaseUrl: defaultBaseUrl('zhipu'), defaultModel: 'glm-4.7' },
    { id: 'zai', name: 'Z.AI', summary: '', defaultBaseUrl: defaultBaseUrl('zai'), defaultModel: 'glm-4.7' },
    { id: 'xai', name: 'xAI', summary: '', defaultBaseUrl: defaultBaseUrl('xai'), defaultModel: 'grok-4' },
    { id: 'venice', name: 'Venice', summary: '', defaultBaseUrl: defaultBaseUrl('venice'), defaultModel: 'llama-3.3-70b' },
    { id: 'custom', name: 'Custom', summary: '', defaultBaseUrl: '', defaultModel: '' },
  ] satisfies ProviderCatalogItem[]
}

function resolveProviderId(rawProviderId: string, providers: ProviderCatalogItem[]) {
  const trimmed = rawProviderId.trim()
  if (!trimmed) return ''
  const canonicalInput = canonicalProviderId(trimmed)
  const targetToken = normalizeProviderIdToken(canonicalInput || trimmed)

  const exact = providers.find((item) => normalizeProviderIdToken(item.id) === targetToken)
  if (exact) return exact.id

  const canonicalMatch = providers.find((item) => canonicalProviderId(item.id) === canonicalInput)
  if (canonicalMatch) return canonicalMatch.id

  const byName = providers.find((item) => normalizeProviderIdToken(item.name) === targetToken)
  if (byName) return byName.id

  const fuzzyMatches = providers.filter((item) => {
    const idToken = normalizeProviderIdToken(item.id)
    const nameToken = normalizeProviderIdToken(item.name)
    const canonicalToken = normalizeProviderIdToken(canonicalProviderId(item.id))
    return idToken.includes(targetToken) || nameToken.includes(targetToken) || canonicalToken.includes(targetToken)
  })
  if (fuzzyMatches.length === 1) return fuzzyMatches[0].id

  return 'custom'
}

function buildProviderComboboxOptions(providers: ProviderCatalogItem[]) {
  const options: Array<{ value: string; label: string }> = []
  const seenValues = new Set<string>()
  const seenProviderTokens = new Set<string>()

  const pushOption = (value: string, label: string) => {
    const trimmed = value.trim()
    if (!trimmed || seenValues.has(trimmed)) return
    seenValues.add(trimmed)
    options.push({ value: trimmed, label })
  }

  for (const provider of providers) {
    const providerToken = normalizeProviderIdToken(provider.id)
    if (!providerToken || seenProviderTokens.has(providerToken)) continue
    seenProviderTokens.add(providerToken)
    const label = `${provider.name} (${provider.id})`
    pushOption(provider.id, label)
  }

  return options
}

function dedupeCaseInsensitive(items: string[]) {
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const item of items) {
    const key = item.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }
  return deduped
}

function resolveProviderDefaultBaseUrl(providerId: string, catalogDefaultBaseUrl?: string) {
  const catalogDefault = (catalogDefaultBaseUrl ?? '').trim()
  if (catalogDefault) return catalogDefault
  const mappedDefault = defaultBaseUrl(providerId)
  if (mappedDefault) return mappedDefault
  return ''
}

function buildDraft(provider: ProviderCatalogItem | null): DraftProfile {
  const providerId = provider?.id ?? 'openai'
  return {
    name: '',
    provider: providerId,
    model: provider?.defaultModel ?? '',
    baseUrl: resolveProviderDefaultBaseUrl(providerId, provider?.defaultBaseUrl),
    apiKey: '',
    headers: '{}',
    authHeader: false,
    inputText: true,
    inputImage: true,
    preservedCustomParams: {},
  }
}

function parseProfileCustomParamsDraft(customParams: string): {
  headers: string
  authHeader: boolean
  inputText: boolean
  inputImage: boolean
  preservedCustomParams: Record<string, unknown>
} {
  const parseInputFlags = (value: unknown): { inputText: boolean; inputImage: boolean } => {
    if (Array.isArray(value)) {
      const tokens = value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
      const deduped = new Set(tokens)
      return {
        inputText: deduped.has('text'),
        inputImage: deduped.has('image'),
      }
    }
    if (typeof value === 'string') {
      const token = value.trim().toLowerCase()
      if (token === 'text') return { inputText: true, inputImage: false }
      if (token === 'image') return { inputText: false, inputImage: true }
    }
    return { inputText: true, inputImage: true }
  }

  const trimmed = customParams.trim()
  if (!trimmed) {
    return { headers: '{}', authHeader: false, inputText: true, inputImage: true, preservedCustomParams: {} }
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { headers: '{}', authHeader: false, inputText: true, inputImage: true, preservedCustomParams: {} }
    }
    const parsedObject = parsed as Record<string, unknown>
    const authHeader = parsedObject.authHeader === true
    const inputFlags = parseInputFlags(parsedObject.input)
    const headersCandidate = parsedObject.headers
    let explicitHeaders: Record<string, unknown> | null = null
    if (headersCandidate && typeof headersCandidate === 'object' && !Array.isArray(headersCandidate)) {
      explicitHeaders = headersCandidate as Record<string, unknown>
    } else if (typeof headersCandidate === 'string' && headersCandidate.trim().length > 0) {
      try {
        const parsedHeaders = JSON.parse(headersCandidate)
        if (parsedHeaders && typeof parsedHeaders === 'object' && !Array.isArray(parsedHeaders)) {
          explicitHeaders = parsedHeaders as Record<string, unknown>
        }
      } catch {
        explicitHeaders = null
      }
    }
    const hasExplicitHeaders = Boolean(explicitHeaders)

    const headersSource: Record<string, unknown> = hasExplicitHeaders
      ? (explicitHeaders as Record<string, unknown>)
      : Object.fromEntries(
          Object.entries(parsedObject).filter(
            ([key]) => key !== 'authHeader' && key !== 'api' && key !== 'headers' && key !== 'input',
          ),
        )

    const preservedCustomParams: Record<string, unknown> = {}
    if (typeof parsedObject.api === 'string' && parsedObject.api.trim().length > 0) {
      preservedCustomParams.api = parsedObject.api
    }
    if (hasExplicitHeaders) {
      for (const [key, value] of Object.entries(parsedObject)) {
        if (key === 'headers' || key === 'authHeader' || key === 'api' || key === 'input') continue
        preservedCustomParams[key] = value
      }
    }

    return {
      headers: JSON.stringify(headersSource, null, 2),
      authHeader,
      inputText: inputFlags.inputText,
      inputImage: inputFlags.inputImage,
      preservedCustomParams,
    }
  } catch {
    return { headers: '{}', authHeader: false, inputText: true, inputImage: true, preservedCustomParams: {} }
  }
}

function parseHeadersInput(raw: string): Record<string, unknown> | null {
  const candidate = raw.trim() || '{}'
  try {
    const parsed = JSON.parse(candidate)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export function ProviderKeysManager() {
  const { t } = useLocale()
  const [providerSetup, setProviderSetup] = useState<ProviderSetupView | null>(null)
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalogItem[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftProfile>(() => buildDraft(null))
  const [advancedExpanded, setAdvancedExpanded] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [statusTone, setStatusTone] = useState<StatusTone>('neutral')

  const providers = useMemo<ProviderCatalogItem[]>(
    () => (providerCatalog.length > 0 ? providerCatalog : buildFallbackProviders()),
    [providerCatalog],
  )

  const selectedProviderMeta = useMemo(
    () => providers.find((item) => item.id === draft.provider) ?? null,
    [providers, draft.provider],
  )
  const providerOptions = useMemo(() => buildProviderComboboxOptions(providers), [providers])

  const modelSuggestions = useMemo(() => {
    const fromMetadata = (selectedProviderMeta?.modelMetadata ?? [])
      .map((item) => item.id)
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    const fromSuggestions = (selectedProviderMeta?.modelSuggestions ?? []).filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    )
    const fromDefault =
      typeof selectedProviderMeta?.defaultModel === 'string' && selectedProviderMeta.defaultModel.trim().length > 0
        ? [selectedProviderMeta.defaultModel]
        : []
    return dedupeCaseInsensitive([...fromDefault, ...fromMetadata, ...fromSuggestions])
  }, [
    selectedProviderMeta?.defaultModel,
    selectedProviderMeta?.modelSuggestions,
    selectedProviderMeta?.modelMetadata,
  ])

  const visibleProfiles = useMemo(
    () => (providerSetup?.profiles ?? []).filter((item) => item.id !== 'default'),
    [providerSetup?.profiles],
  )
  const existingNames = useMemo(() => visibleProfiles.map((item) => item.name), [visibleProfiles])

  const load = async () => {
    const state = await getProviderState()
    setProviderSetup({
      profiles: state.profiles,
      activeProfileId: state.activeProfileId,
      configured: state.configured,
    })
    setProviderCatalog(state.providers)
  }

  useEffect(() => {
    void load().catch((err) => {
      console.error(err)
      setStatus(`Provider load failed: ${String(err)}`)
      setStatusTone('error')
    })
  }, [])

  const openCreateDialog = () => {
    const nextProvider = providers.find((item) => item.id === 'openai') ?? providers[0] ?? null
    setEditingProfileId(null)
    setDraft(buildDraft(nextProvider))
    setAdvancedExpanded(false)
    setShowApiKey(false)
    setStatus(null)
    setStatusTone('neutral')
    setDialogOpen(true)
  }

  const openEditDialog = (profile: ProviderProfileView) => {
    const resolvedProvider = resolveProviderId(profile.provider || '', providers)
    const nextProvider = resolvedProvider || 'custom'
    const providerMeta = providers.find((item) => item.id === nextProvider) ?? null
    const existingApiKey = profile.apiKey || ''
    const parsedCustomParams = parseProfileCustomParamsDraft(profile.customParams || '')
    setEditingProfileId(profile.id)
    setDraft({
      name: profile.name || '',
      provider: nextProvider,
      model: profile.model || '',
      baseUrl: profile.baseUrl || resolveProviderDefaultBaseUrl(nextProvider, providerMeta?.defaultBaseUrl),
      apiKey: existingApiKey,
      headers: parsedCustomParams.headers,
      authHeader: parsedCustomParams.authHeader,
      inputText: parsedCustomParams.inputText,
      inputImage: parsedCustomParams.inputImage,
      preservedCustomParams: parsedCustomParams.preservedCustomParams,
    })
    setAdvancedExpanded(true)
    setShowApiKey(false)
    setStatus(null)
    setStatusTone('neutral')
    setDialogOpen(true)
  }

  const onDraftProviderChange = (providerInput: string) => {
    const providerId = resolveProviderId(providerInput, providers)
    if (!providerId) return
    const meta = providers.find((item) => item.id === providerId) ?? null
    setDraft((prev) => ({
      ...prev,
      provider: providerId,
      model: meta?.defaultModel || prev.model,
      baseUrl: resolveProviderDefaultBaseUrl(providerId, meta?.defaultBaseUrl) || prev.baseUrl,
      preservedCustomParams: providerId === prev.provider ? prev.preservedCustomParams : {},
    }))
  }

  const isEditing = editingProfileId !== null

  const validateDraft = () => {
    if (!draft.baseUrl.trim()) {
      setStatus(t('keys.errors.baseUrlRequired'))
      setStatusTone('error')
      return false
    }
    if (!draft.model.trim()) {
      setStatus(t('keys.errors.modelRequired'))
      setStatusTone('error')
      return false
    }
    if (!isEditing && !draft.apiKey.trim()) {
      setStatus(t('keys.errors.apiKeyRequired'))
      setStatusTone('error')
      return false
    }
    return true
  }

  const onSave = async () => {
    if (!validateDraft()) return
    const parsedHeaders = parseHeadersInput(draft.headers)
    if (!parsedHeaders) {
      setStatus(t('keys.errors.headersJsonInvalid'))
      setStatusTone('error')
      return
    }
    setSaving(true)
    try {
      const profileName =
        draft.name.trim() ||
        buildAutoName({
          provider: draft.provider,
          model: draft.model.trim(),
          existingNames,
          now: new Date(),
        })

      const nextApiKey = draft.apiKey.trim()
      const inputCapabilities: string[] = []
      if (draft.inputText) inputCapabilities.push('text')
      if (draft.inputImage) inputCapabilities.push('image')
      const customParams = {
        ...draft.preservedCustomParams,
        headers: parsedHeaders,
        authHeader: draft.authHeader,
        input: inputCapabilities,
      }
      await saveProviderSetup({
        profileId: editingProfileId ?? undefined,
        name: profileName,
        mode: 'custom',
        provider: draft.provider,
        baseUrl: draft.baseUrl.trim(),
        ...(nextApiKey ? { apiKey: nextApiKey } : {}),
        model: draft.model.trim(),
        customParams: JSON.stringify(customParams),
        setActive: false,
      })

      setDialogOpen(false)
      setEditingProfileId(null)
      setStatus(t('keys.messages.saved'))
      setStatusTone('ok')
      await load()
      markProviderProfilesChanged()
    } catch (err) {
      setStatus(`${t('keys.messages.saveFailed')}: ${String(err)}`)
      setStatusTone('error')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (profileId: string) => {
    setDeletingId(profileId)
    try {
      await deleteProviderProfile(profileId)
      setStatus(t('keys.messages.deleted'))
      setStatusTone('ok')
      await load()
      markProviderProfilesChanged()
    } catch (err) {
      setStatus(`${t('keys.messages.deleteFailed')}: ${String(err)}`)
      setStatusTone('error')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Card className="border border-border/55 bg-layer-elevated shadow-[0_10px_28px_-20px_hsl(var(--foreground)/0.45)]">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('keys.sections.profiles')}</CardTitle>
        <Button onClick={openCreateDialog}>{t('keys.manager.newProfile')}</Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {visibleProfiles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/45 bg-layer-subtle/90 p-6 text-sm text-muted-foreground">
            <div>{t('keys.manager.description')}</div>
            <Button className="mt-4" onClick={openCreateDialog}>
              {t('keys.manager.newProfile')}
            </Button>
          </div>
        ) : (
          visibleProfiles.map((profile: ProviderProfileView) => {
            return (
              <div
                key={profile.id}
                className="rounded-2xl border border-border/45 bg-layer-subtle/90 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold">{profile.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {profile.provider} · {profile.model || '-'}
                    </div>
                    <div className="text-xs text-muted-foreground">{profile.baseUrl || '-'}</div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEditDialog(profile)}
                    >
                      {t('keys.actions.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deletingId === profile.id}
                      onClick={() => void onDelete(profile.id)}
                    >
                      {deletingId === profile.id ? t('keys.actions.deleting') : t('keys.actions.delete')}
                    </Button>
                  </div>
                </div>
              </div>
            )
          })
        )}

        {status ? (
          <div
            className={`rounded-xl p-3 text-sm ${
              statusTone === 'ok'
                ? 'bg-emerald-500/10 text-emerald-200'
                : statusTone === 'error'
                  ? 'bg-red-500/10 text-red-200'
                  : 'bg-layer-subtle/90 text-muted-foreground'
            }`}
          >
            {status}
          </div>
        ) : null}
      </CardContent>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setEditingProfileId(null)
        }}
      >
        <DialogContent className="max-w-2xl border-border/60 bg-card">
          <DialogHeader>
            <DialogTitle>{isEditing ? t('keys.actions.edit') : t('keys.manager.newProfile')}</DialogTitle>
            <DialogDescription>{t('keys.manager.description')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-2">
                <div className="text-sm font-medium">{t('keys.fields.provider')}</div>
                <Combobox
                  value={draft.provider}
                  onValueChange={onDraftProviderChange}
                  placeholder={selectedProviderMeta?.name || t('keys.fields.provider')}
                  searchPlaceholder={t('keys.fields.searchPlaceholder')}
                  options={providerOptions}
                  allowCustom={false}
                />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">{t('keys.fields.model')}</div>
                <Combobox
                  value={draft.model}
                  onValueChange={(value) => setDraft((prev) => ({ ...prev, model: value }))}
                  placeholder={selectedProviderMeta?.defaultModel || t('keys.fields.model')}
                  searchPlaceholder={t('keys.fields.searchPlaceholder')}
                  options={modelSuggestions.map((item) => ({ value: item, label: item }))}
                  allowCustom
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">{t('keys.fields.profileName')}</div>
              <Input
                value={draft.name}
                onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={t('keys.fields.profileNamePlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">{t('keys.fields.baseUrl')}</div>
              <Input
                value={draft.baseUrl}
                onChange={(e) => setDraft((prev) => ({ ...prev, baseUrl: e.target.value }))}
                placeholder={t('keys.fields.baseUrl')}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{t('keys.fields.apiKey')}</div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowApiKey((value) => !value)}
                >
                  {showApiKey ? t('keys.actions.hide') : t('keys.actions.show')}
                </Button>
              </div>
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(e) => setDraft((prev) => ({ ...prev, apiKey: e.target.value }))}
                placeholder={t('keys.fields.apiKeyPlaceholder')}
                autoComplete="off"
              />
            </div>

            <div className="space-y-3 rounded-xl border border-border/60 bg-background/30 p-3">
              <button
                type="button"
                className="inline-flex items-center gap-2 text-sm font-medium text-foreground"
                onClick={() => setAdvancedExpanded((prev) => !prev)}
              >
                {advancedExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                {t('keys.actions.showAdvanced')}
              </button>

              {advancedExpanded ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">{t('keys.fields.headers')}</div>
                    <textarea
                      className="min-h-24 w-full rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/30"
                      value={draft.headers}
                      onChange={(e) => setDraft((prev) => ({ ...prev, headers: e.target.value }))}
                      placeholder="{}"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="flex select-none items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={draft.authHeader}
                        onChange={(e) => setDraft((prev) => ({ ...prev, authHeader: e.target.checked }))}
                      />
                      {t('keys.fields.authHeader')}
                    </label>
                    <div className="text-xs text-muted-foreground">{t('keys.hint.authHeader')}</div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium">{t('keys.fields.inputCapabilities')}</div>
                    <label className="flex select-none items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.inputText}
                        onChange={(e) => setDraft((prev) => ({ ...prev, inputText: e.target.checked }))}
                      />
                      {t('keys.fields.inputText')}
                    </label>
                    <label className="flex select-none items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.inputImage}
                        onChange={(e) => setDraft((prev) => ({ ...prev, inputImage: e.target.checked }))}
                      />
                      {t('keys.fields.inputImage')}
                    </label>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('keys.delete.cancel')}
            </Button>
            <Button onClick={() => void onSave()} disabled={saving}>
              {saving ? t('keys.actions.saving') : t('keys.actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
