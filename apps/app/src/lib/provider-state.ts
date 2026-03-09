import { tauriInvoke } from '@/lib/tauri'
import type { OpenClawProviderConfigStatus } from '@/lib/openclaw-config'
import type { ProviderProfileView } from '@/lib/provider-setup'

export interface ProviderModelCost {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface ProviderModelMetadataItem {
  id: string
  name?: string
  reasoning?: boolean
  input?: string[]
  cost?: ProviderModelCost
  contextWindow?: number
  maxTokens?: number
  api?: string
}

export interface ProviderCatalogItem {
  id: string
  name: string
  summary: string
  iconUrl?: string | null
  iconText?: string | null
  defaultBaseUrl: string
  defaultModel: string
  modelMetadata?: ProviderModelMetadataItem[]
  modelSuggestions?: string[]
}

export interface ProviderStateView {
  providers: ProviderCatalogItem[]
  profiles: ProviderProfileView[]
  activeProfileId?: string | null
  configured: boolean
  openclawConfig: OpenClawProviderConfigStatus
  catalogSource: 'remote' | 'fallback' | string
}

export async function getProviderState() {
  return tauriInvoke<ProviderStateView>('get_provider_state')
}
