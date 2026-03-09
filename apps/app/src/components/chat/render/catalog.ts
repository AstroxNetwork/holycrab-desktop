import { defineCatalog } from '@json-render/core'
import { schema } from '@json-render/react/schema'
import { shadcnComponentDefinitions } from '@json-render/shadcn/catalog'
import { z } from 'zod'

// Based on vercel-labs/json-render/examples/chat/lib/render/catalog.ts
const chatRenderComponentDefinitions = {
    ...shadcnComponentDefinitions,

    Grid: {
      props: z.object({
        columns: z.number().nullable(),
        gap: z.number().nullable(),
        label: z.string().nullable(),
        title: z.string().nullable(),
        description: z.string().nullable(),
      }),
      slots: ['default'],
      description: 'Grid layout with numeric gap support.',
    },

    Card: {
      props: z.object({
        title: z.string().nullable(),
        description: z.string().nullable(),
        span: z.number().nullable(),
        gap: z.number().nullable(),
      }),
      slots: ['default'],
      description: 'Card container with optional grid span.',
    },

    Text: {
      props: z.object({
        text: z.string().nullable(),
        content: z.string().nullable(),
        muted: z.boolean().nullable(),
      }),
      description: 'Text content.',
    },

    Badge: {
      props: z.object({
        label: z.string().nullable(),
        text: z.string().nullable(),
        tone: z.enum(['neutral', 'success', 'warning', 'error']).nullable(),
        variant: z
          .enum(['default', 'secondary', 'outline', 'destructive', 'success', 'warning', 'error', 'primary'])
          .nullable(),
        pulse: z.boolean().nullable(),
      }),
      description: 'Status badge.',
    },

    Metric: {
      props: z.object({
        label: z.string(),
        value: z.string(),
        detail: z.string().nullable(),
        trend: z.enum(['up', 'down', 'neutral']).nullable(),
        variant: z.enum(['success', 'warning', 'error', 'neutral']).nullable(),
      }),
      description: 'Metric with optional trend/variant.',
    },

    StockItem: {
      props: z.object({
        symbol: z.string(),
        name: z.string().nullable(),
        price: z.string().nullable(),
        change: z.string().nullable(),
        volume: z.string().nullable(),
        direction: z.enum(['up', 'down', 'flat']).nullable(),
      }),
      description: 'Stock row.',
    },

    NewsItem: {
      props: z.object({
        title: z.string(),
        source: z.string().nullable(),
        time: z.string().nullable(),
        url: z.string().nullable(),
      }),
      description: 'News row.',
    },

    Button: {
      props: z.object({
        href: z.string().nullable(),
        to: z.string().nullable(),
        route: z.string().nullable(),
        search: z.record(z.string(), z.string()).nullable(),
        session: z.string().nullable(),
        tab: z.string().nullable(),
        label: z.string().nullable(),
        text: z.string().nullable(),
        icon: z.string().nullable(),
        variant: z.enum(['primary', 'default', 'secondary', 'outline', 'ghost', 'brand']).nullable(),
        disabled: z.boolean().nullable(),
      }),
      description: 'Button row item.',
    },

    KeyValue: {
      props: z.object({
        items: z.array(z.object({ label: z.string(), value: z.string() })),
      }),
      description: 'Key/value list.',
    },

    Divider: {
      props: z.object({}),
      description: 'Horizontal divider.',
    },
}

export const chatRenderComponentNames = Object.keys(chatRenderComponentDefinitions).sort()

export const chatRenderCatalog = defineCatalog(schema, {
  components: chatRenderComponentDefinitions,
  actions: {},
})
