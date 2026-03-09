import { getVersion } from '@tauri-apps/api/app'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

export async function getHolyCrabVersion(): Promise<string> {
  return await getVersion()
}

export type UpdateProgress = {
  status: 'idle' | 'downloading' | 'downloaded'
  downloadedBytes: number
  totalBytes?: number
}

export async function checkHolyCrabUpdate(locale: 'en' | 'zh' = 'en'): Promise<Update | null> {
  const zh = locale === 'zh'
  try {
    return await check({ timeout: 8_000 })
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err)
    if (
      msg.includes('fallback platforms')
      && msg.includes('were found in the response `platforms` object')
    ) {
      // Updater metadata exists but this platform has no published artifact yet.
      // Treat as "no update" instead of surfacing a hard error in UI.
      console.warn('Updater manifest has no current-platform entry:', msg)
      return null
    }
    // Current known failure mode: prod endpoint TLS is not ready yet.
    // Give a concrete local-mock path so we can keep shipping the feature while infra catches up.
    if (msg.includes('software-center.holycrab.ai') || msg.toLowerCase().includes('ssl')) {
      throw new Error(
        [
          zh
            ? '更新检查失败：线上更新地址暂时不可用（HTTPS/TLS 未就绪）。'
            : 'Update check failed: production update endpoint is temporarily unavailable (HTTPS/TLS not ready).',
          zh
            ? '本地测试：运行 `./scripts/mock-holycrab-updater-local.sh` 后重试。'
            : 'For local testing: run `./scripts/mock-holycrab-updater-local.sh` and retry.',
          zh ? `原始错误：${msg}` : `Original error: ${msg}`,
        ].join('\n'),
      )
    }
    if (msg.includes('127.0.0.1:18181') || msg.includes('127.0.0.1 port 18181')) {
      throw new Error(
        [
          zh
            ? '更新检查失败：本地 mock 服务未启动（127.0.0.1:18181 连接失败）。'
            : 'Update check failed: local mock server is not running (127.0.0.1:18181 connection failed).',
          zh
            ? '请保持下面命令运行中，然后回到 HolyCrab 重试 Check updates：'
            : 'Keep the command below running, then retry Check updates in HolyCrab:',
          '  `./scripts/mock-holycrab-updater-local.sh`',
          zh ? `原始错误：${msg}` : `Original error: ${msg}`,
        ].join('\n'),
      )
    }
    throw err
  }
}

export async function predownloadHolyCrabUpdate(
  update: Update,
  onProgress: (progress: UpdateProgress) => void,
): Promise<void> {
  let downloadedBytes = 0
  let totalBytes: number | undefined

  onProgress({ status: 'downloading', downloadedBytes, totalBytes })

  await update.download((event: DownloadEvent) => {
    if (event.event === 'Started') {
      totalBytes = event.data.contentLength
      onProgress({ status: 'downloading', downloadedBytes, totalBytes })
      return
    }
    if (event.event === 'Progress') {
      downloadedBytes += event.data.chunkLength
      onProgress({ status: 'downloading', downloadedBytes, totalBytes })
      return
    }
    onProgress({ status: 'downloaded', downloadedBytes, totalBytes })
  })
}

export async function installHolyCrabUpdateAndRelaunch(update: Update): Promise<void> {
  await update.install()
  await update.close()
  await relaunch()
}
