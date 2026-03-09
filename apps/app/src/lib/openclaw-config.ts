import { tauriInvoke } from '@/lib/tauri'
import type { ChannelKind } from '@/lib/openclaw-handoff'

export interface OpenClawProviderConfigStatus {
  configured: boolean
  providerId?: string | null
  model?: string | null
  apiKeySet: boolean
  message: string
}

export async function getOpenClawProviderConfigStatus() {
  return tauriInvoke<OpenClawProviderConfigStatus>('get_openclaw_provider_config_status')
}

export interface OpenClawChannelConfigStatus {
  channel: string
  configured: boolean
  exists: boolean
  message: string
}

export async function getOpenClawChannelConfigStatus(channel: ChannelKind) {
  return tauriInvoke<OpenClawChannelConfigStatus>('get_openclaw_channel_config_status', {
    input: { channel },
  })
}

export interface OpenClawAgentOverviewItem {
  id: string
  label: string
  workspace: string
  primaryModel: string
  fallbackModels: string[]
  skillsSummary: string
  defaultAgent: boolean
}

export interface OpenClawAgentsOverviewSnapshot {
  defaultAgentId?: string | null
  activeKeyHubProfileId?: string | null
  modelOptions: Array<{
    id: string
    label: string
    source: 'openclaw' | 'keyHub' | string
    modelId: string
    profileId?: string | null
  }>
  agents: OpenClawAgentOverviewItem[]
}

export async function getOpenClawAgentsOverview() {
  return tauriInvoke<OpenClawAgentsOverviewSnapshot>('get_openclaw_agents_overview')
}

export interface OpenClawAgentSessionItem {
  key: string
  agentId: string
  sessionId: string
  updatedAt: number
  channel?: string | null
  model?: string | null
  title?: string | null
  preview?: string | null
}

export interface OpenClawAgentSessionsSnapshot {
  sessions: OpenClawAgentSessionItem[]
}

export async function getOpenClawAgentSessions() {
  return tauriInvoke<OpenClawAgentSessionsSnapshot>('get_openclaw_agent_sessions')
}

export interface SaveOpenClawAgentPrimaryModelInput {
  agentId: string
  modelId: string
  source?: 'openclaw' | 'keyHub' | string
  profileId?: string
}

export interface SaveOpenClawAgentPrimaryModelResult {
  agentId: string
  modelId: string
  configPath: string
  message: string
}

export async function saveOpenClawAgentPrimaryModel(input: SaveOpenClawAgentPrimaryModelInput) {
  return tauriInvoke<SaveOpenClawAgentPrimaryModelResult>('save_openclaw_agent_primary_model', { input })
}

export interface SaveTelegramChannelSetupInput {
  runtime: 'openclaw'
  botToken: string
  allowFrom?: string
}

export interface SaveTelegramChannelSetupResult {
  runtime: string
  configPath: string
  message: string
}

export async function saveTelegramChannelSetup(input: SaveTelegramChannelSetupInput) {
  return tauriInvoke<SaveTelegramChannelSetupResult>('save_telegram_channel_setup', { input })
}

export interface OpenClawChannelConfigItem {
  id: string
  label?: string | null
  configured?: boolean
  enabled?: boolean
  config?: Record<string, unknown> | null
  [key: string]: unknown
}

export interface OpenClawChannelsConfigResponse {
  channels?: OpenClawChannelConfigItem[] | Record<string, OpenClawChannelConfigItem>
  [key: string]: unknown
}

export interface SaveChannelConfigInput {
  channel: string
  config: Record<string, unknown>
  enabled?: boolean
}

export interface ChannelCommandInput {
  channel: string
}

export interface OpenClawChannelCommandResult {
  channel?: string
  message?: string
  [key: string]: unknown
}

export async function getChannelsConfig() {
  return tauriInvoke<OpenClawChannelsConfigResponse>('get_channels_config', { input: {} })
}

export async function saveChannelConfig(input: SaveChannelConfigInput) {
  return tauriInvoke<OpenClawChannelCommandResult>('save_channel_config', { input })
}

export async function clearChannelConfig(input: ChannelCommandInput) {
  return tauriInvoke<OpenClawChannelCommandResult>('clear_channel_config', { input })
}

export async function testChannel(input: ChannelCommandInput) {
  return tauriInvoke<OpenClawChannelCommandResult>('test_channel', { input })
}

export async function startChannelLogin(input: ChannelCommandInput) {
  return tauriInvoke<OpenClawChannelCommandResult>('start_channel_login', { input })
}
