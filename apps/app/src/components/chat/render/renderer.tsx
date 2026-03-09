import type { Spec } from '@json-render/core'
import {
  ActionProvider,
  Renderer,
  StateProvider,
  VisibilityProvider,
  type ComponentRenderer,
} from '@json-render/react'

import { Fallback, registry } from './registry'

const fallback: ComponentRenderer = ({ element }) => <Fallback type={element.type} />

export function ChatSpecRenderer({
  spec,
  loading,
}: {
  spec: Spec | null
  loading?: boolean
}) {
  if (!spec) return null

  return (
    <StateProvider initialState={spec.state ?? {}}>
      <VisibilityProvider>
        <ActionProvider>
          <Renderer
            spec={spec}
            registry={registry}
            fallback={fallback}
            loading={loading}
          />
        </ActionProvider>
      </VisibilityProvider>
    </StateProvider>
  )
}
