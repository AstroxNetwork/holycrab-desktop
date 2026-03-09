import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Combobox } from '@ui/components/combobox'
import { Input } from '@ui/components/input'
import { Separator } from '@ui/components/separator'
import { Button } from '@ui/components/button'
import { publishLifecycleCompanion } from '@/lib/lifecycle-bus'
import { tauriInvoke } from '@/lib/tauri'
import { useLocale } from '@/lib/locale-context'
import {
  playCompanionSpeech,
  classifyCompanionSpeechError,
  type CompanionSpeechError,
  type CompanionSpeechErrorKind,
  type CompanionSpeechSession,
} from '@/lib/companion-tts'

interface SettingsSaveResult {
  changed: boolean
  pairingCleared: boolean
  restartRequired: boolean
}

type CompanionProvider = 'volcano' | 'qwen'

interface CompanionSettings {
  companionEnabled: boolean
  companionProvider: CompanionProvider
  companionModel: string
  companionVoice: string
  companionNamespace: string
  companionEndpoint: string
}

interface CompanionProviderOption {
  value: CompanionProvider
  labelKey: 'settings.companion.provider.option.volcano' | 'settings.companion.provider.option.qwen'
  disabled?: boolean
}

interface CompanionVoicePreset {
  id: string
  label: string
}

interface CompanionSettingsView {
  companion?: {
    enabled: boolean
    provider: string
    model: string
    voice: string
    namespace: string
    endpoint: string
    apiKey?: string
    appKey?: string
    apiKeySet: boolean
    appKeySet: boolean
  }
}

const COMPANION_TEST_ERROR_LABEL_BY_KIND: Record<CompanionSpeechErrorKind, 'settings.companion.test.error.kind.service' | 'settings.companion.test.error.kind.config' | 'settings.companion.test.error.kind.playback' | 'settings.companion.test.error.kind.unknown'> = {
  service: 'settings.companion.test.error.kind.service',
  config: 'settings.companion.test.error.kind.config',
  playback: 'settings.companion.test.error.kind.playback',
  unknown: 'settings.companion.test.error.kind.unknown',
}

const COMPANION_PROVIDER_OPTIONS: CompanionProviderOption[] = [
  {
    value: 'volcano',
    labelKey: 'settings.companion.provider.option.volcano',
  },
  {
    value: 'qwen',
    labelKey: 'settings.companion.provider.option.qwen',
    disabled: true,
  },
]

