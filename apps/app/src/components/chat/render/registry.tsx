/* eslint-disable react-refresh/only-export-components */
import { TrendingDown, TrendingUp } from 'lucide-react'
import { defineRegistry } from '@json-render/react'
import { shadcnComponents } from '@json-render/shadcn'

import { Button as UiButton } from '@ui/components/button'

import { openExternalUrl } from '@/lib/openclaw-handoff'
import { parseDeeplinkTarget, toHashFromDeeplinkTarget } from '@/lib/deep-link'
import { chatRenderCatalog, chatRenderComponentNames } from './catalog'

export function Fallback({ type }: { type: string }) {
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/8 px-3 py-2 text-xs text-amber-100">
      <div>Unsupported component: {type}</div>
      <div className="mt-1 text-[11px] text-amber-200/90">
        Supported: {chatRenderComponentNames.join(', ')}
      </div>
    </div>
  )
}

export const { registry } = defineRegistry(chatRenderCatalog, {
  components: {
    ...shadcnComponents,

    Grid: ({ props, children }) => {
      const columns = Math.max(1, Math.min(6, Number(props.columns ?? 2)))
      const gap = Math.max(10, Math.min(40, Number(props.gap ?? 16)))
      const title = props.title || props.label || ''
      const isSection = Boolean(title || props.description)

      const grid = (
        <div
          className="w-full"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap,
            alignItems: 'start',
          }}
        >
          {children}
        </div>
      )

      if (!isSection) {
        return grid
      }

      return (
        <div className="rounded-2xl border border-border/35 bg-card/30 p-4">
          {title ? <div className="text-base font-semibold text-foreground">{title}</div> : null}
          {props.description ? <div className="mt-1 text-sm text-muted-foreground">{props.description}</div> : null}
          <div className="mt-3">
            {grid}
          </div>
        </div>
      )
    },

    Card: ({ props, children }) => {
      const childGap = Math.max(6, Math.min(28, Number(props.gap ?? 10)))
      return (
        <div
          className="rounded-2xl border border-border/35 bg-card/35 p-4"
          style={props.span ? { gridColumn: `span ${Math.max(1, Math.min(6, Number(props.span)))}` } : undefined}
        >
          {props.title ? <div className="text-base font-semibold text-foreground">{props.title}</div> : null}
          {props.description ? <div className="mt-1 text-sm text-muted-foreground">{props.description}</div> : null}
          {children ? (
            <div className="mt-3 flex flex-col" style={{ gap: childGap }}>
              {children}
            </div>
          ) : null}
        </div>
      )
    },

    Text: ({ props }) => {
      const value = props.content || props.text || ''
      return <p className={props.muted ? 'text-sm text-muted-foreground' : 'text-sm text-foreground'}>{value}</p>
    },

    Badge: ({ props }) => {
      const text = props.label || props.text || ''
      const tone =
        props.tone
        || (props.variant === 'success' || props.variant === 'primary' ? 'success' : null)
        || (props.variant === 'warning' ? 'warning' : null)
        || (props.variant === 'error' || props.variant === 'destructive' ? 'error' : null)
        || 'neutral'

      const toneClass =
        tone === 'success'
          ? 'bg-emerald-500/15 text-emerald-300'
          : tone === 'warning'
            ? 'bg-amber-500/15 text-amber-200'
            : tone === 'error'
              ? 'bg-red-500/15 text-red-200'
              : 'bg-secondary/70 text-secondary-foreground'

      return (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${toneClass}`}>
          {text}
        </span>
      )
    },

    Metric: ({ props }) => {
      const trendClass =
        props.trend === 'up' || props.variant === 'success'
          ? 'text-emerald-300'
          : props.trend === 'down' || props.variant === 'error'
            ? 'text-red-200'
            : props.variant === 'warning'
              ? 'text-amber-200'
              : 'text-foreground'
      const TrendIcon = props.trend === 'up' ? TrendingUp : props.trend === 'down' ? TrendingDown : null

      return (
        <div className="rounded-xl bg-background/25 p-3">
          <div className="text-xs uppercase tracking-[0.08em] text-muted-foreground">{props.label}</div>
          <div className="mt-1 flex items-center gap-1.5">
            <div className={`text-lg font-semibold ${trendClass}`}>{props.value}</div>
            {TrendIcon ? <TrendIcon className={`size-3.5 ${trendClass}`} /> : null}
          </div>
          {props.detail ? <div className="mt-1 text-xs text-muted-foreground">{props.detail}</div> : null}
        </div>
      )
    },

    StockItem: ({ props }) => {
      const directionClass =
        props.direction === 'up'
          ? 'text-emerald-300'
          : props.direction === 'down'
            ? 'text-red-200'
            : 'text-muted-foreground'

      return (
        <div className="rounded-xl bg-background/20 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">{props.symbol}</div>
              {props.name ? <div className="truncate text-xs text-muted-foreground">{props.name}</div> : null}
            </div>
            <div className="text-right">
              {props.price ? <div className="text-sm font-medium text-foreground">{props.price}</div> : null}
              {props.change ? <div className={`text-xs ${directionClass}`}>{props.change}</div> : null}
              {props.volume ? <div className="text-[11px] text-muted-foreground">{props.volume}</div> : null}
            </div>
          </div>
        </div>
      )
    },

    NewsItem: ({ props }) => (
      <div className="rounded-xl bg-background/20 px-3 py-2">
        <div className="text-sm text-foreground">{props.title}</div>
        {(props.source || props.time) ? (
          <div className="mt-1 text-xs text-muted-foreground">
            {[props.source, props.time].filter(Boolean).join(' · ')}
          </div>
        ) : null}
      </div>
    ),

    Button: ({ props }) => {
      const variant =
        props.variant === 'primary' || props.variant === 'brand'
          ? 'brand'
          : props.variant === 'secondary'
            ? 'secondary'
            : props.variant === 'ghost'
              ? 'ghost'
              : 'outline'
      const label = props.label || props.text || 'Action'
      const href = typeof props.href === 'string' ? props.href.trim() : ''
      const to = typeof props.to === 'string' ? props.to.trim() : ''
      const route = typeof props.route === 'string' ? props.route.trim() : ''
      const session = typeof props.session === 'string' ? props.session.trim() : ''
      const tab = typeof props.tab === 'string' ? props.tab.trim() : ''
      const legacySearch: Record<string, string> =
        typeof props.search === 'object' && props.search !== null && !Array.isArray(props.search)
          ? (Object.entries(props.search).every(([, value]) => typeof value === 'string')
            ? (props.search as Record<string, string>)
            : {})
          : {}
      const destination = href || route || to

      const handleClick = () => {
        if (!destination) {
          return
        }
        const deepTarget = parseDeeplinkTarget(destination)

        if (deepTarget.kind === 'external') {
          void openExternalUrl(deepTarget.url)
          return
        }

        const finalSearch: Record<string, string> = {
          ...(deepTarget.search || {}),
          ...legacySearch,
        }
        if (session) {
          finalSearch.session = session
        }
        if (tab) {
          finalSearch.tab = tab
        }
        const merged = {
          ...deepTarget,
          ...(Object.keys(finalSearch).length ? { search: finalSearch } : {}),
        }

        if (merged.kind === 'internal') {
          const hash = toHashFromDeeplinkTarget(merged)
          if (!hash) return
          if (typeof window === 'undefined') return
          if (window.location.hash === hash) {
            window.location.reload()
            return
          }
          window.location.hash = hash
        }
      }

      return (
        <UiButton
          variant={variant}
          disabled={Boolean(props.disabled)}
          className="justify-start"
          onClick={handleClick}
        >
          {props.icon ? <span className="mr-1">{props.icon}</span> : null}
          {label}
        </UiButton>
      )
    },

    KeyValue: ({ props }) => (
      <div className="overflow-hidden rounded-xl border border-border/35 bg-background/20">
        {props.items.map((entry, index) => (
          <div
            key={`${entry.label}-${index}`}
            className={[
              'grid grid-cols-[minmax(88px,140px)_minmax(0,1fr)] items-start gap-3 px-3 py-2.5 text-sm',
              index > 0 ? 'border-t border-border/25' : '',
            ].join(' ')}
          >
            <span className="pt-0.5 text-xs font-medium tracking-[0.04em] text-muted-foreground">
              {entry.label}
            </span>
            <span className="break-words text-[13px] leading-relaxed text-foreground">
              {entry.value}
            </span>
          </div>
        ))}
      </div>
    ),

    Divider: () => <div className="h-px w-full bg-border/70" />,
  },
})
