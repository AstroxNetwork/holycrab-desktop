import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({
  gfm: true,
  breaks: true,
})

const sanitizeOptions = {
  ALLOWED_TAGS: [
    'a',
    'b',
    'blockquote',
    'br',
    'code',
    'del',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'hr',
    'i',
    'img',
    'li',
    'ol',
    'p',
    'pre',
    'strong',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'tr',
    'ul',
  ],
  ALLOWED_ATTR: ['class', 'href', 'rel', 'target', 'title', 'start', 'src', 'alt'],
  ADD_DATA_URI_TAGS: ['img'],
}

let hooksInstalled = false
const markdownCache = new Map<string, string>()
const MARKDOWN_CACHE_LIMIT = 200
const MARKDOWN_CACHE_MAX_CHARS = 50_000

function installHooks() {
  if (hooksInstalled) return
  hooksInstalled = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof HTMLAnchorElement)) {
      return
    }
    if (!node.getAttribute('href')) {
      return
    }
    node.setAttribute('rel', 'noreferrer noopener')
    node.setAttribute('target', '_blank')
  })
}

function getCachedMarkdown(key: string): string | null {
  const value = markdownCache.get(key)
  if (value === undefined) {
    return null
  }
  markdownCache.delete(key)
  markdownCache.set(key, value)
  return value
}

function setCachedMarkdown(key: string, value: string) {
  markdownCache.set(key, value)
  if (markdownCache.size <= MARKDOWN_CACHE_LIMIT) {
    return
  }
  const oldestKey = markdownCache.keys().next().value
  if (oldestKey) {
    markdownCache.delete(oldestKey)
  }
}

const htmlEscapeRenderer = new marked.Renderer()
htmlEscapeRenderer.html = ({ text }: { text: string }) => escapeHtml(text)

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function toSanitizedMarkdownHtml(markdown: string) {
  const source = markdown.trim()
  if (!source) return ''

  installHooks()

  if (source.length <= MARKDOWN_CACHE_MAX_CHARS) {
    const cached = getCachedMarkdown(source)
    if (cached !== null) {
      return cached
    }
  }

  const rendered = marked.parse(source, {
    renderer: htmlEscapeRenderer,
  }) as string

  const sanitized = DOMPurify.sanitize(rendered, sanitizeOptions)

  if (source.length <= MARKDOWN_CACHE_MAX_CHARS) {
    setCachedMarkdown(source, sanitized)
  }

  return sanitized
}

const RTL_CHAR_REGEX =
  /\p{Script=Hebrew}|\p{Script=Arabic}|\p{Script=Syriac}|\p{Script=Thaana}|\p{Script=Nko}|\p{Script=Samaritan}|\p{Script=Mandaic}|\p{Script=Adlam}|\p{Script=Phoenician}|\p{Script=Lydian}/u

export function detectTextDirection(
  text: string | null,
  skipPattern: RegExp = /[\s\p{P}\p{S}]/u,
): 'rtl' | 'ltr' {
  if (!text) {
    return 'ltr'
  }
  for (const char of text) {
    if (skipPattern.test(char)) {
      continue
    }
    return RTL_CHAR_REGEX.test(char) ? 'rtl' : 'ltr'
  }
  return 'ltr'
}