const VOLCANO_VOICE_PRESETS: CompanionVoicePreset[] = [
  // 豆包语音合成模型2.0（在线）
  { id: 'zh_female_vv_uranus_bigtts', label: 'Vivi 2.0' },
  { id: 'zh_female_xiaohe_uranus_bigtts', label: '小何 2.0' },
  { id: 'zh_male_m191_uranus_bigtts', label: '云舟 2.0' },
  { id: 'zh_male_taocheng_uranus_bigtts', label: '小天 2.0' },
  { id: 'zh_male_liufei_uranus_bigtts', label: '刘飞 2.0' },
  { id: 'zh_male_sophie_uranus_bigtts', label: '魅力苏菲 2.0' },
  { id: 'zh_female_qingxinnvsheng_uranus_bigtts', label: '清新女声 2.0' },
  { id: 'zh_female_cancan_uranus_bigtts', label: '知性灿灿 2.0' },
  { id: 'zh_female_sajiaoxuemei_uranus_bigtts', label: '撒娇学妹 2.0' },
  { id: 'zh_female_tianmeixiaoyuan_uranus_bigtts', label: '甜美小源 2.0' },
  { id: 'zh_female_tianmeitaozi_uranus_bigtts', label: '甜美桃子 2.0' },
  { id: 'zh_female_shuangkuaisisi_uranus_bigtts', label: '爽快思思 2.0' },
  { id: 'zh_female_peiqi_uranus_bigtts', label: '佩奇猪 2.0' },
  { id: 'zh_female_linjianvhai_uranus_bigtts', label: '邻家女孩 2.0' },
  { id: 'zh_male_shaonianzixin_uranus_bigtts', label: '少年梓辛/Brayan 2.0' },
  { id: 'zh_male_sunwukong_uranus_bigtts', label: '猴哥 2.0' },
  { id: 'zh_female_yingyujiaoxue_uranus_bigtts', label: 'Tina老师 2.0' },
  { id: 'zh_female_kefunvsheng_uranus_bigtts', label: '暖阳女声 2.0' },
  { id: 'zh_female_xiaoxue_uranus_bigtts', label: '儿童绘本 2.0' },
  { id: 'zh_male_dayi_uranus_bigtts', label: '大壹 2.0' },
  { id: 'zh_female_mizai_uranus_bigtts', label: '黑猫侦探社咪仔 2.0' },
  { id: 'zh_female_jitangnv_uranus_bigtts', label: '鸡汤女 2.0' },
  { id: 'zh_female_meilinvyou_uranus_bigtts', label: '魅力女友 2.0' },
  { id: 'zh_female_liuchangnv_uranus_bigtts', label: '流畅女声 2.0' },
  { id: 'zh_male_ruyayichen_uranus_bigtts', label: '儒雅逸辰 2.0' },
  { id: 'en_male_tim_uranus_bigtts', label: 'Tim' },
  { id: 'en_female_dacey_uranus_bigtts', label: 'Dacey' },
  { id: 'en_female_stokie_uranus_bigtts', label: 'Stokie' },

  // 端到端实时语音大模型-O版本服务端
  { id: 'zh_female_vv_jupiter_bigtts', label: 'vivi（Jupiter）' },
  { id: 'zh_female_xiaohe_jupiter_bigtts', label: '小何（Jupiter）' },
  { id: 'zh_male_yunzhou_jupiter_bigtts', label: '云舟（Jupiter）' },
  { id: 'zh_male_xiaotian_jupiter_bigtts', label: '小天（Jupiter）' },

  // 豆包语音合成模型1.0（常用核心）
  { id: 'zh_female_cancan_mars_bigtts', label: '灿灿/Shiny' },
  { id: 'zh_female_shuangkuaisisi_moon_bigtts', label: '爽快思思/Skye' },
  { id: 'zh_male_wennuanahu_moon_bigtts', label: '温暖阿虎/Alvin' },
  { id: 'zh_male_shaonianzixin_moon_bigtts', label: '少年梓辛/Brayan' },
  { id: 'zh_male_qingcang_mars_bigtts', label: '擎苍' },
  { id: 'zh_male_baqiqingshu_mars_bigtts', label: '霸气青叔' },
  { id: 'zh_male_ruyaqingnian_mars_bigtts', label: '儒雅青年' },
  { id: 'zh_female_wenroushunv_mars_bigtts', label: '温柔淑女' },
  { id: 'zh_male_yangguangqingnian_mars_bigtts', label: '活力小哥' },
  { id: 'zh_female_gufengshaoyu_mars_bigtts', label: '古风少御' },
  { id: 'zh_male_fanjuanqingnian_mars_bigtts', label: '反卷青年' },
  { id: 'zh_female_kefunvsheng_mars_bigtts', label: '暖阳女声（1.0）' },
  { id: 'zh_male_M100_conversation_wvae_bigtts', label: '悠悠君子 / Lucas（多语）' },
  { id: 'zh_female_maomao_conversation_wvae_bigtts', label: '文静毛毛' },
  { id: 'zh_male_jieshuonansheng_mars_bigtts', label: '磁性解说男声/Morgan' },
  { id: 'zh_female_jitangmeimei_mars_bigtts', label: '鸡汤妹妹/Hope' },
  { id: 'zh_female_tiexinnvsheng_mars_bigtts', label: '贴心女声/Candy' },
  { id: 'zh_female_mengyatou_mars_bigtts', label: '萌丫头/Cutey' },
  { id: 'en_female_lauren_moon_bigtts', label: 'Lauren' },
  { id: 'en_male_campaign_jamal_moon_bigtts', label: 'Energetic Male II' },
  { id: 'en_male_chris_moon_bigtts', label: 'Gotham Hero' },
  { id: 'en_female_product_darcie_moon_bigtts', label: 'Flirty Female' },
  { id: 'en_female_emotional_moon_bigtts', label: 'Peaceful Female' },
  { id: 'en_female_nara_moon_bigtts', label: 'Nara' },
  { id: 'en_male_bruce_moon_bigtts', label: 'Bruce' },
  { id: 'en_male_michael_moon_bigtts', label: 'Michael' },
  { id: 'en_male_adam_mars_bigtts', label: 'Adam' },
  { id: 'en_female_amanda_mars_bigtts', label: 'Amanda' },
  { id: 'en_male_jackson_mars_bigtts', label: 'Jackson' },
  { id: 'en_female_emily_mars_bigtts', label: 'Emily' },
  { id: 'en_male_smith_mars_bigtts', label: 'Smith' },
  { id: 'en_female_anna_mars_bigtts', label: 'Anna' },
  { id: 'en_female_sarah_mars_bigtts', label: 'Sarah' },
  { id: 'en_male_dryw_mars_bigtts', label: 'Dryw' },
]

