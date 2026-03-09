import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Quote } from 'lucide-react'
import { Button } from '@ui/components/button'

import holycrabIcon from '@/assets/brand/holycrab.png'
import { extractJsonRenderSpecFromText } from '@/lib/chat-json-render'
import { detectTextDirection, toSanitizedMarkdownHtml } from '@/lib/chat-markdown'

import { ChatJsonRenderSpec } from './json-render-spec'
import type { NormalizedMessage } from './types'

type AssistantAvatarMode = 'default' | 'holycrab' | 'upload'
type ChatDisplayMode = 'collapsed' | 'content_only' | 'full'

function formatMessageTime(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null
  }

  const normalizedTimestamp = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
  const date = new Date(normalizedTimestamp)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function MessageBubble({
  message,
  loading,
  assistantName,
  assistantAvatar,
  assistantAvatarMode = 'default',
  assistantAvatarDataUrl,
  displayMode = 'full',
  onCopy,
  onQuote,
}: {
  message: NormalizedMessage
  loading?: boolean
  assistantName?: string
  assistantAvatar?: string | null
  assistantAvatarMode?: AssistantAvatarMode
  assistantAvatarDataUrl?: string | null
  displayMode?: ChatDisplayMode
  onCopy?: (message: NormalizedMessage) => void
  onQuote?: (message: NormalizedMessage) => void
}) {
  const isUser = message.role.toLowerCase() === 'user'
  const parsed = useMemo(() => extractJsonRenderSpecFromText(message.text), [message.text])
  const contentText = useMemo(
    () => (typeof message.contentText === 'string' ? message.contentText.trim() : ''),
    [message.contentText],
  )
  const toolText = useMemo(
    () => (typeof message.toolText === 'string' ? message.toolText.trim() : ''),
    [message.toolText],
  )
  const displayText = useMemo(() => {
    if (displayMode === 'full') {
      return parsed.text
    }
    if (contentText) {
      return contentText
    }
    if (loading || message.id === 'streaming') {
      return parsed.text
    }
    return ''
  }, [contentText, displayMode, loading, message.id, parsed.text])
  const markdownHtml = useMemo(
    () => (displayText ? toSanitizedMarkdownHtml(displayText) : ''),
    [displayText],
  )
  const markdownDirection = useMemo(
    () => detectTextDirection(displayText),
    [displayText],
  )
  const hasSpec = Boolean(parsed.spec)
  const hasText = Boolean(markdownHtml)
  const hasToolLikeContent = hasSpec || Boolean(toolText)
  const showSpec = hasSpec && displayMode === 'full'
  const showCollapsedHint = hasToolLikeContent && displayMode === 'collapsed'
  const showImages = displayMode !== 'content_only' && message.images.length > 0
  const messageTime = useMemo(() => formatMessageTime(message.timestamp), [message.timestamp])
  const [avatarImageLoadFailed, setAvatarImageLoadFailed] = useState(false)
  const [copied, setCopied] = useState(false)

  const hideUserMessage = isUser && displayMode === 'content_only' && !String(message.text || '').trim()
  const hideAssistantMessage = !isUser
    && displayMode === 'content_only'
    && !String(contentText || '').trim()
    && !loading

  if (hideUserMessage || hideAssistantMessage) {
    return null
  }

  const resolvedAssistantName = (assistantName?.trim() || 'Assistant').slice(0, 50)
  const avatarText = (assistantAvatar?.trim() || resolvedAssistantName).slice(0, 2).toUpperCase()
  const avatarImageSrc = useMemo(() => {
    if (assistantAvatarMode === 'holycrab') {
      return holycrabIcon
    }
    if (assistantAvatarMode === 'upload') {
      return assistantAvatarDataUrl?.trim() || ''
    }
    return ''
  }, [assistantAvatarDataUrl, assistantAvatarMode])
  const showAvatarImage = Boolean(avatarImageSrc && !avatarImageLoadFailed)
  const actionButtonToneClass = isUser
    ? 'text-rose-700 hover:bg-rose-500/12 hover:text-rose-800 dark:text-rose-100/85 dark:hover:bg-rose-500/15 dark:hover:text-rose-50'
    : 'text-muted-foreground hover:bg-card/50 hover:text-foreground'

  useEffect(() => {
    setAvatarImageLoadFailed(false)
  }, [avatarImageSrc])

  const handleCopy = () => {
    onCopy?.(message)
    setCopied(true)
  }

  return (
    <div
      className="group/message w-full"
      data-role={message.role}
      data-testid={`message-${message.role}`}
      onMouseLeave={() => setCopied(false)}
    >
      <div className={`flex w-full items-start gap-2 md:gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
        {!isUser ? (
          <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-card ring-1 ring-border">
            {showAvatarImage ? (
              <img
                src={avatarImageSrc}
                alt={resolvedAssistantName}
                className="size-8 rounded-full object-cover"
                onError={() => setAvatarImageLoadFailed(true)}
              />
            ) : (
              <span className="text-[10px] font-semibold text-foreground">{avatarText}</span>
            )}
          </div>
        ) : null}

        <div
          className={[
            'flex min-w-0 flex-col',
            isUser ? 'w-full items-end' : 'w-full',
            showImages ? 'gap-2' : '',
          ].join(' ')}
        >
          {isUser ? (
            <>
              <div className="max-w-[min(80%,52rem)]">
                <div className="rounded-2xl rounded-tr-lg bg-rose-500/18 px-4 py-2.5 text-sm text-rose-900 dark:text-rose-100">
                  {message.text ? <div className="whitespace-pre-wrap break-words">{message.text}</div> : null}
                  {showImages ? (
                    <div className="mt-2 grid max-w-[420px] grid-cols-2 gap-2">
                      {message.images.map((imageUrl, index) => (
                        <img
                          key={`${message.id}-user-image-${index}`}
                          src={imageUrl}
                          alt="attachment"
                          className="h-28 w-full rounded-lg border border-border/60 object-cover"
                        />
                      ))}
                    </div>
                  ) : null}
                  {messageTime ? (
                    <div className="mt-1 text-right text-[11px] text-rose-700/75 dark:text-rose-100/70">{messageTime}</div>
                  ) : null}
                </div>
                {!loading ? (
                  <div className="mt-1 flex h-7 w-full justify-end pr-1">
                    <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 focus-within:opacity-100">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className={`h-7 w-7 border-0 bg-transparent ${actionButtonToneClass}`}
                      onClick={handleCopy}
                      aria-label="Copy message"
                      title="Copy message"
                    >
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className={`h-7 w-7 border-0 bg-transparent ${actionButtonToneClass}`}
                      onClick={() => onQuote?.(message)}
                      aria-label="Quote message"
                      title="Quote message"
                    >
                      <Quote className="size-3.5" />
                    </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className={showSpec ? 'w-full max-w-[min(96%,74rem)]' : 'w-full max-w-[min(88%,52rem)]'}>
                <div
                  className={[
                    'w-full min-w-0 text-sm text-foreground',
                    showSpec
                      ? 'rounded-none border-none bg-transparent p-0'
                      : 'rounded-2xl rounded-tl-lg bg-slate-500/8 px-4 py-3',
                    loading ? 'hc-loading-sheen' : '',
                  ].join(' ')}
                >
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{resolvedAssistantName}</span>
                    {messageTime ? <span>{messageTime}</span> : null}
                  </div>
                  {hasText ? (
                    <div
                      dir={markdownDirection}
                      className="hc-chat-markdown overflow-x-hidden break-words"
                      dangerouslySetInnerHTML={{ __html: markdownHtml }}
                    />
                  ) : null}

                  {showSpec && parsed.spec ? <ChatJsonRenderSpec spec={parsed.spec} loading={loading} /> : null}
                  {showCollapsedHint ? (
                    <div className="mt-2 text-xs text-muted-foreground">工作思考中…</div>
                  ) : null}

                  {loading ? (
                    <div className="mt-2 text-xs font-medium tracking-[0.14em]">
                      <span className="hc-loading-text">...</span>
                    </div>
                  ) : null}

                  {showImages ? (
                    <div className="mt-2 grid max-w-[460px] grid-cols-2 gap-2">
                      {message.images.map((imageUrl, index) => (
                        <img
                          key={`${message.id}-assistant-image-${index}`}
                          src={imageUrl}
                          alt="image"
                          className="h-28 w-full rounded-lg border border-border/60 object-cover"
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
                {!loading ? (
                  <div className="mt-1 flex h-7 w-full justify-start pl-1">
                    <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 focus-within:opacity-100">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className={`h-7 w-7 border-0 bg-transparent ${actionButtonToneClass}`}
                      onClick={handleCopy}
                      aria-label="Copy message"
                      title="Copy message"
                    >
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className={`h-7 w-7 border-0 bg-transparent ${actionButtonToneClass}`}
                      onClick={() => onQuote?.(message)}
                      aria-label="Quote message"
                      title="Quote message"
                    >
                      <Quote className="size-3.5" />
                    </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
