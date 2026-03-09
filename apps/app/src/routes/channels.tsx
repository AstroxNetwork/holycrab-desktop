import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@ui/components/card'
import { Input } from '@ui/components/input'
import telegramChannelIcon from '@/assets/channels/telegram.svg'
import feishuChannelIcon from '@/assets/channels/feishu.svg'
import discordChannelIcon from '@/assets/channels/discord.svg'
import slackChannelIcon from '@/assets/channels/slack.svg'
import imessageChannelIcon from '@/assets/channels/imessage.svg'
import whatsappChannelIcon from '@/assets/channels/whatsapp.svg'
import wechatChannelIcon from '@/assets/channels/wechat.svg'
import dingtalkChannelIcon from '@/assets/channels/dingtalk.svg'
import signalChannelIcon from '@/assets/channels/signal.svg'
import {
  clearChannelConfig,
  getChannelsConfig,
  saveChannelConfig,
  startChannelLogin,
  testChannel,
} from '@/lib/openclaw-config'
import { publishLifecycleTask } from '@/lib/lifecycle-bus'
import { useLocale } from '@/lib/locale-context'
import { useChatStore } from '@/stores/chat-store'
import { useLifecycleStore } from '@/stores/lifecycle-store'

export const Route = createFileRoute('/channels')({
  component: ChannelsPage,
})

type ChannelView = {
  id: string
  label: string
  configured: boolean
  enabled: boolean
  config: Record<string, unknown>
}

type ChannelLocaleText = { en: string; zh: string }

type ChannelFieldDefinition = {
  key: string
  type: 'text' | 'password'
  label: ChannelLocaleText
  placeholder?: ChannelLocaleText
  aliases?: string[]
}

const SECRET_FIELD_PATTERN = /(token|secret|password|passcode|key|aes)/i

const text = (en: string, zh?: string): ChannelLocaleText => ({ en, zh: zh ?? en })

const field = (
  key: string,
  label: ChannelLocaleText,
  options?: { type?: 'text' | 'password'; placeholder?: ChannelLocaleText; aliases?: string[] },
): ChannelFieldDefinition => ({
  key,
  type: options?.type ?? 'text',
  label,
  placeholder: options?.placeholder,
  aliases: options?.aliases,
})

const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  feishu: 'Feishu',
  imessage: 'iMessage',
  whatsapp: 'WhatsApp',
  wechat: 'WeChat',
  dingtalk: 'DingTalk',
  signal: 'Signal',
}

const CHANNEL_ORDER = [
  'telegram',
  'discord',
  'slack',
  'feishu',
  'imessage',
  'whatsapp',
  'wechat',
  'dingtalk',
  'signal',
]

const CHANNEL_ICON_MAP: Record<string, string> = {
  telegram: telegramChannelIcon,
  feishu: feishuChannelIcon,
  discord: discordChannelIcon,
  slack: slackChannelIcon,
  imessage: imessageChannelIcon,
  whatsapp: whatsappChannelIcon,
  wechat: wechatChannelIcon,
  dingtalk: dingtalkChannelIcon,
  signal: signalChannelIcon,
}

