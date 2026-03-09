import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Badge } from '@ui/components/badge'
import { Button } from '@ui/components/button'
import { Copy } from 'lucide-react'
import { cn } from '@ui/lib/utils'
import '@xterm/xterm/css/xterm.css'
import { tauriInvoke } from '@/lib/tauri'
import { listenPtyOutput } from '@/lib/pty-events'
import { useLocale } from '@/lib/locale-context'

export interface RuntimeSessionLogState {
  runtimeId?: string
  action?: string
  running: boolean
  success: boolean | null
  lines: string[]
}

interface RuntimeSessionPanelProps {
  title?: string
  runtimeLabel?: string
  actionLabel?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  log: RuntimeSessionLogState | null
  ptySessionId?: string | null
  onPtyDone?: (exitCode: number) => void
  autoCloseOnSuccess?: boolean
  autoCloseDelayMs?: number
  className?: string
}

function sessionStatus(
  log: RuntimeSessionLogState | null,
  t: (key: string) => string,
): {
  text: string
  detail: string
  variant: 'outline' | 'secondary' | 'destructive'
} {
  if (!log) {
    return { text: t('runtimeSession.status.idle'), detail: t('runtimeSession.detail.idle'), variant: 'outline' }
  }
  if (log.running) {
    return { text: t('runtimeSession.status.running'), detail: t('runtimeSession.detail.running'), variant: 'outline' }
  }
  if (log.success) {
    return { text: t('runtimeSession.status.success'), detail: t('runtimeSession.detail.success'), variant: 'secondary' }
  }
  return { text: t('runtimeSession.status.failed'), detail: t('runtimeSession.detail.failed'), variant: 'destructive' }
}

function toActionLabel(action: string, t: (key: string) => string) {
  switch (action) {
    case 'upgrade':
      return t('runtimeSession.action.upgrade')
    case 'uninstall':
      return t('runtimeSession.action.uninstall')
    case 'install':
      return t('runtimeSession.action.install')
    case 'open':
      return t('runtimeSession.action.open')
    default:
      break
  }
  if (!action.length) return t('runtimeSession.action.fallback')
  return `${action.slice(0, 1).toUpperCase()}${action.slice(1)}`
}

