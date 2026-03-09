import type { Spec } from '@json-render/core'

const SPEC_FENCE_PATTERN = /```(?:spec|json|json-render)?\s*([\s\S]*?)```/gi
const STRUCTURAL_NODE_KEYS = new Set(['type', 'props', 'items', 'children', 'id'])

type JsonObject = Record<string, unknown>

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isJsonRenderSpec(value: unknown): value is Spec {
  if (!isPlainObject(value)) return false
  const candidate = value as { root?: unknown; elements?: unknown }
  return typeof candidate.root === 'string' && typeof candidate.elements === 'object' && candidate.elements !== null
}

function buildNodeProps(type: string, node: JsonObject): JsonObject {
  const propsFromNode = isPlainObject(node.props) ? { ...node.props } : {}
  const mappedProps: JsonObject = {}

  for (const [key, rawValue] of Object.entries(node)) {
    if (STRUCTURAL_NODE_KEYS.has(key)) continue
    mappedProps[key] = rawValue
  }

  if (type === 'Card') {
    if (mappedProps.title == null && typeof node.label === 'string') {
      mappedProps.title = node.label
    }
    if (mappedProps.description == null && typeof node.data === 'string') {
      mappedProps.description = node.data
    }
  } else if (type === 'Grid') {
    if (mappedProps.title == null && typeof node.label === 'string') {
      mappedProps.title = node.label
    }
    if (mappedProps.description == null && typeof node.data === 'string') {
      mappedProps.description = node.data
    }
  } else if (type === 'Badge') {
    const label = typeof node.label === 'string' ? node.label.trim() : ''
    const value = typeof node.value === 'string'
      ? node.value.trim()
      : typeof node.data === 'string'
        ? node.data.trim()
        : ''
    const color = typeof node.color === 'string' ? node.color.trim().toLowerCase() : ''
    if (!mappedProps.tone && !mappedProps.variant) {
      if (color === 'warning' || color === 'warn') {
        mappedProps.tone = 'warning'
      } else if (color === 'error' || color === 'danger') {
        mappedProps.tone = 'error'
      } else if (color === 'success') {
        mappedProps.tone = 'success'
      }
    }
    if (!mappedProps.label && !mappedProps.text) {
      mappedProps.label = label && value ? `${label}: ${value}` : (label || value)
    }
  } else if (type === 'KeyValue') {
    if (!Array.isArray(mappedProps.items) && typeof node.key === 'string' && typeof node.value === 'string') {
      mappedProps.items = [{ label: node.key, value: node.value }]
    }
  } else if (type === 'Text') {
    if (mappedProps.text == null && typeof node.data === 'string') {
      mappedProps.text = node.data
    }
  }

  return { ...mappedProps, ...propsFromNode }
}

function normalizeNodeChildren(node: JsonObject): JsonObject[] {
  const children = Array.isArray(node.items)
    ? node.items
    : Array.isArray(node.children)
      ? node.children
      : []
  return children.filter(isPlainObject)
}

function sanitizeNodeId(rawId: string) {
  const trimmed = rawId.trim()
  if (!trimmed) return ''
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function buildSpecFromComponentTree(rootNode: JsonObject): Spec | null {
  if (typeof rootNode.type !== 'string' || !rootNode.type.trim()) {
    return null
  }

  const elements: Spec['elements'] = {}
  let autoIdCounter = 0

  const resolveNode = (node: JsonObject, fallbackId: string) => {
    const preferredId = typeof node.id === 'string' ? sanitizeNodeId(node.id) : ''
    const elementId = preferredId || fallbackId || `node_${++autoIdCounter}`
    const type = String(node.type)
    const children = normalizeNodeChildren(node)

    const childIds: string[] = []
    children.forEach((child, index) => {
      const childId = `${elementId}_${index + 1}`
      childIds.push(resolveNode(child, childId))
    })

    elements[elementId] = {
      type,
      props: buildNodeProps(type, node),
      ...(childIds.length ? { children: childIds } : {}),
    }

    return elementId
  }

  const root = resolveNode(rootNode, 'root')
  return { root, elements }
}

function parseSpecFromUnknown(value: unknown): Spec | null {
  if (isJsonRenderSpec(value)) return value
  if (!isPlainObject(value)) return null

  const nestedSpec = value.spec
  if (isJsonRenderSpec(nestedSpec)) return nestedSpec

  const components = value.components
  if (isJsonRenderSpec(components)) return components
  if (isPlainObject(components) && isPlainObject(components.root)) {
    return buildSpecFromComponentTree(components.root)
  }

  if (isPlainObject(value.root) && typeof value.type !== 'string') {
    const fromRootObject = buildSpecFromComponentTree(value.root)
    if (fromRootObject) return fromRootObject
  }

  if (typeof value.type === 'string') {
    return buildSpecFromComponentTree(value)
  }

  return null
}

function parseSpecText(text: string): Spec | null {
  const source = text.trim()
  if (!source) return null
  try {
    const parsed = JSON.parse(source) as unknown
    return parseSpecFromUnknown(parsed)
  } catch {
    return null
  }
}

function extractEmbeddedSpecFromText(text: string): { text: string; spec: Spec | null } {
  let depth = 0
  let inString = false
  let escaped = false
  let segmentStart = -1

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) {
        segmentStart = index
      }
      depth += 1
      continue
    }
    if (char === '}') {
      if (depth <= 0) continue
      depth -= 1
      if (depth !== 0) continue
      if (segmentStart < 0) continue

      const candidate = text.slice(segmentStart, index + 1)
      const spec = parseSpecText(candidate)
      if (!spec) {
        segmentStart = -1
        continue
      }

      const cleanedText = `${text.slice(0, segmentStart)}${text.slice(index + 1)}`.trim()
      return { text: cleanedText, spec }
    }
  }

  return { text, spec: null }
}

export function extractJsonRenderSpecFromText(text: string): { text: string; spec: Spec | null } {
  const source = text.trim()
  if (!source) {
    return { text: '', spec: null }
  }

  const wholeSpec = parseSpecText(source)
  if (wholeSpec) {
    return { text: '', spec: wholeSpec }
  }

  let matchedSpec: Spec | null = null
  let cleanedText = source

  cleanedText = cleanedText.replace(SPEC_FENCE_PATTERN, (full, block: string) => {
    if (matchedSpec) return full
    const parsed = parseSpecText(block)
    if (!parsed) return full
    matchedSpec = parsed
    return ''
  }).trim()

  if (!matchedSpec) {
    const embedded = extractEmbeddedSpecFromText(cleanedText)
    cleanedText = embedded.text
    matchedSpec = embedded.spec
  }

  return {
    text: cleanedText,
    spec: matchedSpec,
  }
}