const CHANNEL_FIELD_DEFINITIONS: Record<string, ChannelFieldDefinition[]> = {
  telegram: [
    field('botToken', text('Bot Token'), { type: 'password', placeholder: text('123456:ABCDEF...'), aliases: ['bot_token', 'token'] }),
    field('chatId', text('Chat ID', '会话 ID'), { placeholder: text('-1001234567890'), aliases: ['chat_id'] }),
    field('allowFrom', text('Allow From', '允许来源'), { placeholder: text('user_a,user_b'), aliases: ['allow_from'] }),
  ],
  discord: [
    field('botToken', text('Bot Token'), { type: 'password', placeholder: text('Discord bot token'), aliases: ['bot_token', 'token'] }),
    field('guildId', text('Guild ID', '服务器 ID'), { aliases: ['guild_id', 'serverId', 'server_id'] }),
    field('channelId', text('Channel ID', '频道 ID'), { aliases: ['channel_id'] }),
  ],
  slack: [
    field('botToken', text('Bot Token'), { type: 'password', placeholder: text('xoxb-***'), aliases: ['bot_token', 'token'] }),
    field('appToken', text('App Token'), { type: 'password', placeholder: text('xapp-***'), aliases: ['app_token'] }),
    field('signingSecret', text('Signing Secret', '签名密钥'), { type: 'password', aliases: ['signing_secret'] }),
    field('channelId', text('Channel ID', '频道 ID'), { aliases: ['channel_id'] }),
  ],
  feishu: [
    field('appId', text('App ID', '应用 ID'), { aliases: ['app_id', 'clientId', 'client_id'] }),
    field('appSecret', text('App Secret', '应用密钥'), { type: 'password', aliases: ['app_secret', 'clientSecret', 'client_secret'] }),
    field('verificationToken', text('Verification Token', '校验 Token'), { type: 'password', aliases: ['verification_token'] }),
    field('encryptKey', text('Encrypt Key', '加密 Key'), { type: 'password', aliases: ['encrypt_key'] }),
  ],
  imessage: [
    field('appleId', text('Apple ID'), { aliases: ['apple_id', 'account'] }),
    field('password', text('Password', '密码'), { type: 'password', aliases: ['passcode'] }),
    field('sender', text('Sender', '发送方'), { aliases: ['senderId', 'sender_id'] }),
  ],
  whatsapp: [
    field('accessToken', text('Access Token', '访问 Token'), { type: 'password', aliases: ['access_token', 'token'] }),
    field('phoneNumberId', text('Phone Number ID', '手机号 ID'), { aliases: ['phone_number_id'] }),
    field('businessAccountId', text('Business Account ID', '企业账号 ID'), { aliases: ['business_account_id', 'wabaId', 'waba_id'] }),
    field('verifyToken', text('Verify Token', '校验 Token'), { type: 'password', aliases: ['verify_token'] }),
  ],
  wechat: [
    field('appId', text('App ID', '应用 ID'), { aliases: ['app_id'] }),
    field('appSecret', text('App Secret', '应用密钥'), { type: 'password', aliases: ['app_secret'] }),
    field('token', text('Token'), { type: 'password' }),
    field('encodingAESKey', text('Encoding AES Key'), { type: 'password', aliases: ['encoding_aes_key'] }),
  ],
  dingtalk: [
    field('appKey', text('App Key', '应用 Key'), { aliases: ['app_key'] }),
    field('appSecret', text('App Secret', '应用密钥'), { type: 'password', aliases: ['app_secret'] }),
    field('robotCode', text('Robot Code', '机器人编码'), { aliases: ['robot_code'] }),
    field('webhookSecret', text('Webhook Secret', 'Webhook 密钥'), { type: 'password', aliases: ['webhook_secret'] }),
  ],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function localizedText(value: ChannelLocaleText, locale: 'en' | 'zh') {
  return value[locale]
}

function resolveFieldKey(config: Record<string, unknown>, fieldDef: ChannelFieldDefinition) {
  const candidates = [fieldDef.key, ...(fieldDef.aliases ?? [])]
  return candidates.find((candidate) => Object.prototype.hasOwnProperty.call(config, candidate)) ?? fieldDef.key
}

function isSecretField(fieldDef: ChannelFieldDefinition) {
  if (fieldDef.type === 'password') return true
  const candidates = [fieldDef.key, ...(fieldDef.aliases ?? [])]
  return candidates.some((candidate) => SECRET_FIELD_PATTERN.test(candidate))
}

function readFieldValue(config: Record<string, unknown>, fieldDef: ChannelFieldDefinition) {
  const key = resolveFieldKey(config, fieldDef)
  const value = config[key]
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function updateFieldValue(config: Record<string, unknown>, fieldDef: ChannelFieldDefinition, value: string) {
  const key = resolveFieldKey(config, fieldDef)
  const next = { ...config }

  if (!value.trim()) {
    delete next[key]
    return next
  }

  next[key] = value
  return next
}

function normalizeChannelEntry(raw: unknown, fallbackId?: string): ChannelView | null {
  if (!isRecord(raw)) return null

  const id = String(raw.id ?? raw.channel ?? fallbackId ?? '').trim().toLowerCase()
  if (!id) return null

  const label = String(raw.label ?? raw.name ?? CHANNEL_LABELS[id] ?? id).trim() || id
  const configured = Boolean(raw.configured)
  const enabled = raw.enabled === undefined ? true : Boolean(raw.enabled)
  const configCandidate = [raw.config, raw.values, raw.form, raw.settings, raw.data].find((value) => isRecord(value))

  return {
    id,
    label,
    configured,
    enabled,
    config: isRecord(configCandidate) ? configCandidate : {},
  }
}

function normalizeChannels(payload: unknown): ChannelView[] {
  const list: ChannelView[] = []

  const pushIfValid = (item: unknown, fallbackId?: string) => {
    const normalized = normalizeChannelEntry(item, fallbackId)
    if (!normalized) return
    if (list.some((existing) => existing.id === normalized.id)) return
    list.push(normalized)
  }

  if (Array.isArray(payload)) {
    payload.forEach((item) => pushIfValid(item))
  }

  if (isRecord(payload)) {
    const rawChannels = (payload as { channels?: unknown }).channels
    if (Array.isArray(rawChannels)) {
      rawChannels.forEach((item) => pushIfValid(item))
    } else if (isRecord(rawChannels)) {
      for (const [id, item] of Object.entries(rawChannels)) {
        pushIfValid(item, id)
      }
    }

    if (list.length === 0) {
      for (const [id, item] of Object.entries(payload)) {
        if (isRecord(item)) pushIfValid(item, id)
      }
    }
  }

  for (const id of CHANNEL_ORDER) {
    if (list.some((item) => item.id === id)) continue
    list.push({ id, label: CHANNEL_LABELS[id] ?? id, configured: false, enabled: true, config: {} })
  }

  return list.sort((a, b) => {
    const orderA = CHANNEL_ORDER.indexOf(a.id)
    const orderB = CHANNEL_ORDER.indexOf(b.id)
    if (orderA >= 0 && orderB >= 0) return orderA - orderB
    if (orderA >= 0) return -1
    if (orderB >= 0) return 1
    return a.label.localeCompare(b.label)
  })
}

function toPrettyJson(config: Record<string, unknown>) {
  return JSON.stringify(config, null, 2)
}

function normalizeChannelIconKey(channelId: string) {
  const compact = channelId.trim().toLowerCase().replace(/[\s_-]/g, '')
  if (compact === 'lark') return 'feishu'
  return compact
}

function toAvatarAbbr(value: string): string {
  const normalized = value.trim()
  if (!normalized) return '?'
  const parts = normalized.split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase()
  }
  const first = parts[0] ?? normalized
  if (/^[\u4e00-\u9fa5]/.test(first)) {
    return first.charAt(0)
  }
  const compact = first.replace(/[^a-zA-Z0-9]/g, '')
  if (!compact) return normalized.charAt(0).toUpperCase()
  return compact.slice(0, 2).toUpperCase()
}

function ChannelAvatar({ id, label, active }: { id: string; label: string; active: boolean }) {
  const key = normalizeChannelIconKey(id)
  const icon = CHANNEL_ICON_MAP[key]

  if (icon) {
    return (
      <span
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${
          active ? 'border-primary/45 bg-primary/10' : 'border-border/45 bg-card/45'
        }`}
      >
        <img src={icon} alt="" className="h-4 w-4 object-contain opacity-90 dark:invert dark:opacity-95" />
      </span>
    )
  }

  return (
    <span
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold tracking-wide ${
        active
          ? 'border-primary/45 bg-primary/10 text-primary'
          : 'border-border/45 bg-card/45 text-muted-foreground'
      }`}
    >
      {toAvatarAbbr(label || id)}
    </span>
  )
}

function resultMessage(result: unknown, fallback: string) {
  if (typeof result === 'string' && result.trim()) return result.trim()
  if (isRecord(result) && typeof result.message === 'string' && result.message.trim()) return result.message.trim()
  return fallback
}

function resultSuccess(result: unknown) {
  if (!isRecord(result)) return false
  const value = result.success
  return value === true || value === 'true'
}

function ChannelsPage() {
  const navigate = useNavigate()
  const { t, locale } = useLocale()
  const [channels, setChannels] = useState<ChannelView[]>([])
  const [activeChannelId, setActiveChannelId] = useState('')
  const [configDraft, setConfigDraft] = useState<Record<string, unknown>>({})
  const [advancedJson, setAdvancedJson] = useState('{}')
  const [advancedJsonError, setAdvancedJsonError] = useState<string | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({})

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const loginPollIntervalRef = useRef<number | null>(null)
  const loginPollTimeoutRef = useRef<number | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const lifecycleTasks = useLifecycleStore((state) => state.tasks)

  const activeChannel = useMemo(() => channels.find((item) => item.id === activeChannelId) ?? null, [activeChannelId, channels])
  const activeChannelBusyByLifecycle = useMemo(() => {
    if (!activeChannel) return { save: false, test: false, clear: false }
    const id = activeChannel.id
    return {
      save: lifecycleTasks[`channel:save:${id}`]?.status === 'running',
      test: lifecycleTasks[`channel:test:${id}`]?.status === 'running',
      clear: lifecycleTasks[`channel:clear:${id}`]?.status === 'running',
    }
  }, [activeChannel, lifecycleTasks])
  const whatsappLoginRunningByLifecycle = lifecycleTasks['channel:login:whatsapp']?.status === 'running'
  const savingNow = saving || activeChannelBusyByLifecycle.save
  const testingNow = testing || activeChannelBusyByLifecycle.test
  const clearingNow = clearing || activeChannelBusyByLifecycle.clear
  const loggingInNow = loggingIn || whatsappLoginRunningByLifecycle
  const activeFieldDefinitions = useMemo(
    () => (activeChannel ? (CHANNEL_FIELD_DEFINITIONS[activeChannel.id] ?? []) : []),
    [activeChannel],
  )

  const applyDraftConfig = useCallback((nextConfig: Record<string, unknown>, markDirty = false) => {
    setConfigDraft(nextConfig)
    setAdvancedJson(toPrettyJson(nextConfig))
    setAdvancedJsonError(null)
    setVisibleSecrets({})
    setEditorDirty(markDirty)
  }, [])

  const parseAdvancedJson = useCallback((raw: string) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { value: null as Record<string, unknown> | null, error: t('channels.form.advanced.invalidJson') }
    }

    if (!isRecord(parsed)) {
      return { value: null as Record<string, unknown> | null, error: t('channels.form.advanced.requireObject') }
    }

    return { value: parsed, error: null }
  }, [t])

  const clearLoginPolling = useCallback(() => {
    if (loginPollIntervalRef.current !== null) {
      window.clearInterval(loginPollIntervalRef.current)
      loginPollIntervalRef.current = null
    }
    if (loginPollTimeoutRef.current !== null) {
      window.clearTimeout(loginPollTimeoutRef.current)
      loginPollTimeoutRef.current = null
    }
  }, [])

  const refreshChannels = useCallback(async (mode: 'initial' | 'manual' | 'sync' = 'manual') => {
    if (mode === 'initial') setLoading(true)
    else setRefreshing(true)

    try {
      const raw = await getChannelsConfig()
      const nextChannels = normalizeChannels(raw)
      setChannels(nextChannels)
      setError(null)

      const hasActive = nextChannels.some((item) => item.id === activeChannelId)
      const nextActive = hasActive ? activeChannelId : (nextChannels[0]?.id || '')
      const selected = nextChannels.find((item) => item.id === nextActive) || nextChannels[0] || null
      setActiveChannelId(nextActive)

      if (!selected) applyDraftConfig({})
      else if (mode !== 'manual' || !editorDirty || !hasActive) applyDraftConfig(selected.config)
    } catch (err) {
      setError(`${t('channels.feedback.loadFailed')}: ${String(err)}`)
    } finally {
      if (mode === 'initial') setLoading(false)
      else setRefreshing(false)
    }
  }, [activeChannelId, applyDraftConfig, editorDirty, t])

  useEffect(() => {
    void refreshChannels('initial')
  }, [refreshChannels])

  useEffect(() => {
    return () => {
      clearLoginPolling()
    }
  }, [clearLoginPolling])

  const selectChannel = (channel: ChannelView) => {
    setActiveChannelId(channel.id)
    applyDraftConfig(channel.config)
    setError(null)
    setFeedback(null)
  }

  const onKnownFieldChange = (fieldDef: ChannelFieldDefinition, value: string) => {
    const nextConfig = updateFieldValue(configDraft, fieldDef, value)
    setConfigDraft(nextConfig)
    setAdvancedJson(toPrettyJson(nextConfig))
    setAdvancedJsonError(null)
    setEditorDirty(true)
  }

  const onAdvancedJsonChange = (value: string) => {
    setAdvancedJson(value)
    setEditorDirty(true)

    const parsed = parseAdvancedJson(value)
    if (!parsed.value) {
      setAdvancedJsonError(parsed.error)
      return
    }

    setConfigDraft(parsed.value)
    setAdvancedJsonError(null)
  }

  const onSave = async () => {
    if (!activeChannel) return

    const parsed = parseAdvancedJson(advancedJson)
    if (!parsed.value) {
      setAdvancedJsonError(parsed.error)
      setError(parsed.error)
      return
    }

    setSaving(true)
    setError(null)
    const taskKey = `channel:save:${activeChannel.id}`
    void publishLifecycleTask({
      key: taskKey,
      scope: 'channelSetup',
      status: 'running',
      message: `saving channel ${activeChannel.id}`,
      source: 'channels',
    }).catch(() => {})
    try {
      const result = await saveChannelConfig({ channel: activeChannel.id, config: parsed.value })
      setFeedback(resultMessage(result, t('channels.feedback.saveSuccess')))
      setConfigDraft(parsed.value)
      setEditorDirty(false)
      await refreshChannels('sync')
      void publishLifecycleTask({
        key: taskKey,
        scope: 'channelSetup',
        status: 'completed',
        message: resultMessage(result, t('channels.feedback.saveSuccess')),
        source: 'channels',
      }).catch(() => {})
    } catch (err) {
      setError(String(err))
      void publishLifecycleTask({
        key: taskKey,
        scope: 'channelSetup',
        status: 'error',
        message: String(err),
        source: 'channels',
      }).catch(() => {})
    } finally {
      setSaving(false)
    }
  }

  const onTest = async () => {
    if (!activeChannel) return
    setTesting(true)
    setError(null)
    const taskKey = `channel:test:${activeChannel.id}`
    void publishLifecycleTask({
      key: taskKey,
      scope: 'channelSetup',
      status: 'running',
      message: `testing channel ${activeChannel.id}`,
      source: 'channels',
    }).catch(() => {})
    try {
      const result = await testChannel({ channel: activeChannel.id })
      setFeedback(resultMessage(result, t('channels.feedback.testSuccess')))
      void publishLifecycleTask({
        key: taskKey,
        scope: 'channelSetup',
        status: 'completed',
        message: resultMessage(result, t('channels.feedback.testSuccess')),
        source: 'channels',
      }).catch(() => {})
    } catch (err) {
      setError(String(err))
      void publishLifecycleTask({
        key: taskKey,
        scope: 'channelSetup',
        status: 'error',
        message: String(err),
        source: 'channels',
      }).catch(() => {})
    } finally {
      setTesting(false)
    }
  }

  const onClear = async () => {
    if (!activeChannel) return
    if (!window.confirm(t('channels.actions.clearConfirm'))) return

    setClearing(true)
    setError(null)
    const taskKey = `channel:clear:${activeChannel.id}`
    void publishLifecycleTask({
      key: taskKey,
      scope: 'channelSetup',
      status: 'running',
      message: `clearing channel ${activeChannel.id}`,
      source: 'channels',
    }).catch(() => {})
    try {
      const result = await clearChannelConfig({ channel: activeChannel.id })
      setFeedback(resultMessage(result, t('channels.feedback.clearSuccess')))
      applyDraftConfig({})
      await refreshChannels('sync')
      void publishLifecycleTask({
        key: taskKey,
        scope: 'channelSetup',
        status: 'completed',
        message: resultMessage(result, t('channels.feedback.clearSuccess')),
        source: 'channels',
      }).catch(() => {})
    } catch (err) {
      setError(String(err))
      void publishLifecycleTask({
        key: taskKey,
        scope: 'channelSetup',
        status: 'error',
        message: String(err),
        source: 'channels',
      }).catch(() => {})
    } finally {
      setClearing(false)
    }
  }

  const onStartWhatsappLogin = async () => {
    clearLoginPolling()
    setLoggingIn(true)
    setError(null)
    const taskKey = 'channel:login:whatsapp'
    void publishLifecycleTask({
      key: taskKey,
      scope: 'channelSetup',
      status: 'running',
      message: 'starting whatsapp login',
      source: 'channels',
    }).catch(() => {})
    try {
      const result = await startChannelLogin({ channel: 'whatsapp' })
      const startMsg = resultMessage(result, t('channels.feedback.loginStarted'))
      setFeedback(`${startMsg}\n${t('channels.feedback.loginInstructions')}`)

      loginPollIntervalRef.current = window.setInterval(() => {
        void (async () => {
          try {
            const testResult = await testChannel({ channel: 'whatsapp' })
            if (!resultSuccess(testResult)) return
            clearLoginPolling()
            setLoggingIn(false)
            await refreshChannels('sync')
            setFeedback(t('channels.feedback.loginSuccess'))
            void publishLifecycleTask({
              key: taskKey,
              scope: 'channelSetup',
              status: 'completed',
              message: t('channels.feedback.loginSuccess'),
              source: 'channels',
            }).catch(() => {})
          } catch {
            // Keep polling until timeout.
          }
        })()
      }, 3000)

      loginPollTimeoutRef.current = window.setTimeout(() => {
        clearLoginPolling()
        setLoggingIn(false)
        setFeedback((prev) => {
          const timeoutMessage = t('channels.feedback.loginTimeout')
          return prev ? `${prev}\n${timeoutMessage}` : timeoutMessage
        })
        void publishLifecycleTask({
          key: taskKey,
          scope: 'channelSetup',
          status: 'error',
          message: t('channels.feedback.loginTimeout'),
          source: 'channels',
        }).catch(() => {})
      }, 60000)
    } catch (err) {
      clearLoginPolling()
      setError(String(err))
      setLoggingIn(false)
      void publishLifecycleTask({
        key: taskKey,
        scope: 'channelSetup',
        status: 'error',
        message: String(err),
        source: 'channels',
      }).catch(() => {})
    }
  }

  const onAskAi = async () => {
    const channelName = (activeChannel?.label || activeChannel?.id || 'Telegram').trim()
    const prompt = `帮我接入${channelName}，告诉我要做些什么，指导我一步一步做完`
    useChatStore.getState().patch({ draftInput: prompt })
    await navigate({ to: '/chat' })
  }

  return (
    <div className="mx-auto grid w-full max-w-[1520px] gap-6 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl leading-tight">{t('channels.page.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('channels.page.subtitle')}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="brand" onClick={() => void onAskAi()} disabled={loading}>
            {t('channels.actions.askAi')}
          </Button>
          <Button variant="secondary" onClick={() => void refreshChannels('manual')} disabled={refreshing || loading}>
          {refreshing ? t('common.checking') : t('common.refresh')}
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="bg-destructive/10">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {feedback ? (
        <Card className="bg-secondary/40">
          <CardContent className="pt-6 text-sm">{feedback}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="bg-surface-elevated">
          <CardHeader>
            <CardTitle>{t('channels.list.title')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('channels.list.subtitle')}</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <div className="text-sm text-muted-foreground">{t('common.checking')}</div>
            ) : channels.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t('channels.list.empty')}</div>
            ) : (
              channels.map((channel) => {
                const active = channel.id === activeChannelId
                return (
                  <Button
                    key={channel.id}
                    type="button"
                    variant={active ? 'brand' : 'ghost'}
                    className="h-auto w-full justify-between rounded-xl px-3 py-2"
                    onClick={() => selectChannel(channel)}
                  >
                    <span className="flex min-w-0 items-center gap-2 text-left">
                      <ChannelAvatar id={channel.id} label={channel.label} active={active} />
                      <span className="truncate text-sm font-semibold">{channel.label}</span>
                    </span>
                    <span className="text-xs opacity-85">
                      {channel.configured ? t('channels.status.configured') : t('channels.status.notConfigured')}
                    </span>
                  </Button>
                )
              })
            )}
          </CardContent>
        </Card>

        <Card className="bg-surface-elevated">
          <CardHeader>
            <CardTitle>{t('channels.form.title')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('channels.form.subtitle')}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">{t('channels.form.channelId')}</label>
                <Input value={activeChannel?.id || ''} readOnly />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">{t('channels.form.status')}</label>
                <Input
                  value={activeChannel
                    ? (activeChannel.configured ? t('channels.status.configured') : t('channels.status.notConfigured'))
                    : ''}
                  readOnly
                />
              </div>
            </div>

            <div className="rounded-2xl bg-background/30 p-4">
              <div className="text-sm font-medium">{t('channels.form.commonFields.title')}</div>
              <p className="mt-1 text-xs text-muted-foreground">{t('channels.form.commonFields.subtitle')}</p>

              {activeFieldDefinitions.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">{t('channels.form.commonFields.empty')}</p>
              ) : (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {activeFieldDefinitions.map((fieldDef) => {
                    const maskFieldKey = `${activeChannel?.id ?? 'none'}:${fieldDef.key}`
                    const isSecret = isSecretField(fieldDef)
                    const visible = Boolean(visibleSecrets[maskFieldKey])
                    const inputType = isSecret && !visible ? 'password' : 'text'

                    return (
                      <div key={fieldDef.key} className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">{localizedText(fieldDef.label, locale)}</label>
                        <div className="flex items-center gap-2">
                          <Input
                            type={inputType}
                            value={readFieldValue(configDraft, fieldDef)}
                            placeholder={fieldDef.placeholder ? localizedText(fieldDef.placeholder, locale) : undefined}
                            disabled={!activeChannel}
                            onChange={(event) => onKnownFieldChange(fieldDef, event.target.value)}
                            onPaste={(event) => {
                              const pasted = event.clipboardData?.getData('text')
                              if (typeof pasted !== 'string') return
                              event.preventDefault()
                              onKnownFieldChange(fieldDef, pasted)
                            }}
                          />
                          {isSecret ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 shrink-0"
                              title={visible ? t('setupWizard.field.hide') : t('setupWizard.field.show')}
                              aria-label={visible ? t('setupWizard.field.hide') : t('setupWizard.field.show')}
                              onClick={() => setVisibleSecrets((current) => ({ ...current, [maskFieldKey]: !current[maskFieldKey] }))}
                            >
                              {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <details className="rounded-2xl bg-background/30 px-4 py-3">
              <summary className="cursor-pointer select-none text-sm font-medium text-muted-foreground">
                {t('channels.form.advanced.title')}
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">{t('channels.form.advanced.subtitle')}</p>
              <textarea
                className="mt-3 min-h-[240px] w-full rounded-xl border border-input bg-background/70 px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-primary/30"
                value={advancedJson}
                onChange={(event) => onAdvancedJsonChange(event.target.value)}
                placeholder="{}"
                disabled={!activeChannel}
              />
              {advancedJsonError ? <p className="mt-2 text-xs text-destructive">{advancedJsonError}</p> : null}
            </details>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="brand"
                onClick={() => void onSave()}
                disabled={!activeChannel || savingNow || testingNow || clearingNow || Boolean(advancedJsonError)}
              >
                {savingNow ? t('channels.actions.saving') : t('channels.actions.save')}
              </Button>
              <Button variant="secondary" onClick={() => void onTest()} disabled={!activeChannel || savingNow || testingNow || clearingNow}>
                {testingNow ? t('channels.actions.testing') : t('channels.actions.test')}
              </Button>
              <Button variant="outline" onClick={() => void onClear()} disabled={!activeChannel || savingNow || testingNow || clearingNow}>
                {clearingNow ? t('channels.actions.clearing') : t('channels.actions.clear')}
              </Button>
              {activeChannel?.id === 'whatsapp' ? (
                <Button
                  variant="default"
                  onClick={() => void onStartWhatsappLogin()}
                  disabled={loggingInNow || savingNow || testingNow || clearingNow}
                >
                  {loggingInNow ? t('channels.actions.whatsappLoggingIn') : t('channels.actions.whatsappLogin')}
                </Button>
              ) : null}
            </div>
            {activeChannel?.id === 'whatsapp' ? (
              <p className="text-xs text-muted-foreground">{t('channels.form.whatsappHint')}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
