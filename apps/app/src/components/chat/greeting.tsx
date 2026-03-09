import type { ChatSuggestion } from './types'
import { SuggestedActions } from './suggested-actions'

export function Greeting({
  suggestions,
  canCompose,
  onSuggestionAction,
}: {
  suggestions: ChatSuggestion[]
  canCompose: boolean
  onSuggestionAction: (action: ChatSuggestion['primaryAction']) => void
}) {
  return (
    <div className="flex min-h-full w-full items-center justify-center py-4">
      <SuggestedActions
        suggestions={suggestions}
        canCompose={canCompose}
        onSuggestionAction={onSuggestionAction}
      />
    </div>
  )
}
