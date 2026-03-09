import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Button } from '@ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@ui/components/card'
import { Input } from '@ui/components/input'
import {
  getDevRuntimeConfig,
  isDevOnlyMenuEnabled,
  resetDevRuntimeConfig,
  setDevRuntimeConfig,
  type DevRuntimeConfig,
} from '@/lib/dev-runtime-config'

export const Route = createFileRoute('/dev-config')({
  component: DevConfigPage,
})

function DevConfigPage() {
  const enabled = isDevOnlyMenuEnabled()
  const [savedConfig, setSavedConfig] = useState<DevRuntimeConfig>(() => getDevRuntimeConfig())
  const [form, setForm] = useState<DevRuntimeConfig>(() => getDevRuntimeConfig())
  const [feedback, setFeedback] = useState<string>('')

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(savedConfig),
    [form, savedConfig],
  )

  const onFieldChange = (key: keyof DevRuntimeConfig, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const onSave = () => {
    const next = setDevRuntimeConfig(form)
    setForm(next)
    setSavedConfig(next)
    setFeedback('已保存。新配置会立即用于 Discover、Redeem 和系统消息源请求。')
  }

  const onReset = () => {
    const defaults = resetDevRuntimeConfig()
    setForm(defaults)
    setSavedConfig(defaults)
    setFeedback('已恢复为构建时默认值（VITE_*）。')
  }

  if (!enabled) {
    return <Navigate to="/chat" replace />
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6 lg:p-8">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-3xl">Dev Runtime Config</CardTitle>
          <p className="text-sm text-muted-foreground">
            仅 Dev 包可见。修改后立即生效，保存在当前设备本地，不会影响正式包。
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="VITE_KEY_MARKETPLACE_URL"
            value={form.keyMarketplaceUrl}
            onChange={(value) => onFieldChange('keyMarketplaceUrl', value)}
          />
          <Field
            label="VITE_DISCOVER_API_DEALS_URL"
            value={form.discoverApiDealsUrl}
            onChange={(value) => onFieldChange('discoverApiDealsUrl', value)}
          />
          <Field
            label="VITE_DISCOVER_GUIDES_URL"
            value={form.discoverGuidesUrl}
            onChange={(value) => onFieldChange('discoverGuidesUrl', value)}
          />
          <Field
            label="VITE_REDEEM_API_BASE_URL"
            value={form.redeemApiBaseUrl}
            onChange={(value) => onFieldChange('redeemApiBaseUrl', value)}
          />
          <Field
            label="HOLYCRAB_ANNOUNCEMENTS_FEED_URL"
            value={form.announcementsFeedUrl}
            onChange={(value) => onFieldChange('announcementsFeedUrl', value)}
          />
          <div className="flex flex-wrap gap-3 pt-1">
            <Button type="button" onClick={onSave} disabled={!dirty}>
              保存并应用
            </Button>
            <Button type="button" variant="outline" onClick={onReset}>
              恢复默认
            </Button>
          </div>
          {feedback ? <p className="text-sm text-muted-foreground">{feedback}</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </div>
  )
}