const DEFAULT_COMPANION_SETTINGS: CompanionSettings = {
  companionEnabled: false,
  companionProvider: 'volcano',
  companionModel: '',
  companionVoice: '',
  companionNamespace: '',
  companionEndpoint: '',
}

const DEFAULT_SETTINGS_VIEW: CompanionSettingsView = {
  companion: {
    enabled: false,
    provider: 'volcano',
    model: '',
    voice: '',
    namespace: '',
    endpoint: '',
    apiKey: '',
    appKey: '',
    apiKeySet: false,
    appKeySet: false,
  },
}

const DEFAULT_COMPANION_VIEW: NonNullable<CompanionSettingsView['companion']> = {
  enabled: false,
  provider: 'volcano',
  model: '',
  voice: '',
  namespace: '',
  endpoint: '',
  apiKey: '',
  appKey: '',
  apiKeySet: false,
  appKeySet: false,
}

function normalizeCompanionProvider(raw: string | undefined | null): CompanionProvider {
  return raw?.trim().toLowerCase() === 'qwen' ? 'qwen' : 'volcano'
}

function normalizeCompanionSettings(
  input?: CompanionSettingsView['companion'] | null,
): CompanionSettings {
  const safeInput = input ?? DEFAULT_COMPANION_VIEW
  return {
    companionEnabled: Boolean(safeInput.enabled),
    companionProvider: normalizeCompanionProvider(safeInput.provider),
    companionModel: typeof safeInput.model === 'string' ? safeInput.model.trim() : '',
    companionVoice: typeof safeInput.voice === 'string' ? safeInput.voice.trim() : '',
    companionNamespace: typeof safeInput.namespace === 'string' ? safeInput.namespace.trim() : '',
    companionEndpoint: typeof safeInput.endpoint === 'string' ? safeInput.endpoint.trim() : '',
  }
}

