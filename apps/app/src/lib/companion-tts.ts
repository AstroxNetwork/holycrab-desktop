import { tauriInvoke } from '@/lib/tauri'

export interface CompanionTtsInput {
  text: string
  provider?: string
  model?: string
  voice?: string
  namespace?: string
  endpoint?: string
  api_key?: string
  app_key?: string
}

export interface CompanionTtsResult {
  mimeType: string
  audioBase64: string
  provider: string
}

export type CompanionSpeechErrorKind = 'service' | 'config' | 'playback' | 'unknown'

export interface CompanionSpeechError {
  kind: CompanionSpeechErrorKind
  message: string
  details: string
}

export interface CompanionSpeechOptions {
  onAmplitude?: (value: number) => void
  onEnded?: () => void
  onError?: (error: CompanionSpeechError) => void
}

export interface CompanionSpeechSession {
  stop: () => void
  ended: Promise<void>
}

const SERVICE_ERROR_HINTS = [
  'request failed',
  'timeout',
  'connection',
  'connect',
  'http',
  'network',
  '503',
  '502',
  '504',
  'endpoint',
  'service',
  'http',
  'status',
]

const CONFIG_ERROR_HINTS = [
  'token is required',
  'app key is required',
  'api key is required',
  'unsupported provider',
  'text is required',
  'invalid',
  '401',
  '403',
  'unauthorized',
  'forbidden',
]

const BASE64_CHECK_RE = /^[A-Za-z0-9+/=\n\r\t ]+$/

