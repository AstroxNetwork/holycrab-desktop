import { ArrowDownIcon } from 'lucide-react';
import { Button } from '@ui/components/button';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import { Greeting } from './greeting';
import { MessageBubble } from './message';
import type { ChatSuggestion, NormalizedMessage } from './types';

type AssistantAvatarMode = 'default' | 'holycrab' | 'upload';
type ChatDisplayMode = 'collapsed' | 'content_only' | 'full';

export const Messages = memo(function Messages({
  loadingHistory,
  messages,
  streamText,
  suggestions,
  showSuggestionCards,
  forceSkeleton,
  forceMask,
  canCompose,
  canChat,
  onSuggestionAction,
  onMaskAction,
  onSecondaryMaskAction,
  onCopyMessage,
  onQuoteMessage,
  labels,
  endRef,
  assistantName,
  assistantAvatar,
  assistantAvatarMode,
  assistantAvatarDataUrl,
  displayMode,
  initialScrollTop,
  initialManualUp,
  onScrollStateChange,
  onContentInteract,
}: {
  loadingHistory: boolean;
  messages: NormalizedMessage[];
  streamText: string | null;
  suggestions: ChatSuggestion[];
  showSuggestionCards: boolean;
  forceSkeleton?: boolean;
  forceMask?: boolean;
  canCompose: boolean;
  canChat: boolean;
  onSuggestionAction: (action: ChatSuggestion['primaryAction']) => void;
  onMaskAction?: () => void;
  onSecondaryMaskAction?: () => void;
  onCopyMessage?: (message: NormalizedMessage) => void;
  onQuoteMessage?: (message: NormalizedMessage) => void;
  labels: {
    loadingHistory: string;
    empty: string;
    maskTitle: string;
    maskDescription: string;
    maskAction?: string;
    maskActionSecondary?: string;
    maskActionDisabled?: boolean;
    maskActionSecondaryDisabled?: boolean;
    scrollToBottom: string;
  };
  endRef: RefObject<HTMLDivElement | null>;
  assistantName?: string;
  assistantAvatar?: string | null;
  assistantAvatarMode?: AssistantAvatarMode;
  assistantAvatarDataUrl?: string | null;
  displayMode?: ChatDisplayMode;
  initialScrollTop?: number;
  initialManualUp?: boolean;
  onScrollStateChange?: (scrollTop: number, manualUp: boolean) => void;
  onContentInteract?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevLoadingHistoryRef = useRef(loadingHistory);
  const hasRestoredInitialScrollRef = useRef(false);
  const autoStickRef = useRef(!initialManualUp);
  const lastScrollStateRef = useRef({
    manualUp: Boolean(initialManualUp),
    scrollTop: Math.max(0, initialScrollTop ?? 0),
  });
  const prevScrollTopRef = useRef(Math.max(0, initialScrollTop ?? 0));

  const effectiveShowSuggestionCards = showSuggestionCards && !forceSkeleton;
  const showLoadingSkeleton = Boolean(forceSkeleton) || (loadingHistory && messages.length === 0 && streamText === null);
  const showEmpty = !effectiveShowSuggestionCards && !showLoadingSkeleton && !loadingHistory && messages.length === 0 && !streamText;
  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const container = containerRef.current;
      if (!container) return;
      autoStickRef.current = true;
      lastScrollStateRef.current = { manualUp: false, scrollTop: 0 };
      prevScrollTopRef.current = 0;
      onScrollStateChange?.(0, false);
      container.scrollTo({ top: container.scrollHeight, behavior });
    },
    [onScrollStateChange],
  );

  useLayoutEffect(() => {
    if (hasRestoredInitialScrollRef.current) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    hasRestoredInitialScrollRef.current = true;

    if (initialManualUp) {
      const nextTop = Math.max(0, Math.floor(initialScrollTop ?? 0));
      container.scrollTo({ top: nextTop, behavior: 'auto' });
      autoStickRef.current = false;
      lastScrollStateRef.current = {
        manualUp: true,
        scrollTop: nextTop,
      };
      prevScrollTopRef.current = nextTop;
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      scrollToBottom('auto');
    });
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [initialManualUp, initialScrollTop, scrollToBottom]);

  useEffect(() => {
    return () => {
      const last = lastScrollStateRef.current;
      onScrollStateChange?.(last.scrollTop, last.manualUp);
    };
  }, [onScrollStateChange]);

  useEffect(() => {
    const prev = prevLoadingHistoryRef.current;
    const finishedHistoryLoad = prev && !loadingHistory;
    prevLoadingHistoryRef.current = loadingHistory;

    if (!finishedHistoryLoad) {
      return;
    }

    if (!autoStickRef.current) {
      return;
    }
    const rafId = window.requestAnimationFrame(() => {
      scrollToBottom('auto');
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [loadingHistory, scrollToBottom]);

  useEffect(() => {
    if (!autoStickRef.current) {
      return;
    }
    const rafId = window.requestAnimationFrame(() => {
      scrollToBottom('auto');
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [messages, scrollToBottom, streamText]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const bottomTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const deltaToBottom = Math.max(0, bottomTop - container.scrollTop);
    const atBottom = deltaToBottom <= 24;
    const currentTop = Math.max(0, container.scrollTop);
    const movedUp = currentTop < prevScrollTopRef.current - 1;
    prevScrollTopRef.current = currentTop;

    const last = lastScrollStateRef.current;
    // Enter manual mode only on real upward user scroll; exit when bottom reached.
    const manualUp = last.manualUp ? !atBottom : (!atBottom && movedUp);
    autoStickRef.current = !manualUp;

    const nextTop = manualUp ? Math.max(0, Math.floor(currentTop)) : 0;
    if (last.manualUp === manualUp && (!manualUp || Math.abs(last.scrollTop - nextTop) < 1)) {
      return;
    }

    lastScrollStateRef.current = { manualUp, scrollTop: nextTop };
  }, []);

  return (
    <div className="relative h-full min-h-0 bg-background">
      <div
        ref={containerRef}
        onPointerDownCapture={() => {
          onContentInteract?.();
        }}
        onScroll={handleScroll}
        className="hc-scrollbar h-full touch-pan-y overscroll-y-none overflow-x-hidden overflow-y-auto bg-background [overflow-anchor:none]"
      >
        <div className="mx-auto flex min-h-full min-w-0 w-full max-w-[1520px] flex-col px-3 py-6 md:px-5 md:py-8">
          {showLoadingSkeleton ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="w-full max-w-5xl space-y-3">
                <div className="text-sm text-muted-foreground">{labels.loadingHistory}</div>
                <div className="h-5 w-40 animate-pulse rounded-md bg-border/45" />
                <div className="h-24 w-full animate-pulse rounded-2xl bg-border/35" />
                <div className="h-24 w-full animate-pulse rounded-2xl bg-border/30" />
                <div className="h-24 w-[72%] animate-pulse rounded-2xl bg-border/25" />
              </div>
            </div>
          ) : (
            <div
              className={[
                'flex w-full min-h-full flex-col gap-4 md:gap-6',
                effectiveShowSuggestionCards || showEmpty ? 'flex-1 items-center justify-center' : '',
              ].join(' ')}
            >
              {effectiveShowSuggestionCards ? (
                <Greeting suggestions={suggestions} canCompose={canCompose} onSuggestionAction={onSuggestionAction} />
              ) : null}

              {showEmpty ? <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">{labels.empty}</div> : null}

              {messages.map(message => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  assistantName={assistantName}
                  assistantAvatar={assistantAvatar}
                  assistantAvatarMode={assistantAvatarMode}
                  assistantAvatarDataUrl={assistantAvatarDataUrl}
                  displayMode={displayMode}
                  onCopy={onCopyMessage}
                  onQuote={onQuoteMessage}
                />
              ))}

              {streamText !== null ? (
                <MessageBubble
                  message={{
                    id: 'streaming',
                    role: 'assistant',
                    text: streamText,
                    images: [],
                    timestamp: 0,
                  }}
                  loading
                  assistantName={assistantName}
                  assistantAvatar={assistantAvatar}
                  assistantAvatarMode={assistantAvatarMode}
                  assistantAvatarDataUrl={assistantAvatarDataUrl}
                  displayMode={displayMode}
                />
              ) : null}
            </div>
          )}
          <div className="h-px shrink-0" ref={endRef} />
        </div>
      </div>
      <button
        type="button"
        aria-label={labels.scrollToBottom}
        onClick={() => scrollToBottom('auto')}
        className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border/60 bg-background p-2 shadow-lg transition-colors hover:bg-card"
      >
        <ArrowDownIcon className="size-4 text-foreground" />
      </button>

      {forceMask || (!canChat && effectiveShowSuggestionCards) ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/88 p-6 text-center backdrop-blur-sm">
          <div className="text-base font-semibold text-foreground">{labels.maskTitle}</div>
          <div className="mt-1.5 max-w-xl text-sm text-muted-foreground">{labels.maskDescription}</div>
          {(labels.maskAction && onMaskAction) || (labels.maskActionSecondary && onSecondaryMaskAction) ? (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {labels.maskAction && onMaskAction ? (
                <Button
                  variant="brand"
                  onClick={onMaskAction}
                  disabled={Boolean(labels.maskActionDisabled)}
                >
                  {labels.maskAction}
                </Button>
              ) : null}
              {labels.maskActionSecondary && onSecondaryMaskAction ? (
                <Button
                  variant="outline"
                  onClick={onSecondaryMaskAction}
                  disabled={Boolean(labels.maskActionSecondaryDisabled)}
                >
                  {labels.maskActionSecondary}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