export function CompanionTtsPanel() {
  const { t, locale } = useLocale()
  const tr = (zh: string, en: string) => (locale === 'zh' ? zh : en)
  const [settings, setSettings] = useState<CompanionSettingsView>(DEFAULT_SETTINGS_VIEW)
  const [companionSettings, setCompanionSettings] = useState<CompanionSettings>({
    ...DEFAULT_COMPANION_SETTINGS,
  })
  const [companionApiKey, setCompanionApiKey] = useState('')
  const [companionAppKey, setCompanionAppKey] = useState('')
  const [clearCompanionApiKey, setClearCompanionApiKey] = useState(false)
  const [clearCompanionAppKey, setClearCompanionAppKey] = useState(false)
  const [companionSpeaking, setCompanionSpeaking] = useState(false)
  const [companionAmplitude, setCompanionAmplitude] = useState(0)
  const [companionTestText, setCompanionTestText] = useState('')
  const [companionTestError, setCompanionTestError] = useState<CompanionSpeechError | null>(null)
  const [status, setStatus] = useState<SettingsSaveResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [showConfigForm, setShowConfigForm] = useState(false)
  const companionSpeechSessionRef = useRef<CompanionSpeechSession | null>(null)
  const companionAmplitudeRef = useRef(0)
  const lastMouthPublishAtRef = useRef(0)
  const lastMouthPublishValueRef = useRef(0)
  const companionSpeechEpochRef = useRef(0)
  const companionTestErrorLabelKey = useMemo(() => {
    if (!companionTestError) return null
    return COMPANION_TEST_ERROR_LABEL_BY_KIND[companionTestError.kind]
  }, [companionTestError])

  const publishCompanionLifecycleState = useCallback(async (speaking: boolean, mouthOpen?: number | null) => {
    try {
      await publishLifecycleCompanion({
        speaking,
        mouthOpen,
        source: 'labs-companion',
      })
    } catch {
      // Ignore best-effort speaking state publishing errors.
    }
  }, [])

  const publishCompanionMouthOpen = useCallback((value: number) => {
    const now = performance.now()
    const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
    const delta = Math.abs(clamped - lastMouthPublishValueRef.current)
    if (now - lastMouthPublishAtRef.current < 70 && delta < 0.02) {
      return
    }
    lastMouthPublishAtRef.current = now
    lastMouthPublishValueRef.current = clamped
    void publishCompanionLifecycleState(true, clamped)
  }, [publishCompanionLifecycleState])

  const stopCompanionSpeech = useCallback(async () => {
    if (!companionSpeechSessionRef.current && !companionSpeaking) return
    companionSpeechEpochRef.current += 1
    const session = companionSpeechSessionRef.current
    companionSpeechSessionRef.current = null
    setCompanionAmplitude(0)
    companionAmplitudeRef.current = 0
    setCompanionSpeaking(false)
    if (session) {
      session.stop()
    }
    await publishCompanionLifecycleState(false, 0)
  }, [companionSpeaking, publishCompanionLifecycleState])

  const testCompanionSpeech = useCallback(async () => {
    if (companionSpeaking) {
      await stopCompanionSpeech()
      return
    }

    const sessionEpoch = ++companionSpeechEpochRef.current

    setCompanionTestError(null)
    setCompanionAmplitude(0)
    setCompanionSpeaking(true)
    companionAmplitudeRef.current = 0
    lastMouthPublishAtRef.current = 0
    lastMouthPublishValueRef.current = 0
    const sampleText = companionTestText.trim()
    await publishCompanionLifecycleState(true, 0)
    let session: CompanionSpeechSession | null = null

    try {
      session = await playCompanionSpeech(
        {
          text: sampleText,
          provider: companionSettings.companionProvider,
          model: companionSettings.companionModel,
          voice: companionSettings.companionVoice,
          namespace: companionSettings.companionNamespace,
          endpoint: companionSettings.companionEndpoint,
          api_key: companionApiKey.trim() || undefined,
          app_key: companionAppKey.trim() || undefined,
        },
        {
          onAmplitude: (value) => {
            const rawAmplitude = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
            companionAmplitudeRef.current = rawAmplitude
            setCompanionAmplitude(Math.max(0, Math.min(1, rawAmplitude * 6)))
            publishCompanionMouthOpen(rawAmplitude)
          },
          onError: (error) => {
            setCompanionTestError(error)
            setCompanionAmplitude(0)
            companionAmplitudeRef.current = 0
          },
        },
      )
      if (sessionEpoch !== companionSpeechEpochRef.current) {
        session.stop()
        return
      }
      companionSpeechSessionRef.current = session
      await session.ended
    } catch (error) {
      setCompanionTestError(
        error instanceof Object && 'kind' in error && 'message' in error
          ? error as CompanionSpeechError
          : classifyCompanionSpeechError(error)
      )
      companionAmplitudeRef.current = 0
    } finally {
      if (companionSpeechSessionRef.current === session) {
        await stopCompanionSpeech()
      } else {
        setCompanionAmplitude(0)
        companionAmplitudeRef.current = 0
        setCompanionSpeaking(false)
        await publishCompanionLifecycleState(false, 0)
      }
    }
  }, [
    companionApiKey,
    companionAppKey,
    companionSettings.companionEndpoint,
    companionSettings.companionModel,
    companionSettings.companionNamespace,
    companionSettings.companionProvider,
    companionSettings.companionVoice,
    companionTestText,
    companionSpeaking,
    publishCompanionLifecycleState,
    publishCompanionMouthOpen,
    stopCompanionSpeech,
    t,
  ])

  const dirty = useMemo(() => {
    if (!settings.companion) return false
    const savedApiKey = settings.companion.apiKey ?? ''
    const savedAppKey = settings.companion.appKey ?? ''
    return (
      settings.companion.enabled !== companionSettings.companionEnabled ||
      settings.companion.provider !== companionSettings.companionProvider ||
      settings.companion.model !== companionSettings.companionModel ||
      settings.companion.voice !== companionSettings.companionVoice ||
      settings.companion.namespace !== companionSettings.companionNamespace ||
      settings.companion.endpoint !== companionSettings.companionEndpoint ||
      clearCompanionApiKey ||
      (companionApiKey.trim().length > 0 && companionApiKey.trim() !== savedApiKey.trim()) ||
      clearCompanionAppKey ||
      (companionAppKey.trim().length > 0 && companionAppKey.trim() !== savedAppKey.trim())
    )
  }, [
    settings.companion,
    companionSettings,
    companionApiKey,
    companionAppKey,
    clearCompanionApiKey,
    clearCompanionAppKey,
  ])

  const volcanoVoiceOptions = useMemo(() => {
    const source = [...VOLCANO_VOICE_PRESETS]
    const currentVoice = companionSettings.companionVoice.trim()
    if (currentVoice && !source.some(item => item.id === currentVoice)) {
      source.unshift({ id: currentVoice, label: `${currentVoice}（当前）` })
    }
    return source
  }, [companionSettings.companionVoice])

  const currentProviderOption = useMemo(
    () => COMPANION_PROVIDER_OPTIONS.find((item) => item.value === companionSettings.companionProvider) ?? COMPANION_PROVIDER_OPTIONS[0],
    [companionSettings.companionProvider],
  )
  const currentProviderLabel = t(currentProviderOption.labelKey)
  const hasSavedApiKey = Boolean(settings.companion?.apiKeySet)
  const hasSavedAppKey = Boolean(settings.companion?.appKeySet)
  const providerConfigured = companionSettings.companionProvider === 'volcano'
    ? hasSavedApiKey && hasSavedAppKey
    : hasSavedApiKey
  const providerActive = providerConfigured && Boolean(settings.companion?.enabled)

  const onSave = async () => {
    if (!settings.companion) return
    setSaving(true)
    setStatus(null)
    try {
      const savedApiKey = settings.companion.apiKey ?? ''
      const savedAppKey = settings.companion.appKey ?? ''
      const trimmedApiKey = companionApiKey.trim()
      const trimmedAppKey = companionAppKey.trim()

      const companionApiKeyUpdate: string | undefined = clearCompanionApiKey
        ? ''
        : trimmedApiKey.length > 0 && trimmedApiKey !== savedApiKey.trim()
          ? trimmedApiKey
          : undefined
      const companionAppKeyUpdate: string | undefined = clearCompanionAppKey
        ? ''
        : trimmedAppKey.length > 0 && trimmedAppKey !== savedAppKey.trim()
          ? trimmedAppKey
          : undefined
      const companionPatch: Record<string, unknown> = {
        enabled: true,
        provider: companionSettings.companionProvider,
        model: companionSettings.companionModel,
        voice: companionSettings.companionVoice,
        namespace: companionSettings.companionNamespace,
        endpoint: companionSettings.companionEndpoint,
      }
      if (companionApiKeyUpdate !== undefined) {
        companionPatch.api_key = companionApiKeyUpdate
      }
      if (companionAppKeyUpdate !== undefined) {
        companionPatch.app_key = companionAppKeyUpdate
      }
      const update = { companion: companionPatch }
      const result = await tauriInvoke<SettingsSaveResult>('save_settings', {
        update,
      })
      setStatus(result)
      const fresh = await tauriInvoke<CompanionSettingsView>('get_settings')
      setSettings(fresh)
      setCompanionSettings(normalizeCompanionSettings(fresh.companion))
      setCompanionApiKey(fresh.companion?.apiKey ?? '')
      setCompanionAppKey(fresh.companion?.appKey ?? '')
      setClearCompanionApiKey(false)
      setClearCompanionAppKey(false)
      setShowConfigForm(false)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    tauriInvoke<CompanionSettingsView>('get_settings')
      .then((payload) => {
        setSettings(payload)
        setCompanionSettings(normalizeCompanionSettings(payload.companion))
        setCompanionApiKey(payload.companion?.apiKey ?? '')
        setCompanionAppKey(payload.companion?.appKey ?? '')
        setClearCompanionApiKey(false)
        setClearCompanionAppKey(false)
      })
      .catch((err) => {
        console.error(err)
      })
  }, [])

  useEffect(() => {
    return () => {
      void stopCompanionSpeech()
    }
  }, [stopCompanionSpeech])

  return (
    <div className="grid gap-6">
      <section id="companion-settings" className="space-y-3">
        {!showConfigForm ? (
          <div className="space-y-3 rounded-xl border border-border/55 bg-layer-elevated p-4 shadow-[0_10px_28px_-20px_hsl(var(--foreground)/0.45)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">
                  {tr('当前选中厂商', 'Current provider')}
                </div>
                <div className="mt-1 truncate text-lg font-semibold text-foreground">
                  {currentProviderLabel}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {providerConfigured
                    ? tr('已配置，可用于桌面伴侣播报。', 'Configured and ready for desktop companion playback.')
                    : tr('尚未完成配置，请先进入配置页面保存。', 'Not configured yet. Open configuration and save first.')}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                providerActive
                  ? 'bg-emerald-500/15 text-emerald-500'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {providerActive ? 'Active' : tr('未激活', 'Inactive')}
              </span>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button onClick={() => setShowConfigForm(true)}>
                {providerConfigured ? tr('编辑配置', 'Configure') : tr('去配置', 'Configure')}
              </Button>
            </div>
            {status ? (
              <div className="text-sm text-muted-foreground">
                {status.changed ? t('settings.daemon.status.applied') : t('settings.daemon.status.noChanges')}
                {status.pairingCleared ? ` ${t('settings.daemon.status.pairingReset')}` : ''}
                {status.restartRequired ? ` ${t('settings.daemon.status.restartRequired')}` : ''}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" disabled={saving} onClick={() => setShowConfigForm(false)}>
              {tr('返回', 'Back')}
            </Button>
            <Button disabled={!dirty || saving} onClick={onSave}>
              {saving ? t('settings.daemon.saving') : t('settings.daemon.save')}
            </Button>
          </div>
          {status ? (
            <div className="text-right text-sm text-muted-foreground">
              {status.changed ? t('settings.daemon.status.applied') : t('settings.daemon.status.noChanges')}
              {status.pairingCleared ? ` ${t('settings.daemon.status.pairingReset')}` : ''}
              {status.restartRequired ? ` ${t('settings.daemon.status.restartRequired')}` : ''}
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="companion-provider">
              {t('settings.companion.provider.label')}
            </label>
            <select
              id="companion-provider"
              className="h-9 w-full rounded-lg border border-border/35 bg-background/40 px-3 text-sm text-foreground outline-none"
              value={companionSettings.companionProvider}
              onChange={(event) => {
                setCompanionSettings((previous) => ({
                  ...previous,
                  companionProvider: event.target.value as CompanionProvider,
                }))
              }}
            >
              {COMPANION_PROVIDER_OPTIONS.map((providerOption) => (
                <option key={providerOption.value} value={providerOption.value} disabled={providerOption.disabled}>
                  {providerOption.disabled
                    ? `${t(providerOption.labelKey)} ${t('settings.memory.comingSoonSuffix')}`
                    : t(providerOption.labelKey)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="companion-model">
              {t('settings.companion.model.label')}
            </label>
            <Input
              id="companion-model"
              value={companionSettings.companionModel}
              onChange={(event) =>
                setCompanionSettings((previous) => ({
                  ...previous,
                  companionModel: event.target.value,
                }))
              }
              placeholder={t('settings.companion.model.label')}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="companion-voice">
              {t('settings.companion.voice.label')}
            </label>
            {companionSettings.companionProvider === 'volcano' && VOLCANO_VOICE_PRESETS.length > 0 ? (
              <div className="space-y-3 rounded-lg border border-border/35 bg-layer-subtle/90 p-3">
                <Combobox
                  value={companionSettings.companionVoice}
                  onValueChange={(next) =>
                    setCompanionSettings((previous) => ({
                      ...previous,
                      companionVoice: next.trim(),
                    }))
                  }
                  options={volcanoVoiceOptions.map((item) => ({
                    value: item.id,
                    label: `${item.label} (${item.id})`,
                  }))}
                  placeholder={t('settings.companion.voice.label')}
                  searchPlaceholder={t('settings.companion.voice.volcano.searchPlaceholder')}
                  emptyText={t('settings.companion.voice.volcano.noResult')}
                  allowCustom
                  triggerClassName="border-border/35 bg-layer-base/90"
                  contentClassName="border-border/40 bg-layer-elevated"
                />
              </div>
            ) : (
              <Input
                id="companion-voice"
                value={companionSettings.companionVoice}
                onChange={(event) =>
                  setCompanionSettings((previous) => ({
                    ...previous,
                    companionVoice: event.target.value,
                  }))
                }
                placeholder={t('settings.companion.voice.label')}
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="companion-namespace">
              {t('settings.companion.namespace.label')}
            </label>
            <Input
              id="companion-namespace"
              value={companionSettings.companionNamespace}
              onChange={(event) =>
                setCompanionSettings((previous) => ({
                  ...previous,
                  companionNamespace: event.target.value,
                }))
              }
              placeholder={t('settings.companion.namespace.label')}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium" htmlFor="companion-endpoint">
              {t('settings.companion.endpoint.label')}
            </label>
            <Input
              id="companion-endpoint"
              value={companionSettings.companionEndpoint}
              onChange={(event) =>
                setCompanionSettings((previous) => ({
                  ...previous,
                  companionEndpoint: event.target.value,
                }))
              }
              placeholder={t('settings.companion.endpoint.label')}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="companion-api-key">
              {t('settings.companion.apiKey.label')}
            </label>
            <Input
              id="companion-api-key"
              value={companionApiKey}
              onChange={(event) => {
                setCompanionApiKey(event.target.value)
                if (clearCompanionApiKey) {
                  setClearCompanionApiKey(false)
                }
              }}
              type="text"
              autoComplete="off"
            />
            <label className="flex select-none items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={clearCompanionApiKey}
                onChange={(event) => setClearCompanionApiKey(event.target.checked)}
                disabled={!settings.companion?.apiKeySet || saving}
              />
              {t('settings.companion.clearSavedApiKey')}
            </label>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="companion-app-key">
              {t('settings.companion.appKey.label')}
            </label>
            <Input
              id="companion-app-key"
              value={companionAppKey}
              onChange={(event) => {
                setCompanionAppKey(event.target.value)
                if (clearCompanionAppKey) {
                  setClearCompanionAppKey(false)
                }
              }}
              type="text"
              autoComplete="off"
            />
            <label className="flex select-none items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={clearCompanionAppKey}
                onChange={(event) => setClearCompanionAppKey(event.target.checked)}
                disabled={!settings.companion?.appKeySet || saving}
              />
              {t('settings.companion.clearSavedAppKey')}
            </label>
          </div>
        </div>

        <div className="space-y-2 rounded-xl bg-background/25 p-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">{t('settings.companion.test.title')}</div>
            <div className="text-xs text-muted-foreground">
              {t('settings.companion.test.description')}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-full space-y-2">
              <textarea
                id="companion-test-text"
                aria-label={t('settings.companion.test.label')}
                value={companionTestText}
                onChange={(event) => setCompanionTestText(event.target.value)}
                placeholder={t('settings.companion.test.sample')}
                className="min-h-24 w-full rounded-lg border border-border/35 bg-background/40 px-3 py-2 text-sm text-foreground outline-none"
                disabled={saving}
              />
            </div>
            <Button
              size="sm"
              variant={companionSpeaking ? 'destructive' : 'outline'}
              onClick={() => void testCompanionSpeech()}
              disabled={saving}
            >
              {companionSpeaking ? t('settings.companion.test.stop') : t('settings.companion.test.play')}
            </Button>
          </div>
          <div className="h-2 overflow-hidden rounded bg-border/40">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.round(companionAmplitude * 100)}%` }}
            />
          </div>
          {companionSpeaking ? (
            <div className="text-xs text-emerald-600">{t('settings.companion.test.speaking')}</div>
          ) : null}
          {companionTestError ? (
            <div className="space-y-1 text-xs text-red-600">
              <div>
                {t('settings.companion.test.testError')}
                : {companionTestErrorLabelKey ? t(companionTestErrorLabelKey) : t('settings.companion.test.error.kind.unknown')}
                — {companionTestError.message}
              </div>
              {companionTestError.details ? (
                <div className="text-[11px] text-red-500">{companionTestError.details}</div>
              ) : null}
            </div>
          ) : null}
        </div>

          </div>
        )}
      </section>

      <Separator className="bg-border/60" />
    </div>
  )
}
