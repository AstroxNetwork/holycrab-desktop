import { LightbulbIcon, RefreshCwIcon } from 'lucide-react'
import { Button } from '@ui/components/button'

export function ChatHeader({
  title,
  status,
  statusVariant,
  refreshLabel,
  tipsLabel,
  onRefresh,
  onTips,
  restartGatewayLabel,
  restartingGatewayLabel,
  showRestartGateway,
  restartingGateway,
  onRestartGateway,
}: {
  title: string
  status: string
  statusVariant: 'muted' | 'connected'
  refreshLabel: string
  tipsLabel: string
  onRefresh: () => void
  onTips: () => void
  restartGatewayLabel?: string
  restartingGatewayLabel?: string
  showRestartGateway?: boolean
  restartingGateway?: boolean
  onRestartGateway?: () => void
}) {
  const statusClassName = statusVariant === 'connected'
    ? 'border-emerald-500/40 bg-emerald-500/22 text-emerald-900 dark:text-emerald-100'
    : 'border-border/55 bg-border/15 text-muted-foreground'

  return (
    <section className="px-1 pb-1 pt-0.5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-3xl text-foreground">{title}</h1>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
            onClick={onRefresh}
            title={refreshLabel}
            aria-label={refreshLabel}
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
            onClick={onTips}
            title={tipsLabel}
            aria-label={tipsLabel}
          >
            <LightbulbIcon className="size-3.5" />
            <span>{tipsLabel}</span>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClassName}`}>
            {status}
          </div>
          {showRestartGateway && onRestartGateway ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 rounded-full border-border/60 px-3 text-xs"
              disabled={Boolean(restartingGateway)}
              onClick={onRestartGateway}
            >
              {restartingGateway
                ? (restartingGatewayLabel || restartGatewayLabel || '')
                : (restartGatewayLabel || '')}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
