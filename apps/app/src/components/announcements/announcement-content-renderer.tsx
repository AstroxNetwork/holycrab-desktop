import { useMemo } from 'react'
import { detectTextDirection, toSanitizedMarkdownHtml } from '@/lib/chat-markdown'
import { extractJsonRenderSpecFromText } from '@/lib/chat-json-render'
import { ChatJsonRenderSpec } from '@/components/chat/json-render-spec'

export function AnnouncementContentRenderer({
  content,
  markdownClassName = 'hc-chat-markdown',
  specClassName,
  loading = false,
}: {
  content: string
  markdownClassName?: string
  specClassName?: string
  loading?: boolean
}) {
  const parsed = useMemo(() => extractJsonRenderSpecFromText(content || ''), [content])
  const markdownHtml = useMemo(() => (parsed.text ? toSanitizedMarkdownHtml(parsed.text) : ''), [parsed.text])
  const markdownDirection = useMemo(() => detectTextDirection(parsed.text), [parsed.text])

  return (
    <div className="space-y-3">
      {markdownHtml ? (
        <article
          dir={markdownDirection}
          className={markdownClassName}
          dangerouslySetInnerHTML={{ __html: markdownHtml }}
        />
      ) : null}
      {parsed.spec ? (
        <div className={specClassName}>
          <ChatJsonRenderSpec spec={parsed.spec} loading={loading} />
        </div>
      ) : null}
    </div>
  )
}
