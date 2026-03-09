import { Outlet, createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { Button } from '@ui/components/button'
import { Card, CardHeader, CardTitle } from '@ui/components/card'
import { useLocale } from '@/lib/locale-context'

export const Route = createFileRoute('/labs')({
  component: LabsPage,
})

function LabsPage() {
  const navigate = useNavigate()
  const { locale } = useLocale()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const tr = (zh: string, en: string) => (locale === 'zh' ? zh : en)

  if (pathname !== '/labs') {
    return <Outlet />
  }

  return (
    <div className="grid gap-6">
      <Card className="overflow-hidden border-0 bg-[linear-gradient(140deg,hsl(var(--card))_0%,hsl(var(--brand-soft))_48%,hsl(var(--card))_100%)] shadow-lg">
        <CardHeader>
          <CardTitle className="font-display text-3xl">{tr('实验区', 'Labs')}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {tr(
              '本地实验看板：快速安装 Ollama、拉取 Qwen3.5，并一键接入 OpenClaw。',
              'Local experiment dashboard: install Ollama, pull Qwen3.5, and connect OpenClaw in one click.',
            )}
          </p>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-surface-elevated">
          <CardHeader>
            <CardTitle className="text-xl">{tr('Ollama + Qwen3.5 本地模型', 'Ollama + Qwen3.5 Local Models')}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {tr(
                '一键安装 Ollama、拉取模型、写入 OpenClaw provider 配置，适合本地快速起跑。',
                'Install Ollama, pull models, and write OpenClaw provider config in one click.',
              )}
            </p>
            <Button
              variant="brand"
              className="mt-2 w-fit"
              onClick={() => {
                void navigate({ to: '/labs/ollama-qwen35' })
              }}
            >
              {tr('进入配置面板', 'Open Configuration')}
            </Button>
          </CardHeader>
        </Card>

        <Card className="bg-surface-elevated">
          <CardHeader>
            <CardTitle className="text-xl">Star Office UI</CardTitle>
            <p className="text-sm text-muted-foreground">
              {tr(
                '一键检查并安装 node/npm/python/pip/pnpm 环境，然后自动安装并启动 Star Office UI。',
                'Check and install node/npm/python/pip/pnpm, then install and start Star Office UI automatically.',
              )}
            </p>
            <Button
              variant="brand"
              className="mt-2 w-fit"
              onClick={() => {
                void navigate({ to: '/labs/star-office-ui' })
              }}
            >
              {tr('进入安装面板', 'Open Installer')}
            </Button>
          </CardHeader>
        </Card>

        <Card className="bg-surface-elevated">
          <CardHeader>
            <CardTitle className="text-xl">{tr('桌面伴侣（实验）', 'Desktop Companion (Experimental)')}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {tr(
                '配置语音 provider、音色与口型联动参数，支持实时测试播放。',
                'Configure voice provider, voice model, and lip-sync settings with realtime playback tests.',
              )}
            </p>
            <Button
              variant="brand"
              className="mt-2 w-fit"
              onClick={() => {
                void navigate({ to: '/labs/companion' })
              }}
            >
              {tr('进入实验面板', 'Open Experiment Panel')}
            </Button>
          </CardHeader>
        </Card>
      </div>
    </div>
  )
}
