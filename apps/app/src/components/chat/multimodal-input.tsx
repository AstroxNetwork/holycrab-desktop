import { Loader2, Maximize2, Mic, Minimize2, Square } from 'lucide-react'
import { useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { Button } from '@ui/components/button'

import type { ChatAttachment } from './types'

export function MultimodalInput({
  attachments,
  input,
  textareaRef,
  disabled,
  sending,
  canSubmit,
  dictationState,
  dictationLevel,
  dictationWorking,
  dictationEnabled,
  onDictationHoldStart,
  onDictationHoldEnd,
  onOpenDictationSettings,
  placeholders,
  onInputChange,
  onPaste,
  onRemoveAttachment,
  onEnterSubmit,
  onSubmit,
}: {
  attachments: ChatAttachment[]
  input: string
  textareaRef: RefObject<HTMLTextAreaElement | null>
  disabled: boolean
  sending: boolean
  canSubmit: boolean
  dictationState?: 'idle' | 'listening' | 'processing'
  dictationLevel?: number
  dictationWorking?: boolean
  dictationEnabled?: boolean
  onDictationHoldStart?: () => void
  onDictationHoldEnd?: () => void
  onOpenDictationSettings?: () => void
  placeholders: {
    ready: string
    disabled: string
    send: string
    queue: string
    sending: string
    expand: string
    collapse: string
    dictationProcessing: string
  }
  onInputChange: (value: string) => void
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  onRemoveAttachment: (id: string) => void
  onEnterSubmit: () => void
  onSubmit: (event: FormEvent) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const dictationHolding = useRef(false)
  const currentDictationState = dictationState || 'idle'
  const normalizedDictationLevel = Number.isFinite(dictationLevel) ? Math.min(1, Math.max(0, dictationLevel || 0)) : 0
  const micFeatureEnabled = dictationEnabled ?? true
  const allowOpenDictationSettings = Boolean(onOpenDictationSettings && !micFeatureEnabled && !disabled)
  const dictationBusy = Boolean(dictationWorking) || currentDictationState === 'processing'
  const micVisuallyDisabled = disabled || currentDictationState === 'processing' || !micFeatureEnabled || !onDictationHoldStart
  const micInteractiveDisabled = disabled
    || currentDictationState === 'processing'
    || (!onDictationHoldStart && !allowOpenDictationSettings)
  const dictationTitle = allowOpenDictationSettings
    ? 'Dictation disabled. Open settings'
    : currentDictationState === 'listening'
      ? 'Release to stop dictation'
      : dictationBusy
        ? 'Preparing dictation'
        : 'Hold to dictate'
  const handleMicPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (allowOpenDictationSettings) {
      onOpenDictationSettings?.()
      return
    }
    if (micVisuallyDisabled || !onDictationHoldStart) {
      return
    }
    event.preventDefault()
    dictationHolding.current = true
    onDictationHoldStart()
  }
  const handleMicPointerEnd = () => {
    if (!dictationHolding.current) return
    dictationHolding.current = false
    onDictationHoldEnd?.()
  }

  return (
    <form className="relative flex w-full flex-col gap-3" onSubmit={onSubmit}>
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="relative">
              <img
                src={attachment.dataUrl}
                alt="attachment preview"
                className="h-20 w-24 rounded-lg border border-border/60 object-cover"
              />
              <button
                type="button"
                className="absolute -right-1 -top-1 rounded-full border border-border/80 bg-background/90 px-1.5 text-xs"
                onClick={() => onRemoveAttachment(attachment.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-background p-3 shadow-xs transition-all duration-200 hover:border-muted-foreground/50 focus-within:border-border">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onPaste={onPaste}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key !== 'Enter') return
              if (event.shiftKey) return
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              event.preventDefault()
              onEnterSubmit()
            }}
            disabled={disabled}
            placeholder={disabled ? placeholders.disabled : placeholders.ready}
            rows={expanded ? 8 : 1}
            className={[
              'hc-scrollbar flex-1 resize-none border-none bg-transparent p-2 text-base leading-6 outline-none ring-0 placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70',
              expanded
                ? 'min-h-[180px] max-h-[420px] font-mono'
                : 'min-h-[44px] max-h-[220px]',
            ].join(' ')}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setExpanded((prev) => !prev)}
            title={expanded ? placeholders.collapse : placeholders.expand}
            aria-label={expanded ? placeholders.collapse : placeholders.expand}
          >
            {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={micVisuallyDisabled ? 'h-9 w-9 opacity-60' : 'h-9 w-9'}
            disabled={micInteractiveDisabled}
            title={dictationTitle}
            aria-label={dictationTitle}
            onPointerDown={handleMicPointerDown}
            onPointerUp={handleMicPointerEnd}
            onPointerCancel={handleMicPointerEnd}
            onPointerLeave={handleMicPointerEnd}
          >
            {dictationBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : currentDictationState === 'listening' ? (
              <Square className="size-3.5 fill-current text-red-400" />
            ) : (
              <Mic className="size-4" />
            )}
          </Button>

          <Button
            type="submit"
            variant="brand"
            className="h-9 min-w-[76px] rounded-md px-3"
            disabled={!canSubmit}
          >
            {sending ? placeholders.queue : placeholders.send}
          </Button>
        </div>
        {currentDictationState !== 'idle' ? (
          <div className="mt-2 flex h-4 items-end gap-1 px-2" aria-hidden>
            {Array.from({ length: 8 }).map((_, index) => {
              const weight = (index + 1) / 8
              const active = Math.max(0.12, normalizedDictationLevel * weight)
              const height = currentDictationState === 'processing'
                ? 0.2 + weight * 0.7
                : 0.18 + active * 0.8
              return (
                <span
                  key={`dictation-level-${index}`}
                  className={currentDictationState === 'processing'
                    ? 'w-1 rounded-full bg-amber-400/80 animate-pulse'
                    : 'w-1 rounded-full bg-emerald-400/80'}
                  style={{ height: `${Math.round(height * 100)}%` }}
                />
              )
            })}
          </div>
        ) : null}
        {currentDictationState === 'processing' ? (
          <div className="mt-1 px-2 text-xs text-amber-300/90" role="status" aria-live="polite">
            {placeholders.dictationProcessing}
          </div>
        ) : null}
      </div>
    </form>
  )
}
