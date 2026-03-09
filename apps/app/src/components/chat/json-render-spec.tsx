import type { Spec } from '@json-render/core'

import { ChatSpecRenderer } from './render/renderer'

export function ChatJsonRenderSpec({ spec, loading }: { spec: Spec | null; loading?: boolean }) {
  if (!spec) return null

  return <ChatSpecRenderer spec={spec} loading={loading} />
}
