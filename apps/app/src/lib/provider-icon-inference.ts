import anthropicIcon from '@/assets/providers/anthropic.svg'
import googleIcon from '@/assets/providers/google.svg'
import openaiIcon from '@/assets/providers/openai.svg'

interface IconConfig {
  icon?: string
  iconColor?: string
}

const iconMappings: Record<string, IconConfig> = {
  openai: { icon: 'openai', iconColor: '#10A37F' },
  anthropic: { icon: 'anthropic', iconColor: '#D4915D' },
  claude: { icon: 'anthropic', iconColor: '#D4915D' },
  google: { icon: 'google', iconColor: '#4285F4' },
  gemini: { icon: 'google', iconColor: '#4285F4' },
}

const iconById: Record<string, string> = {
  openai: openaiIcon,
  anthropic: anthropicIcon,
  google: googleIcon,
}

export interface ProviderIconVisual {
  iconSrc?: string
  iconColor: string
  badgeText: string
}

export function inferIconForPreset(presetName: string): IconConfig {
  const nameLower = presetName.toLowerCase()
  for (const [key, config] of Object.entries(iconMappings)) {
    if (nameLower.includes(key)) {
      return config
    }
  }
  return {}
}

export function inferProviderVisual(input: {
  provider?: string
  baseUrl?: string
  model?: string
  profileName?: string
}): ProviderIconVisual {
  const probe = [input.provider, input.baseUrl, input.model, input.profileName]
    .filter(Boolean)
    .join(' ')
  const inferred = inferIconForPreset(probe)
  const iconSrc = inferred.icon ? iconById[inferred.icon] : undefined
  return {
    iconSrc,
    iconColor: inferred.iconColor || '#9CA3AF',
    badgeText: iconSrc ? '' : '{}',
  }
}