function maskToken(raw: string | undefined) {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return '<empty>'
  if (trimmed.length <= 10) return '***'
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`
}

function isLikelyBase64Audio(value: string) {
  const compact = value.trim()
  return compact.length >= 16 && BASE64_CHECK_RE.test(compact)
}

function isVolcanoV3Endpoint(endpoint: string) {
  return endpoint.includes('/api/v3/')
}

function formatDebugHeaders(input: CompanionTtsInput) {
  const provider = normalizeCompanionProvider(input.provider)
  const endpoint = input.endpoint?.trim() ?? ''
  const headers: Record<string, string> = {}

  const maskedApiKey = maskToken(input.api_key)
  const maskedAppKey = maskToken(input.app_key)

  if (provider === 'volcano') {
    if (isVolcanoV3Endpoint(endpoint)) {
      if (input.app_key?.trim()) {
        headers['X-Api-App-Key'] = maskedAppKey
      }
      if (input.api_key?.trim()) {
        headers['X-Api-Access-Key'] = maskedApiKey
      }
      if (input.namespace?.trim()) {
        headers['X-Api-Resource-Id'] = input.namespace.trim()
      }
      headers['Accept'] = 'text/event-stream, application/json'
    } else {
      if (input.api_key?.trim()) {
        headers['authorization'] = `Bearer;${maskedApiKey}`
      }
      headers['Accept'] = 'application/json'
      headers['Content-Type'] = 'application/json'
    }
  } else if (provider === 'qwen') {
    if (input.api_key?.trim()) {
      headers.Authorization = `Bearer ${maskedApiKey}`
    }
    headers['Content-Type'] = 'application/json'
  }

  headers['User-Agent'] = 'companion-frontend'
  return {
    endpoint,
    provider,
    headers,
  }
}

function normalizeCompanionProvider(raw: string | undefined) {
  return raw?.trim().toLowerCase() === 'qwen' ? 'qwen' : 'volcano'
}

function normalizeCompanionSpeechError(raw: unknown): CompanionSpeechError {
  const message = raw instanceof Error ? raw.message : String(raw || '')
  const normalized = message.toLowerCase()
  const fallback: CompanionSpeechError = {
    kind: 'unknown',
    message: message || 'Unknown companion speech error.',
    details: message,
  }

  if (SERVICE_ERROR_HINTS.some((hint) => normalized.includes(hint))) {
    return { ...fallback, kind: 'service' }
  }
  if (CONFIG_ERROR_HINTS.some((hint) => normalized.includes(hint))) {
    return { ...fallback, kind: 'config' }
  }
  return fallback
}

export function classifyCompanionSpeechError(raw: unknown, fallbackKind: CompanionSpeechErrorKind = 'unknown'): CompanionSpeechError {
  const normalized = normalizeCompanionSpeechError(raw)
  if (normalized.kind === 'unknown' && fallbackKind !== 'unknown') {
    return { ...normalized, kind: fallbackKind }
  }
  return normalized
}

export async function requestCompanionSpeech(
  input: CompanionTtsInput,
): Promise<CompanionTtsResult> {
  const normalizedEndpoint = input.endpoint?.trim() ?? ''
  if (typeof window !== 'undefined') {
    const payload = {
      textLen: input.text?.length ?? 0,
      provider: input.provider,
      model: input.model,
      voice: input.voice,
      namespace: input.namespace,
      endpoint: normalizedEndpoint,
      apiKey: maskToken(input.api_key),
      appKey: maskToken(input.app_key),
    }
    const requestBody = {
      textLen: input.text?.length ?? 0,
      user: {
        uid: 'companion-client',
      },
      req_params: {
        text: input.text,
        speaker: input.voice,
        audio_params: {
          format: 'mp3',
          sample_rate: 24000,
        },
      },
      namespace: isVolcanoV3Endpoint(normalizedEndpoint) ? 'BidirectionalTTS' : '(v1 format)',
    }

    // eslint-disable-next-line no-console
    console.groupCollapsed('[Companion TTS] request payload')
    // eslint-disable-next-line no-console
    console.log(payload)
    // eslint-disable-next-line no-console
    console.log('[Companion TTS] request headers', formatDebugHeaders(input))
    // eslint-disable-next-line no-console
    console.log('[Companion TTS] request body (preview)', requestBody)
    // eslint-disable-next-line no-console
    console.groupEnd()
  }

  return tauriInvoke<CompanionTtsResult>('companion_tts_speak', {
    input: {
      text: input.text,
      provider: input.provider,
      model: input.model,
      voice: input.voice,
      namespace: input.namespace,
      endpoint: input.endpoint,
      apiKey: input.api_key,
      appKey: input.app_key,
    },
  })
}

export async function playCompanionSpeech(
  input: CompanionTtsInput,
  options: CompanionSpeechOptions = {},
): Promise<CompanionSpeechSession> {
  if (typeof window === 'undefined') {
    throw classifyCompanionSpeechError('Companion speech requires browser runtime.', 'playback')
  }
  if (!input.text.trim()) {
    throw classifyCompanionSpeechError('Companion speech text is required.', 'config')
  }

  let result: CompanionTtsResult
  try {
    result = await requestCompanionSpeech(input)
  } catch (error) {
    const speechError = classifyCompanionSpeechError(error)
    options.onError?.(speechError)
    throw speechError
  }

  if (!result.audioBase64 || !isLikelyBase64Audio(result.audioBase64)) {
    const speechError = classifyCompanionSpeechError('TTS response missing or invalid audio payload.', 'playback')
    options.onError?.(speechError)
    throw speechError
  }

  const audio = new Audio(`data:${result.mimeType || 'audio/mpeg'};base64,${result.audioBase64}`)
  const source = `${result.provider}`

  let stopped = false
  let rafId = 0
  let audioContext: AudioContext | null = null
  let sourceNode: MediaElementAudioSourceNode | null = null
  let analyser: AnalyserNode | null = null
  let data: Uint8Array<ArrayBuffer> | null = null
  let endedSettled = false
  let endedResolve: (() => void) | null = null
  let endedReject: ((error: CompanionSpeechError) => void) | null = null
  const endCallbacks: Array<() => void> = []

  const settleEnded = (error: CompanionSpeechError | null = null) => {
    if (endedSettled) return
    endedSettled = true
    if (error) {
      endedReject?.(error)
    } else {
      endedResolve?.()
    }
    endedResolve = null
    endedReject = null
  }

  const cleanup = () => {
    if (stopped) return
    stopped = true

    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }

    for (const fn of endCallbacks) {
      fn()
    }
    endCallbacks.length = 0

    audio.pause()
    audio.currentTime = 0
    audio.src = ''

    if (sourceNode) {
      sourceNode.disconnect()
      sourceNode = null
    }
    if (analyser) {
      analyser.disconnect()
      analyser = null
    }
    if (audioContext) {
      void audioContext.close()
      audioContext = null
    }

    options.onAmplitude?.(0)
    settleEnded()
  }

  const ended = new Promise<void>((resolve, reject) => {
    endedResolve = resolve
    endedReject = (error: CompanionSpeechError) => reject(error)

    const handleError = () => {
      const speechError = classifyCompanionSpeechError(
        `Companion speech play failed for source ${source}: ${audio.error?.message || 'Audio playback failed.'}`,
        'playback'
      )
      cleanup()
      options.onError?.(speechError)
      settleEnded(speechError)
    }

    const handleEnded = () => {
      cleanup()
      options.onEnded?.()
      settleEnded()
    }

    audio.addEventListener('ended', handleEnded, { once: true })
    audio.addEventListener('error', handleError, { once: true })

    endCallbacks.push(() => audio.removeEventListener('ended', handleEnded))
    endCallbacks.push(() => audio.removeEventListener('error', handleError))
  })

  if (options.onAmplitude) {
    const context = new AudioContext()
    const analyserNode = context.createAnalyser()
    const mediaNode = context.createMediaElementSource(audio)
    analyserNode.fftSize = 256
    mediaNode.connect(analyserNode)
    analyserNode.connect(context.destination)
    audioContext = context
    sourceNode = mediaNode
    analyser = analyserNode
      data = new Uint8Array(analyser.frequencyBinCount)

    const onFrame = () => {
      if (stopped || !analyser || !data) return
      analyser.getByteTimeDomainData(data)
      let sumSquares = 0
      for (const sample of data) {
        const norm = (sample - 128) / 128
        sumSquares += norm * norm
      }
      const rms = Math.sqrt(sumSquares / data.length)
      options.onAmplitude?.(rms)
      rafId = requestAnimationFrame(onFrame)
    }

    const handlePlay = async () => {
      if (!audioContext || audioContext.state === 'suspended') {
        try {
          await audioContext?.resume()
        } catch {
          // ignore resume failures
        }
      }
      rafId = requestAnimationFrame(onFrame)
    }

    audio.addEventListener('play', handlePlay, { once: true })
    endCallbacks.push(() => audio.removeEventListener('play', handlePlay))
  }

  try {
    await audio.play()
  } catch (error) {
      const speechError = classifyCompanionSpeechError(
        error ?? 'Failed to start companion playback.',
        'playback'
      )
      cleanup()
      options.onError?.(speechError)
      settleEnded(speechError)
      throw speechError
    }

  return {
    stop: cleanup,
    ended,
  }
}
