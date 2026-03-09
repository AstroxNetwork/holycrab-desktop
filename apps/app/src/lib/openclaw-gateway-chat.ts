import { clearDeviceAuthToken, loadDeviceAuthToken, storeDeviceAuthToken } from './openclaw-device-auth-store'
import { buildDeviceAuthPayload } from './openclaw-device-auth-payload'
import { loadOrCreateDeviceIdentity, type DeviceIdentity, signDevicePayload } from './openclaw-device-identity'

export type GatewayEventFrame = {
  type: 'event'
  event: string
  payload?: unknown
  seq?: number
}

export type GatewayResponseFrame = {
  type: 'res'
  id: string
  ok: boolean
  payload?: unknown
  error?: { code: string; message: string; details?: unknown }
}

export type GatewayErrorInfo = {
  code: string
  message: string
  details?: unknown
}

export type GatewayCloseInfo = {
  code: number
  reason: string
  error?: GatewayErrorInfo
}

type GatewayHelloOk = {
  snapshot?: unknown
  auth?: {
    deviceToken?: string
    role?: string
    scopes?: string[]
  }
}

export class GatewayRequestError extends Error {
  readonly gatewayCode: string
  readonly details?: unknown

  constructor(error: GatewayErrorInfo) {
    super(error.message)
    this.name = 'GatewayRequestError'
    this.gatewayCode = error.code
    this.details = error.details
  }
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: unknown) => void
}

export type OpenClawGatewayClientOptions = {
  url: string
  token?: string
  clientName?: string
  clientVersion?: string
  platform?: string
  instanceId?: string
  clientMode?: string
  role?: string
  scopes?: string[]
  onConnectedChange?: (connected: boolean) => void
  onHello?: (hello: GatewayHelloOk) => void
  onEvent?: (event: GatewayEventFrame) => void
  onError?: (error: string) => void
  onClose?: (info: GatewayCloseInfo) => void
}

const CONNECT_FAILED_CLOSE_CODE = 4008
const GATEWAY_CLIENT_ID_DEFAULT = 'openclaw-control-ui'
const GATEWAY_CLIENT_MODE_WEBCHAT = 'webchat'
const GATEWAY_CONNECT_ROLE = 'operator'
const GATEWAY_CONNECT_SCOPES = [
  'operator.read',
  'operator.write',
  'operator.admin',
  'operator.approvals',
  'operator.pairing',
]

