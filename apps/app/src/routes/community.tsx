import { createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { Button } from '@ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@ui/components/card'

export const Route = createFileRoute('/community')({
  component: CommunityPage,
})

function CommunityPage() {
  const navigate = useNavigate()
  const routeSearch = useRouterState({ select: (state) => state.location.search as unknown })
  const panel = resolveCommunityPanel(routeSearch)

  useEffect(() => {
    if (panel === 'labs') {
      void navigate({ to: '/labs', replace: true })
      return
    }
    if (panel === 'discover') {
      void navigate({ to: '/discover', replace: true })
    }
  }, [navigate, panel])

  return (
    <div className="grid gap-6">
      <Card className="overflow-hidden border-0 bg-[linear-gradient(140deg,hsl(var(--card))_0%,hsl(var(--brand-soft))_50%,hsl(var(--card))_100%)] shadow-lg">
        <CardHeader>
          <CardTitle className="font-display text-3xl">Community</CardTitle>
          <p className="text-sm text-muted-foreground">
            社区分组：集中实验区与发现内容，入口更聚合。
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Card className="bg-background/80">
            <CardHeader>
              <CardTitle className="text-xl">实验区</CardTitle>
              <p className="text-sm text-muted-foreground">
                本地模型、安装脚本与实验功能入口。
              </p>
            </CardHeader>
            <CardContent>
              <Button
                variant="brand"
                onClick={() => {
                  void navigate({ to: '/labs' })
                }}
              >
                进入实验区
              </Button>
            </CardContent>
          </Card>
          <Card className="bg-background/80">
            <CardHeader>
              <CardTitle className="text-xl">Discover</CardTitle>
              <p className="text-sm text-muted-foreground">
                兑换、活动与入门连接指引。
              </p>
            </CardHeader>
            <CardContent>
              <Button
                variant="secondary"
                onClick={() => {
                  void navigate({ to: '/discover' })
                }}
              >
                进入 Discover
              </Button>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  )
}

function resolveCommunityPanel(search: unknown): 'overview' | 'labs' | 'discover' {
  const getPanel = () => {
    if (!search) return ''
    if (typeof search === 'string') {
      const raw = search.startsWith('?') ? search.slice(1) : search
      return (new URLSearchParams(raw).get('panel') || '').trim().toLowerCase()
    }
    if (typeof search === 'object') {
      return String((search as Record<string, unknown>).panel || '').trim().toLowerCase()
    }
    return ''
  }
  const panel = getPanel()
  if (panel === 'labs' || panel === 'discover') return panel
  return 'overview'
}
