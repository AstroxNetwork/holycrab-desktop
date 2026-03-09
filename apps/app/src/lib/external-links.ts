import { getDevRuntimeConfig } from '@/lib/dev-runtime-config'

function envValue(key: string): string | undefined {
  const raw = import.meta.env[key] as string | undefined
  const value = raw?.trim()
  return value ? value : undefined
}

export const externalLinks = {
  get keyMarketplace() {
    return getDevRuntimeConfig().keyMarketplaceUrl
  },
  discoverCloud: envValue('VITE_DISCOVER_CLOUD_URL') ?? 'https://openclaw.ai',
  get discoverApiDeals() {
    return getDevRuntimeConfig().discoverApiDealsUrl
  },
  get discoverGuides() {
    return getDevRuntimeConfig().discoverGuidesUrl
  },
  botfather: envValue('VITE_SETUP_BOTFATHER_URL') ?? 'https://t.me/BotFather',
  botfatherVideo:
    envValue('VITE_SETUP_BOTFATHER_VIDEO_URL')
    ?? 'https://s3.ap-east-1.amazonaws.com/optest.astrox.app/botfather.mp4',
  workanyDownload: envValue('VITE_WORKANY_DOWNLOAD_URL') ?? 'https://workany.ai/download',
  codexDocs: envValue('VITE_CODEX_DOCS_URL') ?? 'https://github.com/openai/codex',
  claudeDocs:
    envValue('VITE_CLAUDE_CODE_DOCS_URL')
    ?? 'https://docs.anthropic.com/en/docs/claude-code/overview',
}