function nextId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export class OpenClawGatewayClient {
  private readonly options: OpenClawGatewayClientOptions
  private ws: WebSocket | null = null
  private pending = new Map<string, Pending>()
  private closed = false
  private connectSent = false
  private connectTimer: number | null = null
  private connectNonce: string | null = null
  private backoffMs = 800
  private pendingConnectError: GatewayErrorInfo | undefined

  constructor(options: OpenClawGatewayClientOptions) {
    this.options = options
  }

  start() {
    this.closed = false
    this.connect()
  }

  stop() {
    this.closed = true
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    this.ws?.close()
    this.ws = null
    this.pendingConnectError = undefined
    this.flushPending(new Error('gateway client stopped'))
    this.options.onConnectedChange?.(false)
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('gateway not connected'))
    }

    const id = nextId()
    const frame = { type: 'req', id, method, params }
    const task = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject })
    })
    this.ws.send(JSON.stringify(frame))
    return task
  }

  private connect() {
    if (this.closed) return

    this.ws = new WebSocket(this.options.url)
    this.ws.addEventListener('open', () => this.queueConnect())
    this.ws.addEventListener('message', (event) => {
      this.handleMessage(String(event.data ?? ''))
    })
    this.ws.addEventListener('close', (event) => {
      const reason = String(event.reason ?? '')
      const connectError = this.pendingConnectError
      this.pendingConnectError = undefined
      this.ws = null
      this.options.onConnectedChange?.(false)
      this.flushPending(new Error(`gateway closed (${event.code}): ${reason}`))
      this.options.onClose?.({ code: event.code, reason, error: connectError })
      this.scheduleReconnect()
    })
    this.ws.addEventListener('error', () => {
      // Keep this silent. Browsers often emit a generic websocket error before/alongside
      // close; the close/connect path carries the actionable reason.
    })
  }

  private queueConnect() {
    this.connectNonce = null
    this.connectSent = false
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    this.connectTimer = window.setTimeout(() => {
      void this.sendConnect()
    }, 750)
  }

  private scheduleReconnect() {
    if (this.closed) return
    const delay = this.backoffMs
    this.backoffMs = Math.min(Math.floor(this.backoffMs * 1.7), 15_000)
    window.setTimeout(() => {
      this.connect()
    }, delay)
  }

  private async sendConnect() {
    if (this.connectSent) return
    this.connectSent = true

    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer)
      this.connectTimer = null
    }

    const connectRole = (this.options.role || GATEWAY_CONNECT_ROLE).trim() || GATEWAY_CONNECT_ROLE
    const connectMode = (this.options.clientMode || GATEWAY_CLIENT_MODE_WEBCHAT).trim() || GATEWAY_CLIENT_MODE_WEBCHAT
    const connectScopes = Array.isArray(this.options.scopes) && this.options.scopes.length > 0
      ? this.options.scopes
      : GATEWAY_CONNECT_SCOPES

    const isSecureContext = typeof crypto !== 'undefined' && Boolean(crypto.subtle)
    let deviceIdentity: DeviceIdentity | null = null
    let authToken = this.options.token
    let usingStoredToken = false

    if (isSecureContext) {
      deviceIdentity = await loadOrCreateDeviceIdentity()
      const storedToken = loadDeviceAuthToken({
        deviceId: deviceIdentity.deviceId,
        role: connectRole,
      })?.token
      if (!authToken && storedToken) {
        authToken = storedToken
        usingStoredToken = true
      }
    }

    const auth = authToken
      ? {
          token: authToken,
        }
      : undefined

    let device:
      | {
        id: string
        publicKey: string
        signature: string
        signedAt: number
        nonce: string
      }
      | undefined

    if (isSecureContext && deviceIdentity) {
      const signedAtMs = Date.now()
      const nonce = this.connectNonce ?? ''
      const payload = buildDeviceAuthPayload({
        deviceId: deviceIdentity.deviceId,
        clientId: this.options.clientName ?? GATEWAY_CLIENT_ID_DEFAULT,
        clientMode: connectMode,
        role: connectRole,
        scopes: connectScopes,
        signedAtMs,
        token: authToken ?? null,
        nonce,
      })
      const signature = await signDevicePayload(deviceIdentity.privateKey, payload)
      device = {
        id: deviceIdentity.deviceId,
        publicKey: deviceIdentity.publicKey,
        signature,
        signedAt: signedAtMs,
        nonce,
      }
    }

    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: this.options.clientName ?? GATEWAY_CLIENT_ID_DEFAULT,
        version: this.options.clientVersion ?? 'dev',
        platform: this.options.platform ?? navigator.platform ?? 'web',
        mode: connectMode,
        instanceId: this.options.instanceId,
      },
      role: connectRole,
      scopes: connectScopes,
      device,
      caps: [],
      auth,
      userAgent: navigator.userAgent,
      locale: navigator.language,
    }

    try {
      const hello = await this.request<GatewayHelloOk>('connect', params)
      if (hello?.auth?.deviceToken && deviceIdentity) {
        storeDeviceAuthToken({
          deviceId: deviceIdentity.deviceId,
          role: hello.auth.role ?? connectRole,
          token: hello.auth.deviceToken,
          scopes: hello.auth.scopes ?? [],
        })
      }
      this.backoffMs = 800
      this.options.onHello?.(hello)
      this.options.onConnectedChange?.(true)
    } catch (error) {
      if (usingStoredToken && deviceIdentity) {
        clearDeviceAuthToken({
          deviceId: deviceIdentity.deviceId,
          role: connectRole,
        })
      }
      if (error instanceof GatewayRequestError) {
        this.pendingConnectError = {
          code: error.gatewayCode,
          message: error.message,
          details: error.details,
        }
        this.options.onError?.(error.message)
      }
      this.ws?.close(CONNECT_FAILED_CLOSE_CODE, 'connect failed')
    }
  }

  private handleMessage(raw: string) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }

    const frame = parsed as { type?: unknown }
    if (frame.type === 'event') {
      const eventFrame = parsed as GatewayEventFrame
      if (eventFrame.event === 'connect.challenge') {
        const payload = eventFrame.payload as { nonce?: unknown } | undefined
        const nonce = payload && typeof payload.nonce === 'string' ? payload.nonce : null
        if (nonce) {
          this.connectNonce = nonce
          this.connectSent = false
          void this.sendConnect()
        }
        return
      }
      this.options.onEvent?.(eventFrame)
      return
    }

    if (frame.type !== 'res') {
      return
    }

    const responseFrame = parsed as GatewayResponseFrame
    const pending = this.pending.get(responseFrame.id)
    if (!pending) {
      return
    }

    this.pending.delete(responseFrame.id)
    if (responseFrame.ok) {
      pending.resolve(responseFrame.payload)
      return
    }

    pending.reject(
      new GatewayRequestError({
        code: responseFrame.error?.code ?? 'UNAVAILABLE',
        message: responseFrame.error?.message ?? 'request failed',
        details: responseFrame.error?.details,
      }),
    )
  }

  private flushPending(error: Error) {
    for (const [, pending] of this.pending) {
      pending.reject(error)
    }
    this.pending.clear()
  }
}
