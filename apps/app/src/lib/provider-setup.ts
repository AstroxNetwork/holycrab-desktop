import { tauriInvoke } from '@/lib/tauri'

export type ProviderMode = 'managed' | 'custom'
export type ProviderName = string

export interface ProviderProfileView {
  id: string
  name: string
  mode: ProviderMode | string
  provider: ProviderName | string
  baseUrl: string
  apiKey: string
  apiKeySet: boolean
  model: string
  customParams: string
  configured: boolean
}

export interface ProviderSetupView {
  profiles: ProviderProfileView[]
  activeProfileId?: string | null
  configured: boolean
}

export interface ProviderSetupUpdate {
  profileId?: string
  name: string
  mode: ProviderMode
  provider: ProviderName
  baseUrl: string
  apiKey?: string
  model: string
  customParams: string
  setActive?: boolean
}

export interface ProviderSetupSaveResult {
  changed: boolean
  configured: boolean
  profileId: string
  activeProfileId?: string | null
}

export interface ProviderProfileDeleteResult {
  changed: boolean
  activeProfileId?: string | null
}

export interface ProviderVerifyInput {
  mode: ProviderMode
  provider: ProviderName
  baseUrl: string
  apiKey: string
  model: string
}

export interface ProviderVerifyResult {
  ok: boolean
  statusCode?: number | null
  message: string
  modelFound?: boolean | null
}

export async function getProviderSetup() {
  return tauriInvoke<ProviderSetupView>('get_provider_setup')
}

export async function saveProviderSetup(update: ProviderSetupUpdate) {
  return tauriInvoke<ProviderSetupSaveResult>('save_provider_setup', { update })
}

export async function setActiveProviderProfile(profileId: string) {
  return tauriInvoke<ProviderSetupSaveResult>('set_active_provider_profile', {
    input: { profileId },
  })
}

export async function deleteProviderProfile(profileId: string) {
  return tauriInvoke<ProviderProfileDeleteResult>('delete_provider_profile', {
    input: { profileId },
  })
}

export async function verifyProviderSetup(input: ProviderVerifyInput) {
  return tauriInvoke<ProviderVerifyResult>('verify_provider_setup', { input })
}

const PROVIDER_BASE_URL_BY_ID: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  'naci-openai': 'https://api.naci-tech.com/v1',
  'naci-anthropic': 'https://api.naci-tech.com/v1',
  holycrab: 'https://api.holycrab.ai/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api/v1',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  together: 'https://api.together.xyz/v1',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  perplexity: 'https://api.perplexity.ai',
  qianfan: 'https://qianfan.baidubce.com/v2',
  huggingface: 'https://router.huggingface.co/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  vllm: 'http://127.0.0.1:8000/v1',
  ollama: 'http://127.0.0.1:11434',
  'cloudflare-ai-gateway': 'https://gateway.ai.cloudflare.com/v1',
  moonshot: 'https://api.moonshot.ai/v1',
  'moonshot-cn': 'https://api.moonshot.cn/v1',
  litellm: 'http://localhost:4000',
  minimax: 'https://api.minimax.io/anthropic',
  'minimax-cn': 'https://api.minimaxi.com/anthropic',
  kilocode: 'https://api.kilo.ai/api/gateway',
  zhipu: 'https://open.bigmodel.cn/api/coding/paas/v4',
  zai: 'https://api.z.ai/api/paas/v4',
  xai: 'https://api.x.ai/v1',
  venice: 'https://api.venice.ai/api/v1',
  deepseek: 'https://api.deepseek.com/v1',
  'deepseek-ai': 'https://api.deepseek.com/v1',
  alibaba: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  'alibaba-cn': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  custom: '',
}

const PROVIDER_CANONICAL_ALIAS_VALUES: Record<string, string[]> = {
  'naci-openai': ['naci', 'naci_openai'],
  'naci-anthropic': ['naci_anthropic'],
  holycrab: ['holycrab-openai', 'holycrab_openai', 'holycrab-anthropic', 'holycrab_anthropic'],
  qwen: ['alibaba', 'alibaba-cn', 'alibaba_cn', 'alibaba-cloud', 'dashscope', 'qwen-portal', 'qwen_portal', 'qwenintl'],
  deepseek: ['deepseek-ai', 'deepseek_ai', 'deepseekai'],
  zhipu: ['zhipuai', 'zhipuai-coding-plan'],
  zai: ['zai-org', 'zai-coding-plan'],
  moonshot: ['moonshotai'],
  'moonshot-cn': ['moonshotai-cn', 'moonshot_cn', 'moonshotcn'],
  minimax: ['minimaxai', 'minimax-coding-plan'],
  'minimax-cn': ['minimax_cn', 'minimaxcn', 'minimax-cn-coding-plan'],
  together: ['togetherai'],
  kilocode: ['kilo'],
}

export function normalizeProviderIdToken(provider: ProviderName) {
  return provider.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

const PROVIDER_ALIAS_TO_ID: Record<string, string> = Object.entries(PROVIDER_CANONICAL_ALIAS_VALUES).reduce(
  (acc, [canonicalId, aliases]) => {
    const canonicalToken = normalizeProviderIdToken(canonicalId)
    if (canonicalToken) acc[canonicalToken] = canonicalId
    for (const alias of aliases) {
      const aliasToken = normalizeProviderIdToken(alias)
      if (!aliasToken) continue
      acc[aliasToken] = canonicalId
    }
    return acc
  },
  {} as Record<string, string>,
)

export function canonicalProviderId(provider: ProviderName) {
  const normalized = provider.trim().toLowerCase()
  if (!normalized) return ''
  const normalizedToken = normalizeProviderIdToken(normalized)
  return PROVIDER_ALIAS_TO_ID[normalizedToken] ?? normalized
}

export function providerSearchAliases(provider: ProviderName) {
  const canonical = canonicalProviderId(provider)
  return PROVIDER_CANONICAL_ALIAS_VALUES[canonical] ?? []
}

export function defaultBaseUrl(provider: ProviderName) {
  const canonical = canonicalProviderId(provider)
  // Unknown providers must not silently fall back to OpenAI endpoints.
  return PROVIDER_BASE_URL_BY_ID[canonical] ?? ''
}
