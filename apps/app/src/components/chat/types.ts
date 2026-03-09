export type ChatSuggestionActionVariant =
  | 'brand'
  | 'default'
  | 'secondary'
  | 'outline'
  | 'ghost'

export type ChatSuggestionAction =
  | {
    kind: 'prompt'
    label: string
    prompt: string
    variant?: ChatSuggestionActionVariant
  }
  | {
    kind: 'route'
    label: string
    route: '/keys' | '/dashboard' | '/discover' | '/setup-wizard'
    variant?: ChatSuggestionActionVariant
  }
  | {
    kind: 'external'
    label: string
    url: string
    variant?: ChatSuggestionActionVariant
  }

export type ChatAttachment = {
  id: string
  dataUrl: string
  mimeType: string
}

export type ChatSuggestion = {
  id: 'key-offer' | 'dashboard' | 'market-insight'
  badge?: string
  title: string
  body: string
  highlights?: string[]
  primaryAction: ChatSuggestionAction
  secondaryAction?: ChatSuggestionAction
}

export type NormalizedMessage = {
  id: string
  role: string
  text: string
  contentText?: string
  toolText?: string
  images: string[]
  timestamp: number
  authorName?: string | null
}
