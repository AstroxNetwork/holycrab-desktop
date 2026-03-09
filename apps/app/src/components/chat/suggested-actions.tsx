import { Button } from '@ui/components/button'

import type { ChatSuggestion } from './types'

export function SuggestedActions({
  suggestions,
  canCompose,
  onSuggestionAction,
}: {
  suggestions: ChatSuggestion[]
  canCompose: boolean
  onSuggestionAction: (action: ChatSuggestion['primaryAction']) => void
}) {
  const cardTone = (id: ChatSuggestion['id']) => {
    if (id === 'key-offer') {
      return 'border-rose-400/35 bg-[linear-gradient(145deg,hsl(var(--background))_0%,hsl(var(--brand-soft)/0.55)_100%)]'
    }
    if (id === 'dashboard') {
      return 'border-cyan-400/35 bg-[linear-gradient(145deg,hsl(var(--background))_0%,hsl(192_88%_52%/0.12)_100%)]'
    }
    return 'border-amber-300/35 bg-[linear-gradient(145deg,hsl(var(--background))_0%,hsl(38_100%_60%/0.10)_100%)]'
  }

  const actionDisabled = (action: ChatSuggestion['primaryAction']) => (
    action.kind === 'prompt' ? !canCompose : false
  )

  return (
    <div className="grid w-full max-w-[1320px] gap-4 lg:grid-cols-3 xl:gap-5">
      {suggestions.map((item, index) => (
        <article
          key={`${item.id}-${index}`}
          className={[
            'flex min-h-[320px] flex-col rounded-3xl border p-6 shadow-[0_12px_40px_-24px_rgba(0,0,0,0.9)]',
            cardTone(item.id),
          ].join(' ')}
        >
          {item.badge ? (
            <div className="mb-4 inline-flex w-fit items-center rounded-full border border-white/15 bg-black/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {item.badge}
            </div>
          ) : null}

          <div className="text-2xl font-semibold leading-tight text-foreground">
            {item.title}
          </div>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            {item.body}
          </p>

          {item.highlights?.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {item.highlights.map((point) => (
                <span
                  key={`${item.id}-${point}`}
                  className="rounded-full border border-white/15 bg-black/20 px-3 py-1 text-xs text-foreground/90"
                >
                  {point}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-auto flex flex-wrap gap-2 pt-6">
            <Button
              variant={item.primaryAction.variant ?? 'brand'}
              onClick={() => onSuggestionAction(item.primaryAction)}
              disabled={actionDisabled(item.primaryAction)}
            >
              {item.primaryAction.label}
            </Button>
            {item.secondaryAction ? (() => {
              const secondary = item.secondaryAction
              return (
                <Button
                  variant={secondary.variant ?? 'outline'}
                  onClick={() => onSuggestionAction(secondary)}
                  disabled={actionDisabled(secondary)}
                >
                  {secondary.label}
                </Button>
              )
            })() : null}
          </div>
        </article>
      ))}
    </div>
  )
}