const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001b\[[0-9;?]*[ -/]*[@-~]`, 'g')

function stripAnsi(text: string) {
  return text.replace(ANSI_ESCAPE_PATTERN, '')
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const element = document.createElement('textarea')
  element.value = text
  element.setAttribute('readonly', 'true')
  element.style.position = 'fixed'
  element.style.opacity = '0'
  try {
    document.body.appendChild(element)
    element.select()
    document.execCommand('copy')
  } finally {
    try {
      element.remove()
    } catch {
      // ignore
    }
  }
}

export function RuntimeSessionPanel({
  title,
  runtimeLabel,
  actionLabel,
  open,
  onOpenChange,
  log,
  ptySessionId,
  onPtyDone,
  autoCloseOnSuccess = false,
  autoCloseDelayMs = 1200,
  className,
}: RuntimeSessionPanelProps) {
  const { t } = useLocale()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const lastLineCountRef = useRef(0)
  const ptyUnlistenRef = useRef<(() => void) | null>(null)
  const [ptyDone, setPtyDone] = useState(false)
  const [ptyExitCode, setPtyExitCode] = useState<number | null>(null)
  const ptyDoneNotifiedRef = useRef(false)
  const ptyOutputChunksRef = useRef<string[]>([])
  const copyTimerRef = useRef<number | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'failed'>('idle')
  const status = sessionStatus(log, t)

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return
    const terminal = new Terminal({
      cursorBlink: false,
      convertEol: true,
      disableStdin: false,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.45,
      theme: {
        background: '#0a0a0b',
        foreground: '#e5e5e5',
        cursor: '#e5e5e5',
        black: '#0a0a0b',
        red: '#ff6b6b',
        green: '#7fe3a1',
        yellow: '#f6c177',
        blue: '#7cb7ff',
        magenta: '#c792ea',
        cyan: '#63d7f0',
        white: '#f5f5f5',
        brightBlack: '#6b6b6b',
        brightRed: '#ff8787',
        brightGreen: '#9bf6bd',
        brightYellow: '#ffd590',
        brightBlue: '#9bc8ff',
        brightMagenta: '#dbabff',
        brightCyan: '#8de7ff',
        brightWhite: '#ffffff',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)
    fitAddon.fit()
    terminal.writeln(t('runtimeSession.terminal.waiting'))
    const terminalInstance = terminal

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const onResize = () => {
      fitAddon.fit()
    }
    const resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe(containerRef.current)
    let disposed = false

    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
        copyTimerRef.current = null
      }
      resizeObserver.disconnect()
      if (disposed) {
        return
      }
      disposed = true
      try {
        terminalInstance.dispose()
      } catch {
        // ignore
      }
      if (terminalRef.current === terminalInstance) {
        terminalRef.current = null
      }
      if (fitAddonRef.current === fitAddon) {
        fitAddonRef.current = null
      }
      lastLineCountRef.current = 0
      ptyOutputChunksRef.current = []
      ptyUnlistenRef.current?.()
      ptyUnlistenRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!open) return
    fitAddonRef.current?.fit()
  }, [open])

  useEffect(() => {
    ptyOutputChunksRef.current = []
  }, [ptySessionId])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return

    if (ptySessionId) return

    const lines = log?.lines ?? []
    if (lines.length < lastLineCountRef.current) {
      terminal.reset()
      lastLineCountRef.current = 0
    }

    if (lines.length === 0 && lastLineCountRef.current === 0) {
      terminal.writeln(t('runtimeSession.terminal.waiting'))
      return
    }

    for (let index = lastLineCountRef.current; index < lines.length; index += 1) {
      terminal.writeln(lines[index])
    }
    lastLineCountRef.current = lines.length
    terminal.scrollToBottom()
  }, [log, ptySessionId, t])

  useEffect(() => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    const sessionId = ptySessionId ?? null
    if (!terminal || !fitAddon) return

    ptyUnlistenRef.current?.()
    ptyUnlistenRef.current = null

    if (!sessionId) return

    let disposed = false

    const ensureResize = async () => {
      try {
        fitAddon.fit()
        await tauriInvoke('pty_resize', { session_id: sessionId, cols: terminal.cols, rows: terminal.rows })
      } catch {
        // Best-effort: resizing failures are not fatal.
      }
    }

    void ensureResize()

    void (async () => {
      const unlisten = await listenPtyOutput(sessionId, (payload) => {
        if (disposed) return
        if (payload.data) {
          ptyOutputChunksRef.current.push(payload.data)
          terminal.write(payload.data)
        }
        if (payload.done) {
          setPtyDone(true)
          setPtyExitCode(typeof payload.exitCode === 'number' ? payload.exitCode : null)
          if (!ptyDoneNotifiedRef.current) {
            ptyDoneNotifiedRef.current = true
            onPtyDone?.(typeof payload.exitCode === 'number' ? payload.exitCode : -1)
          }
        }
      })
      ptyUnlistenRef.current = () => {
        disposed = true
        void unlisten()
      }

      // Drain any output produced before the listener was attached.
      // Without this, fast commands can appear "stuck" because early output was missed.
      try {
        const backlog = await tauriInvoke<string>('pty_drain', { session_id: sessionId })
        if (!disposed && backlog) {
          ptyOutputChunksRef.current.push(backlog)
          terminal.write(backlog)
        }
      } catch {
        // Best-effort: draining failures are not fatal.
      }
    })()

    const onData = terminal.onData((data) => {
      if (!terminalRef.current) return
      void tauriInvoke('pty_write', { session_id: sessionId, data })
    })

    const onResize = terminal.onResize(() => {
      if (!terminalRef.current) return
      void tauriInvoke('pty_resize', { session_id: sessionId, cols: terminal.cols, rows: terminal.rows })
    })

    return () => {
      disposed = true
      onData.dispose()
      onResize.dispose()
      ptyUnlistenRef.current?.()
      ptyUnlistenRef.current = null
    }
  }, [ptySessionId])

  useEffect(() => {
    if (!open) return
    if (!ptySessionId) return
    if (!ptyDone) return
    // Keep session open for review; user can close the panel.
  }, [open, ptyDone, ptySessionId])

  const statusOverride = useMemo(() => {
    if (!ptySessionId) return null
    if (!ptyDone) {
      return {
        text: t('runtimeSession.status.running'),
        detail: t('runtimeSession.detail.ptyRunning'),
        variant: 'outline' as const,
      }
    }
    if (ptyExitCode === 0) {
      return {
        text: t('runtimeSession.status.success'),
        detail: t('runtimeSession.detail.success'),
        variant: 'secondary' as const,
      }
    }
    return { text: t('runtimeSession.status.failed'), detail: t('runtimeSession.detail.failed'), variant: 'destructive' as const }
  }, [ptyDone, ptyExitCode, ptySessionId, t])

  const resolvedTitle = title ?? t('runtimeSession.title')
  const resolvedRuntimeLabel = runtimeLabel || log?.runtimeId || 'OpenClaw'
  const resolvedActionLabel = actionLabel || toActionLabel(log?.action || '', t)
  const resolvedStatus = statusOverride ?? status
  const shouldAutoClose = useMemo(() => {
    if (!autoCloseOnSuccess) return false
    if (!open) return false

    if (ptySessionId) {
      return ptyDone && ptyExitCode === 0
    }

    return Boolean(log && !log.running && log.success)
  }, [autoCloseOnSuccess, log, open, ptyDone, ptyExitCode, ptySessionId])

  const copyButtonLabel = copyState === 'success'
    ? '已复制'
    : copyState === 'failed'
      ? '复制失败'
      : '复制输出'

  const handleCopyOutput = async () => {
    const plainLog = (log?.lines ?? []).join('\n')
    const ptyLog = stripAnsi(ptyOutputChunksRef.current.join('').replace(/\r\n?/g, '\n')).trim()
    const merged = [plainLog.trim(), ptyLog].filter((item) => item.length > 0).join('\n')
    const header = `${resolvedRuntimeLabel} · ${resolvedActionLabel} · ${resolvedStatus.text}`
    const payload = `${header}\n\n${merged || t('runtimeSession.terminal.waiting')}`

    try {
      await copyTextToClipboard(payload)
      setCopyState('success')
    } catch {
      setCopyState('failed')
    }

    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current)
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopyState('idle')
      copyTimerRef.current = null
    }, 1800)
  }

  useEffect(() => {
    if (!shouldAutoClose) return

    const timeout = window.setTimeout(() => {
      onOpenChange(false)
    }, Math.max(0, autoCloseDelayMs))

    return () => {
      window.clearTimeout(timeout)
    }
  }, [autoCloseDelayMs, onOpenChange, shouldAutoClose])

  return (
    <div className="pointer-events-none fixed inset-y-0 right-0 z-40 flex w-full justify-end p-3 md:p-4">
      <aside
        className={cn(
          'pointer-events-auto flex h-full w-full max-w-xl flex-col rounded-2xl bg-surface-elevated shadow-xl transition-all duration-200',
          open
            ? 'translate-x-0 opacity-100'
            : 'translate-x-[calc(100%+1rem)] opacity-0',
          className,
        )}
        aria-hidden={!open}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {resolvedTitle}
            </div>
            <div className="truncate text-sm font-medium">
              {resolvedRuntimeLabel} · {resolvedActionLabel}
            </div>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('runtimeSession.button.close')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{resolvedRuntimeLabel}</Badge>
            <Badge variant={resolvedStatus.variant}>{resolvedStatus.text}</Badge>
            <span className="text-muted-foreground">{resolvedStatus.detail}</span>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => void handleCopyOutput()}>
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            {copyButtonLabel}
          </Button>
        </div>

        <div className="min-h-0 flex-1 px-4 pb-4">
          <div
            ref={containerRef}
            className="h-full overflow-hidden rounded-xl bg-background/40 p-2"
          />
        </div>
      </aside>
    </div>
  )
}
