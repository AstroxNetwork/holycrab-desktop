import { create } from 'zustand'

import { getOpenClawChatBootstrapSnapshot, type OpenClawChatBootstrapSnapshot } from '@/lib/openclaw-chat-bootstrap'
import type { NormalizedMessage } from '@/components/chat/types'

const DEFAULT_ASSISTANT_NAME = 'Assistant'
const DEFAULT_ASSISTANT_AVATAR = 'A'

export type ChatStoreState = {
  bootstrap: OpenClawChatBootstrapSnapshot | null
  bootstrapping: boolean
  connected: boolean
  loadingHistory: boolean
  historyReady: boolean
  messageScrollTop: number
  messageManualUp: boolean
  messages: NormalizedMessage[]
  sending: boolean
  streamText: string | null
  runId: string | null
  activeRunSessionKey: string | null
  liveSessionKeys: string[]
  unreadCompletedSessionKeys: string[]
  error: string | null
  queuedCount: number
  assistantName: string
  assistantAvatar: string | null
  draftInput: string
}

export type ChatStoreActions = {
  patch: (patch: Partial<ChatStoreState>) => void
  reset: () => void
}

const initialState: ChatStoreState = {
  bootstrap: getOpenClawChatBootstrapSnapshot(),
  bootstrapping: !getOpenClawChatBootstrapSnapshot(),
  connected: false,
  loadingHistory: false,
  historyReady: false,
  messageScrollTop: 0,
  messageManualUp: false,
  messages: [],
  sending: false,
  streamText: null,
  runId: null,
  activeRunSessionKey: null,
  liveSessionKeys: [],
  unreadCompletedSessionKeys: [],
  error: null,
  queuedCount: 0,
  assistantName: DEFAULT_ASSISTANT_NAME,
  assistantAvatar: DEFAULT_ASSISTANT_AVATAR,
  draftInput: '',
}

export const useChatStore = create<ChatStoreState & ChatStoreActions>()((set) => ({
  ...initialState,
  patch: (patch) => set(patch),
  reset: () => set(initialState),
}))

export { DEFAULT_ASSISTANT_NAME, DEFAULT_ASSISTANT_AVATAR }
