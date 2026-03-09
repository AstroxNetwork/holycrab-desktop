import {
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createFileRoute, useRouterState } from '@tanstack/react-router';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Home, Loader2, Mic, Move, Send, Settings, Square, X } from 'lucide-react';
import { CompanionLive2dViewer } from '@/components/companion-live2d-viewer';
import type { ChatAttachment } from '@/components/chat/types';
import { useLocale } from '@/lib/locale-context';
import {
  dictationDownloadModel,
  dictationModelStatus,
  dictationStart,
  dictationStop,
  listenDictationEvents,
  type DictationSessionState,
} from '@/lib/dictation';
import { computeDictationInsertion } from '@/lib/dictation-input';
import { playCompanionSpeech, type CompanionSpeechSession } from '@/lib/companion-tts';
import { tauriInvoke } from '@/lib/tauri';
import { ensureChatRuntimeStarted, sendChatMessage, setActiveChatSessionKey } from '@/lib/chat-runtime';
import { useChatStore } from '@/stores/chat-store';

type CompanionMode = 'idle' | 'thinking' | 'speaking';
const FLOATING_BACKGROUND = 'transparent';
type DictationHoldKey = 'off' | 'alt' | 'shift' | 'control' | 'meta';
type DictationConfig = {
  enabled: boolean;
  model: string;
  language: string | null;
  holdKey: DictationHoldKey;
};

interface SettingsView {
  dictation?: {
    enabled?: boolean;
    model?: string;
    language?: string | null;
    holdKey?: string;
  };
  companion?: {
    enabled?: boolean;
    provider?: string;
    model?: string;
    voice?: string;
    namespace?: string;
    endpoint?: string;
    apiKey?: string;
    appKey?: string;
  };
}

const DEFAULT_DICTATION_CONFIG: DictationConfig = {
  enabled: false,
  model: 'base',
  language: null,
  holdKey: 'alt',
};
type CompanionSpeechConfig = {
  enabled: boolean;
  provider: string;
  model: string;
  voice: string;
  namespace: string;
  endpoint: string;
  apiKey: string;
  appKey: string;
};
const DEFAULT_COMPANION_SPEECH_CONFIG: CompanionSpeechConfig = {
  enabled: false,
  provider: 'volcano',
  model: '',
  voice: '',
  namespace: '',
  endpoint: '',
  apiKey: '',
  appKey: '',
};
const CLOSE_INPUT_AFTER_SUCCESS_DELAY_MS = 420;
const SEND_PREVIEW_VISIBLE_MS = 10_000;
const ASSISTANT_REPLY_VISIBLE_MS = 10_000;
const ASSISTANT_REPLY_MIN_VISIBLE_WITH_SPEECH_MS = 1200;

export const Route = createFileRoute('/companion/floating')({
  component: CompanionFloatingWindowPage,
});

function readSearchParam(search: unknown, key: string): string {
  if (!search || !key) {
    return '';
  }
  if (typeof search === 'string') {
    const idx = search.indexOf('?');
    const raw = idx >= 0 ? search.slice(idx + 1) : search.startsWith('?') ? search.slice(1) : search;
    return new URLSearchParams(raw).get(key)?.trim() ?? '';
  }
  if (typeof search === 'object') {
    const value = (search as Record<string, unknown>)[key];
    if (typeof value === 'string') {
      return value.trim();
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) {
          return item.trim();
        }
      }
    }
  }
  return '';
}

function normalizeCompanionMode(raw: string): CompanionMode {
  if (raw === 'thinking' || raw === 'speaking') {
    return raw;
  }
  return 'idle';
}

function parseHashQuery(hashPath: string): string {
  const idx = hashPath.indexOf('?');
  if (idx < 0) {
    return '';
  }
  return hashPath.slice(idx + 1);
}

function readModelIdFromSources(routeSearch: unknown, hashQuery: string): string {
  return readSearchParam(routeSearch, 'modelId') || readSearchParam(hashQuery, 'modelId');
}

function readModelPathFromSources(routeSearch: unknown, hashQuery: string): string {
  return readSearchParam(routeSearch, 'modelPath') || readSearchParam(hashQuery, 'modelPath');
}

function readModeFromSources(routeSearch: unknown, hashQuery: string): CompanionMode {
  const rawMode = readSearchParam(routeSearch, 'mode') || readSearchParam(hashQuery, 'mode');
  return normalizeCompanionMode(rawMode);
}

function createAttachmentId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeReplyPreview(text: string, maxLength = 84, emptyText = '') {
  const normalized = text.trim();
  if (!normalized) {
    return emptyText;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}…`;
}

function resolveLatestAssistantReply(messages: { id: string; role: string; text: string; timestamp: number }[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role.toLowerCase() === 'assistant') {
      return message;
    }
  }
  return null;
}

function buildAssistantReplyFingerprint(message: { text: string; timestamp: number } | null) {
  if (!message) {
    return '';
  }
  const normalizedText = message.text
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedText) {
    return '';
  }
  return normalizedText;
}

function formatReplyTimeLabel(timestamp: number | null | undefined) {
  if (!Number.isFinite(timestamp ?? NaN)) {
    return '';
  }
  const raw = Number(timestamp);
  const ms = raw < 1_000_000_000_000 ? raw * 1000 : raw;
  const date = new Date(ms);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function normalizeDictationConfig(payload: SettingsView | null): DictationConfig {
  const source = payload?.dictation;
  const model = typeof source?.model === 'string' && source.model.trim()
    ? source.model.trim()
    : DEFAULT_DICTATION_CONFIG.model;
  const language = typeof source?.language === 'string' && source.language.trim()
    ? source.language.trim().toLowerCase()
    : null;
  const holdKeyRaw = typeof source?.holdKey === 'string' ? source.holdKey.trim().toLowerCase() : '';
  const holdKey: DictationHoldKey =
    holdKeyRaw === 'off'
    || holdKeyRaw === 'alt'
    || holdKeyRaw === 'shift'
    || holdKeyRaw === 'control'
    || holdKeyRaw === 'meta'
      ? holdKeyRaw
      : DEFAULT_DICTATION_CONFIG.holdKey;
  return {
    enabled: Boolean(source?.enabled),
    model,
    language,
    holdKey,
  };
}

function normalizeCompanionSpeechConfig(payload: SettingsView | null): CompanionSpeechConfig {
  const source = payload?.companion;
  const providerRaw = typeof source?.provider === 'string' ? source.provider.trim().toLowerCase() : '';
  const provider = providerRaw === 'qwen' ? 'qwen' : 'volcano';
  return {
    enabled: Boolean(source?.enabled),
    provider,
    model: typeof source?.model === 'string' ? source.model.trim() : '',
    voice: typeof source?.voice === 'string' ? source.voice.trim() : '',
    namespace: typeof source?.namespace === 'string' ? source.namespace.trim() : '',
    endpoint: typeof source?.endpoint === 'string' ? source.endpoint.trim() : '',
    apiKey: typeof source?.apiKey === 'string' ? source.apiKey.trim() : '',
    appKey: typeof source?.appKey === 'string' ? source.appKey.trim() : '',
  };
}

function matchesHoldKey(event: globalThis.KeyboardEvent, holdKey: DictationHoldKey) {
  if (holdKey === 'off') return false;
  switch (holdKey) {
    case 'alt':
      return event.key === 'Alt';
    case 'shift':
      return event.key === 'Shift';
    case 'control':
      return event.key === 'Control';
    case 'meta':
      return event.key === 'Meta';
    default:
      return false;
  }
}

function CompanionFloatingWindowPage() {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const routeSearch = useRouterState({ select: state => state.location.search as unknown });
  const windowHash = typeof window === 'undefined' ? '' : window.location.hash;
  const hashPayload = windowHash.startsWith('#') ? windowHash.slice(1) : windowHash;
  const hashQuery = parseHashQuery(hashPayload);
  const routeModelId = readModelIdFromSources(routeSearch, hashQuery);
  const routeCompanionMode = readModeFromSources(routeSearch, hashQuery);
  const routeModelPath = readModelPathFromSources(routeSearch, hashQuery);
  const modelId = routeModelId;
  const modelPath = routeModelPath;
  const companionMode = routeCompanionMode;
  const activeModelId = modelId || null;
  const activeModelPath = modelPath || null;
  const [isHovered, setIsHovered] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showChatInput, setShowChatInput] = useState(false);
  const [chatInputText, setChatInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [chatSendStatus, setChatSendStatus] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [assistantReplyPreview, setAssistantReplyPreview] = useState('');
  const [showAssistantReplyBubble, setShowAssistantReplyBubble] = useState(false);
  const [isReplyBubbleExpanded, setIsReplyBubbleExpanded] = useState(false);
  const [unreadAssistantReplyCount, setUnreadAssistantReplyCount] = useState(0);
  const [activeReplyTimestamp, setActiveReplyTimestamp] = useState<number | null>(null);
  const [dictationConfig, setDictationConfig] = useState<DictationConfig>({ ...DEFAULT_DICTATION_CONFIG });
  const [companionSpeechConfig, setCompanionSpeechConfig] = useState<CompanionSpeechConfig>({
    ...DEFAULT_COMPANION_SPEECH_CONFIG,
  });
  const [dictationVisible, setDictationVisible] = useState(false);
  const [dictationState, setDictationState] = useState<DictationSessionState>('idle');
  const [dictationWorking, setDictationWorking] = useState(false);
  const holdDictationActive = useRef(false);
  const holdDictationStopPending = useRef(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatInputPanelRef = useRef<HTMLDivElement | null>(null);
  const lastAssistantReplyFingerprintRef = useRef<string | null>(null);
  const assistantReplyQueueRef = useRef<Array<{ text: string; timestamp: number }>>([]);
  const assistantReplyProcessingRef = useRef(false);
  const assistantReplyEpochRef = useRef(0);
  const companionAutoSpeechSessionRef = useRef<CompanionSpeechSession | null>(null);
  const companionAutoSpeechEpochRef = useRef(0);
  const companionSpeechConfigRef = useRef<CompanionSpeechConfig>(DEFAULT_COMPANION_SPEECH_CONFIG);
  const sendStatusTimerRef = useRef<number | null>(null);
  const closeAfterSuccessTimerRef = useRef<number | null>(null);
  const messages = useChatStore((state) => state.messages);
  const latestAssistantMessage = useMemo(() => resolveLatestAssistantReply(messages), [messages]);
  const closeCurrentWindow = useCallback(async () => {
    try {
      const currentWindow = getCurrentWindow();
      await currentWindow.close();
      return;
    } catch {
      // no-op
    }

    try {
      window.close();
    } catch {
      // no-op
    }
  }, []);

  const focusChatInput = useCallback(() => {
    requestAnimationFrame(() => {
      chatInputRef.current?.focus();
    });
  }, []);

  const handleOpenChatInput = useCallback(() => {
    if (closeAfterSuccessTimerRef.current) {
      window.clearTimeout(closeAfterSuccessTimerRef.current);
      closeAfterSuccessTimerRef.current = null;
    }
    setUnreadAssistantReplyCount(0);
    setShowAssistantReplyBubble(false);
    setIsReplyBubbleExpanded(false);
    setActiveReplyTimestamp(null);
    setShowChatInput(true);
    focusChatInput();
  }, [focusChatInput]);

  const setTimedStatus = useCallback((status: string | null, ttlMs = 2500) => {
    if (sendStatusTimerRef.current) {
      window.clearTimeout(sendStatusTimerRef.current);
      sendStatusTimerRef.current = null;
    }
    setChatSendStatus(status);
    if (status && ttlMs > 0) {
      sendStatusTimerRef.current = window.setTimeout(() => {
        setChatSendStatus(null);
        sendStatusTimerRef.current = null;
      }, ttlMs);
    }
  }, []);

  const handleChatInputChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setChatInputText(event.target.value);
  }, []);

  const closeChatInputPanel = useCallback((options?: { preserveStatus?: boolean }) => {
    const preserveStatus = Boolean(options?.preserveStatus);
    setShowChatInput(false);
    setChatInputText('');
    setAttachments([]);
    if (!preserveStatus && sendStatusTimerRef.current) {
      window.clearTimeout(sendStatusTimerRef.current);
      sendStatusTimerRef.current = null;
      setChatSendStatus(null);
    }
  }, []);

  const clearReplyIndicators = useCallback(() => {
    assistantReplyEpochRef.current += 1;
    assistantReplyQueueRef.current = [];
    assistantReplyProcessingRef.current = false;
    const activeSpeechSession = companionAutoSpeechSessionRef.current;
    companionAutoSpeechSessionRef.current = null;
    if (activeSpeechSession) {
      try {
        activeSpeechSession.stop();
      } catch {
        // no-op
      }
    }
    setUnreadAssistantReplyCount(0);
    setShowAssistantReplyBubble(false);
    setIsReplyBubbleExpanded(false);
    setActiveReplyTimestamp(null);
  }, []);

  const navigateToMainSession = useCallback(async () => {
    clearReplyIndicators();
    try {
      await tauriInvoke<boolean>('open_main_chat_window');
      return;
    } catch {
      // fallback for non-tauri preview contexts
    }
    window.location.hash = '#/chat';
  }, [clearReplyIndicators]);

  const navigateToCompanionPanel = useCallback(async () => {
    clearReplyIndicators();
    try {
      await tauriInvoke<boolean>('open_main_companion_window');
      return;
    } catch {
      // fallback for non-tauri preview contexts
    }
    window.location.hash = '#/labs/companion';
  }, [clearReplyIndicators]);

  const toggleReplyBubbleExpanded = useCallback(() => {
    setIsReplyBubbleExpanded((prev) => !prev);
  }, []);

  const drainAssistantReplyQueue = useCallback(async () => {
    if (assistantReplyProcessingRef.current) {
      return;
    }
    assistantReplyProcessingRef.current = true;
    const currentEpoch = assistantReplyEpochRef.current + 1;
    assistantReplyEpochRef.current = currentEpoch;

    while (assistantReplyQueueRef.current.length > 0) {
      if (assistantReplyEpochRef.current !== currentEpoch) {
        break;
      }
      const next = assistantReplyQueueRef.current.shift();
      if (!next) {
        continue;
      }

      setAssistantReplyPreview(makeReplyPreview(next.text, 84, tr('（新消息内容为空）', '(Reply is empty)')));
      setActiveReplyTimestamp(next.timestamp);
      setIsReplyBubbleExpanded(false);
      setUnreadAssistantReplyCount(1);
      setShowAssistantReplyBubble(true);

      const speechConfig = companionSpeechConfigRef.current;
      const speechText = next.text.trim();
      const shouldUseSpeechQueueMode = Boolean(speechConfig.enabled && speechText);
      const speechTask = !shouldUseSpeechQueueMode
        ? Promise.resolve()
        : (async () => {
            try {
              const session = await playCompanionSpeech({
                text: speechText,
                provider: speechConfig.provider,
                model: speechConfig.model || undefined,
                voice: speechConfig.voice || undefined,
                namespace: speechConfig.namespace || undefined,
                endpoint: speechConfig.endpoint || undefined,
                api_key: speechConfig.apiKey || undefined,
                app_key: speechConfig.appKey || undefined,
              });
              if (assistantReplyEpochRef.current !== currentEpoch) {
                session.stop();
                return;
              }
              companionAutoSpeechSessionRef.current = session;
              await session.ended;
              if (assistantReplyEpochRef.current !== currentEpoch) {
                return;
              }
              if (companionAutoSpeechSessionRef.current === session) {
                companionAutoSpeechSessionRef.current = null;
              }
            } catch (error) {
              if (assistantReplyEpochRef.current !== currentEpoch) {
                return;
              }
              const message = error instanceof Error ? error.message : String(error);
              setTimedStatus(`${tr('TTS 播报失败：', 'TTS playback failed: ')}${message}`);
            }
          })();

      if (shouldUseSpeechQueueMode) {
        const minVisibleTask = new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), ASSISTANT_REPLY_MIN_VISIBLE_WITH_SPEECH_MS);
        });
        await Promise.all([minVisibleTask, speechTask]);
      } else {
        await new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), ASSISTANT_REPLY_VISIBLE_MS);
        });
      }
      if (assistantReplyEpochRef.current !== currentEpoch) {
        break;
      }
      setShowAssistantReplyBubble(false);
      setIsReplyBubbleExpanded(false);
    }

    if (assistantReplyEpochRef.current === currentEpoch) {
      setUnreadAssistantReplyCount(0);
      setActiveReplyTimestamp(null);
    }
    assistantReplyProcessingRef.current = false;
  }, [setTimedStatus, tr]);

  const stopCompanionAutoSpeech = useCallback(() => {
    companionAutoSpeechEpochRef.current += 1;
    const session = companionAutoSpeechSessionRef.current;
    companionAutoSpeechSessionRef.current = null;
    if (!session) {
      return;
    }
    try {
      session.stop();
    } catch {
      // no-op
    }
  }, []);

  useEffect(() => {
    companionSpeechConfigRef.current = companionSpeechConfig;
  }, [companionSpeechConfig]);

  const ensureDictationModelReady = useCallback(async () => {
    const targetModelId = dictationConfig.model || DEFAULT_DICTATION_CONFIG.model;
    let status = await dictationModelStatus(targetModelId);
    if (status.state === 'ready') {
      return;
    }
    await dictationDownloadModel(targetModelId);

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 1000);
      });
      status = await dictationModelStatus(targetModelId);
      if (status.state === 'ready') {
        return;
      }
      if (status.state === 'error') {
        throw new Error(status.error || 'Dictation model download failed.');
      }
    }
    throw new Error('Dictation model download timed out.');
  }, [dictationConfig.model]);

  const startDictation = useCallback(async () => {
    if (!dictationVisible || !dictationConfig.enabled) {
      return;
    }
    if (dictationState === 'processing' || dictationWorking || dictationState === 'listening') {
      return;
    }
    setDictationWorking(true);
    try {
      await ensureDictationModelReady();
      const preferredLanguage = dictationConfig.language
        || (typeof navigator === 'undefined' ? undefined : navigator.language.split('-')[0]);
      await dictationStart(preferredLanguage || undefined);
    } catch (error) {
      setDictationWorking(false);
      setTimedStatus(`${tr('语音不可用：', 'Voice input unavailable: ')}${String(error)}`);
    }
  }, [
    dictationConfig.enabled,
    dictationConfig.language,
    dictationState,
    dictationVisible,
    dictationWorking,
    ensureDictationModelReady,
    setTimedStatus,
  ]);

  const stopDictation = useCallback(async () => {
    if (dictationState !== 'listening') {
      return;
    }
    setDictationWorking(true);
    try {
      await dictationStop();
    } catch (error) {
      setDictationWorking(false);
      setTimedStatus(`${tr('语音停止失败：', 'Failed to stop voice input: ')}${String(error)}`);
    }
  }, [dictationState, setTimedStatus]);

  const toggleDictation = useCallback(() => {
    if (dictationState === 'listening') {
      void stopDictation();
      return;
    }
    void startDictation();
  }, [dictationState, startDictation, stopDictation]);

  const appendImageAttachments = useCallback((files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      setTimedStatus(tr('仅支持图片附件', 'Only image attachments are supported'));
      return;
    }

    for (const file of imageFiles) {
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        const dataUrl = String(reader.result ?? '');
        if (!dataUrl) {
          return;
        }
        setAttachments((prev) => [...prev, {
          id: createAttachmentId(),
          dataUrl,
          mimeType: file.type || 'image/png',
        }]);
      });
      reader.readAsDataURL(file);
    }
  }, [setTimedStatus]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items || items.length === 0) {
      return;
    }

    const imageItems: DataTransferItem[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        imageItems.push(item);
      }
    }

    if (imageItems.length === 0) {
      return;
    }

    event.preventDefault();
    const files = imageItems
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    appendImageAttachments(files);
  }, [appendImageAttachments]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleChatSubmit = useCallback(async (options?: { closeAfterSuccess?: boolean }) => {
    const text = chatInputText.trim();
    const messageAttachments = attachments;
    if ((!text && messageAttachments.length === 0) || isSending) {
      return;
    }
    const closeAfterSuccess = Boolean(options?.closeAfterSuccess);

    setTimedStatus(tr('正在启动聊天通道...', 'Starting chat channel...'));
    setIsSending(true);
    const previousText = text;
    const previousAttachments = [...messageAttachments];
    setChatInputText('');
    setAttachments([]);

    await ensureChatRuntimeStarted();
    const runtimeState = useChatStore.getState();
    if (!runtimeState.bootstrap?.canChat) {
      setIsSending(false);
      setTimedStatus(tr('发送失败：聊天能力未就绪', 'Send failed: chat capability is not ready'));
      setChatInputText(previousText);
      return;
    }
    if (!runtimeState.connected) {
      setIsSending(false);
      setTimedStatus(tr('发送失败：聊天服务未连接', 'Send failed: chat service is not connected'));
      setChatInputText(previousText);
      setAttachments(previousAttachments);
      return;
    }

    const sent = await sendChatMessage({
      text,
      attachments: previousAttachments,
    });
    setIsSending(false);

    if (!sent) {
      setChatInputText(previousText);
      setAttachments(previousAttachments);
      const nextState = useChatStore.getState();
      if (nextState.error) {
        setTimedStatus(`${tr('发送失败：', 'Send failed: ')}${nextState.error}`);
      } else {
        setTimedStatus(tr('发送失败：服务暂时不可用', 'Send failed: service is temporarily unavailable'));
      }
      return;
    }

    const sentPreview = previousText.trim()
      ? previousText.trim()
      : (previousAttachments.length > 0
        ? tr('（图片已发送）', '(Image sent)')
        : '');
    if (sentPreview) {
      setTimedStatus(makeReplyPreview(sentPreview, 140, ''), SEND_PREVIEW_VISIBLE_MS);
    } else {
      setTimedStatus(null);
    }
    if (closeAfterSuccess) {
      if (closeAfterSuccessTimerRef.current) {
        window.clearTimeout(closeAfterSuccessTimerRef.current);
        closeAfterSuccessTimerRef.current = null;
      }
      closeAfterSuccessTimerRef.current = window.setTimeout(() => {
        closeAfterSuccessTimerRef.current = null;
        closeChatInputPanel({ preserveStatus: true });
      }, CLOSE_INPUT_AFTER_SUCCESS_DELAY_MS);
      return;
    }
    focusChatInput();
  }, [attachments, chatInputText, closeChatInputPanel, focusChatInput, isSending, setTimedStatus]);

  const handleChatSubmitForm = useCallback((event: FormEvent) => {
    event.preventDefault();
    void handleChatSubmit({ closeAfterSuccess: true });
  }, [handleChatSubmit]);

  const handleChatSubmitKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter') {
      return;
    }
    if (event.shiftKey) {
      return;
    }
    event.preventDefault();
    void handleChatSubmit({ closeAfterSuccess: true });
  }, [handleChatSubmit]);

  useEffect(() => {
    let disposed = false;

    const bootstrapFloatingChat = async () => {
      await ensureChatRuntimeStarted();
      if (disposed) {
        return;
      }
      await setActiveChatSessionKey('main');
    };

    void bootstrapFloatingChat();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      stopCompanionAutoSpeech();
    };
  }, [stopCompanionAutoSpeech]);

  useEffect(() => {
    let disposed = false;

    const loadDictationCapability = async () => {
      try {
        const settings = await tauriInvoke<SettingsView>('get_settings');
        const config = normalizeDictationConfig(settings);
        const speechConfig = normalizeCompanionSpeechConfig(settings);
        if (disposed) {
          return;
        }
        setDictationConfig(config);
        setCompanionSpeechConfig(speechConfig);
        if (!config.enabled) {
          setDictationVisible(false);
          return;
        }
        try {
          await dictationModelStatus(config.model || DEFAULT_DICTATION_CONFIG.model);
          if (!disposed) {
            setDictationVisible(true);
          }
        } catch {
          if (!disposed) {
            setDictationVisible(false);
          }
        }
      } catch {
        if (!disposed) {
          setDictationVisible(false);
        }
      }
    };

    void loadDictationCapability();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!dictationVisible) {
      return;
    }
    let alive = true;
    let unlisten: (() => void) | null = null;

    const bind = async () => {
      try {
        const off = await listenDictationEvents((event) => {
          if (event.type === 'state') {
            setDictationState(event.state);
            if (event.state === 'idle') {
              setDictationWorking(false);
            }
            return;
          }
          if (event.type === 'transcript') {
            const text = event.text.trim();
            if (!text) {
              return;
            }
            setShowChatInput(true);
            setChatInputText((previous) => {
              const textarea = chatInputRef.current;
              if (!textarea) {
                return previous ? `${previous} ${text}` : text;
              }
              const start = textarea.selectionStart ?? previous.length;
              const end = textarea.selectionEnd ?? start;
              const { nextText, nextCursor } = computeDictationInsertion(previous, text, start, end);
              window.requestAnimationFrame(() => {
                if (!chatInputRef.current) return;
                chatInputRef.current.focus();
                chatInputRef.current.setSelectionRange(nextCursor, nextCursor);
              });
              return nextText;
            });
            return;
          }
          if (event.type === 'error' || event.type === 'canceled') {
            setDictationWorking(false);
            setTimedStatus(`${tr('语音错误：', 'Voice error: ')}${event.message}`);
          }
        });

        if (!alive) {
          void off();
          return;
        }
        unlisten = off;
      } catch {
        setDictationVisible(false);
      }
    };

    void bind();
    return () => {
      alive = false;
      if (unlisten) {
        void unlisten();
      }
    };
  }, [dictationVisible, setTimedStatus]);

  useEffect(() => {
    if (!dictationVisible) {
      return;
    }
    const normalizedHoldKey = dictationConfig.holdKey;
    if (normalizedHoldKey === 'off') {
      return;
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!matchesHoldKey(event, normalizedHoldKey) || event.repeat) {
        return;
      }
      if (!dictationConfig.enabled || dictationState !== 'idle' || dictationWorking) {
        return;
      }
      holdDictationActive.current = true;
      holdDictationStopPending.current = false;
      void startDictation();
    };

    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (!matchesHoldKey(event, normalizedHoldKey)) {
        return;
      }
      if (!holdDictationActive.current) {
        return;
      }
      holdDictationActive.current = false;
      holdDictationStopPending.current = true;
      if (dictationState === 'listening') {
        holdDictationStopPending.current = false;
        void stopDictation();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    dictationConfig.enabled,
    dictationConfig.holdKey,
    dictationState,
    dictationVisible,
    dictationWorking,
    startDictation,
    stopDictation,
  ]);

  useEffect(() => {
    if (!holdDictationStopPending.current) {
      return;
    }
    if (dictationState !== 'listening') {
      return;
    }
    holdDictationStopPending.current = false;
    void stopDictation();
  }, [dictationState, stopDictation]);

  useEffect(() => {
    const nextFingerprint = buildAssistantReplyFingerprint(
      latestAssistantMessage
        ? {
            text: latestAssistantMessage.text,
            timestamp: latestAssistantMessage.timestamp,
          }
        : null,
    );

    if (!nextFingerprint) {
      return;
    }

    if (lastAssistantReplyFingerprintRef.current === null) {
      lastAssistantReplyFingerprintRef.current = nextFingerprint;
      return;
    }

    if (lastAssistantReplyFingerprintRef.current === nextFingerprint) {
      return;
    }

    lastAssistantReplyFingerprintRef.current = nextFingerprint;
    assistantReplyQueueRef.current.push({
      text: latestAssistantMessage?.text ?? '',
      timestamp: latestAssistantMessage?.timestamp ?? Date.now(),
    });
    void drainAssistantReplyQueue();
  }, [drainAssistantReplyQueue, latestAssistantMessage]);

  useEffect(() => {
    return () => {
      if (sendStatusTimerRef.current) {
        window.clearTimeout(sendStatusTimerRef.current);
        sendStatusTimerRef.current = null;
      }
      if (closeAfterSuccessTimerRef.current) {
        window.clearTimeout(closeAfterSuccessTimerRef.current);
        closeAfterSuccessTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      assistantReplyEpochRef.current += 1;
      assistantReplyQueueRef.current = [];
      assistantReplyProcessingRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!showChatInput) {
      return;
    }

    const handlePointerDownOutside = (event: PointerEvent) => {
      const target = event.target;
      const panel = chatInputPanelRef.current;
      if (!panel || !(target instanceof Node)) {
        return;
      }
      if (panel.contains(target)) {
        return;
      }
      if (target instanceof Element && (target.closest('button') || target.closest('[role="button"]'))) {
        return;
      }
      closeChatInputPanel();
    };

    document.addEventListener('pointerdown', handlePointerDownOutside);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside);
    };
  }, [closeChatInputPanel, showChatInput]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const originalHtmlBackground = html.style.backgroundColor;
    const originalBodyBackground = body.style.backgroundColor;
    const originalBodyMargin = body.style.margin;
    const originalBodyHeight = body.style.height;
    const originalBodyWidth = body.style.width;
    const originalBodyOverflow = body.style.overflow;
    const originalBodyMinHeight = body.style.minHeight;
    const originalRootBackground = root?.style.backgroundColor ?? '';

    html.style.backgroundColor = FLOATING_BACKGROUND;
    body.style.backgroundColor = FLOATING_BACKGROUND;
    body.style.margin = '0';
    body.style.width = '100vw';
    body.style.height = '100vh';
    body.style.overflow = 'hidden';
    body.style.minHeight = '100vh';
    if (root) {
      root.style.backgroundColor = FLOATING_BACKGROUND;
    }

    body.style.pointerEvents = 'auto';

    return () => {
      html.style.backgroundColor = originalHtmlBackground;
      body.style.backgroundColor = originalBodyBackground;
      body.style.margin = originalBodyMargin;
      body.style.width = originalBodyWidth;
      body.style.height = originalBodyHeight;
      body.style.overflow = originalBodyOverflow;
      body.style.minHeight = originalBodyMinHeight;
      if (root) {
        root.style.backgroundColor = originalRootBackground;
      }
      body.style.pointerEvents = '';
    };
  }, [closeCurrentWindow]);
  const closeInFlightRef = useRef(false);

  const handleExit = useCallback(async () => {
    if (closeInFlightRef.current) {
      return;
    }
    closeInFlightRef.current = true;

    try {
      await tauriInvoke('close_companion_floating_window');
      await closeCurrentWindow();
    } catch {
      // Backend invocation may fail in some packaging modes; fallback below.
      await closeCurrentWindow();
    } finally {
      closeInFlightRef.current = false;
    }
  }, [closeCurrentWindow]);

  const handleClosePress = useCallback((event: MouseEvent<HTMLButtonElement> | ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setShowCloseConfirm(true);
  }, []);

  useEffect(() => {
    const closeBtn = closeButtonRef.current;
    if (!closeBtn) {
      return;
    }

    const handleCloseNative = (event: Event) => {
      event.stopPropagation();
      setShowCloseConfirm(true);
    };

    closeBtn.addEventListener('click', handleCloseNative);
    closeBtn.addEventListener('pointerdown', handleCloseNative);

    return () => {
      closeBtn.removeEventListener('click', handleCloseNative);
      closeBtn.removeEventListener('pointerdown', handleCloseNative);
    };
  }, []);

  const cancelCloseConfirm = useCallback(() => {
    setShowCloseConfirm(false);
  }, []);

  const confirmClose = useCallback(() => {
    setShowCloseConfirm(false);
    void handleExit();
  }, [handleExit]);

  const handleStartDrag = useCallback(async () => {
    try {
      const currentWindow = getCurrentWindow();
      await currentWindow.startDragging();
    } catch {
      // noop
    }
  }, []);

  const regionDragStyle: CSSProperties & { WebkitAppRegion?: string } = {
    backgroundColor: FLOATING_BACKGROUND,
    boxShadow: isHovered ? 'inset 0 0 0 4px rgba(255,255,255,0.95)' : 'none',
    transition: 'box-shadow 120ms ease',
    WebkitAppRegion: 'no-drag',
  };

  const regionNoDragStyle: CSSProperties & { WebkitAppRegion?: string } = {
    WebkitAppRegion: 'no-drag',
  };

  return (
    <div
      className="relative fixed inset-0 h-[100dvh] w-[100dvw] min-h-0 min-w-0 overflow-hidden"
      style={regionDragStyle}
      onMouseEnter={() => {
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
      }}
    >
      <CompanionLive2dViewer
        activeModelId={activeModelId}
        companionMode={companionMode}
        initialModelPath={activeModelPath}
        standaloneWindow
      />
      <div
        className="pointer-events-auto flex w-max flex-col items-center gap-2 rounded-xl border border-white/25 bg-black/25 px-2 py-2 text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md"
        style={{
          position: 'absolute',
          right: '8px',
          top: '8px',
          zIndex: 2147483646,
          pointerEvents: 'auto',
          ...regionNoDragStyle,
        }}
      >
        <button
          type="button"
          onMouseDown={handleStartDrag}
          className="rounded-md border border-white/30 bg-black/40 p-2 hover:bg-white/25"
          title={tr('拖动窗口', 'Move window')}
          style={regionNoDragStyle}
        >
          <Move className="size-4" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void navigateToMainSession();
          }}
          className="rounded-md border border-white/30 bg-black/40 p-2 text-white hover:bg-white/25"
          title={tr('跳回主会话', 'Back to main session')}
          style={regionNoDragStyle}
        >
          <Home className="size-4" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handleOpenChatInput();
          }}
          className="relative rounded-md border border-white/30 bg-black/40 p-2 text-white hover:bg-white/25"
          title={tr('发送消息', 'Send message')}
          style={regionNoDragStyle}
        >
          <Send className="size-4" />
          {unreadAssistantReplyCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
          ) : null}
        </button>
        {dictationVisible ? (
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleDictation();
            }}
            className={`rounded-md border border-white/30 bg-black/40 p-2 text-white hover:bg-white/25 ${
              dictationWorking || dictationState === 'processing' ? 'opacity-80' : ''
            }`}
            title={dictationState === 'listening' ? tr('停止语音输入', 'Stop voice input') : tr('开始语音输入', 'Start voice input')}
            style={regionNoDragStyle}
          >
            {dictationWorking || dictationState === 'processing' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : dictationState === 'listening' ? (
              <Square className="size-4 fill-current text-red-400" />
            ) : (
              <Mic className="size-4" />
            )}
          </button>
        ) : null}
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void navigateToCompanionPanel();
          }}
          className="relative rounded-md border border-white/30 bg-black/40 p-2 text-white hover:bg-white/25"
          title={tr('桌面伴侣面板', 'Desktop companion panel')}
          style={regionNoDragStyle}
        >
          <Settings className="size-4" />
        </button>
        <button
          type="button"
          ref={closeButtonRef}
          onClick={handleClosePress}
          onPointerDown={handleClosePress}
          style={{ ...regionNoDragStyle, zIndex: 999999, pointerEvents: 'auto' }}
          className="rounded-md border border-white/30 bg-black/40 p-2 hover:bg-white/25"
          title={tr('关闭桌面娘', 'Close desktop companion')}
        >
          <X className="size-4" />
        </button>
      </div>
      <div
        className={`pointer-events-auto absolute right-14 top-2 z-[2147483647] w-64 rounded-lg border border-emerald-300/55 bg-emerald-950/90 p-3 text-left text-emerald-50 shadow-lg shadow-emerald-950/70 transition-all duration-300 hover:bg-emerald-900/95 ${
          showAssistantReplyBubble ? 'pointer-events-auto translate-y-0 scale-100 opacity-100' : 'pointer-events-none translate-y-1 scale-95 opacity-0'
        }`}
        style={regionNoDragStyle}
      >
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-emerald-200/90">
          <span>{`${tr('新回复', 'New reply')} ${formatReplyTimeLabel(activeReplyTimestamp)}`}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onMouseDown={(event: MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
                event.stopPropagation();
                toggleReplyBubbleExpanded();
              }}
              className="rounded px-1.5 py-0.5 text-[10px] text-emerald-100/90 hover:bg-emerald-400/15"
            >
              {isReplyBubbleExpanded ? tr('收起', 'Collapse') : tr('展开', 'Expand')}
            </button>
            <button
              type="button"
              onMouseDown={(event: MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
                event.stopPropagation();
                void navigateToMainSession();
              }}
              className="rounded px-1.5 py-0.5 text-[10px] text-emerald-100/90 hover:bg-emerald-400/15"
            >
              {tr('主窗', 'Main')}
            </button>
          </div>
        </div>
        <div className={`${isReplyBubbleExpanded ? 'max-h-40 overflow-y-auto whitespace-pre-wrap' : 'h-10 overflow-hidden'} text-xs leading-snug text-emerald-50`}>
          {assistantReplyPreview}
        </div>
      </div>
      {showChatInput ? (
        <div
          ref={chatInputPanelRef}
          className="pointer-events-auto absolute inset-x-4 bottom-4 z-[2147483646] flex flex-col gap-2"
          style={regionNoDragStyle}
        >
          <form
            onSubmit={handleChatSubmitForm}
            className="rounded-lg bg-black/60 px-3 py-2"
          >
            <div className="flex w-full items-end gap-2">
              <textarea
                ref={chatInputRef}
                value={chatInputText}
                onChange={handleChatInputChange}
                onPaste={handlePaste}
                onKeyDown={handleChatSubmitKeyDown}
                rows={1}
                placeholder={tr('发送到聊天主窗', 'Send to main chat window')}
                className="min-h-[36px] max-h-28 flex-1 resize-none rounded-md bg-black/30 px-3 py-2 text-sm text-white outline-none"
              />
              <button
                type="submit"
                className="rounded-md border border-white/30 bg-white/15 px-3 py-2 text-xs text-white hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isSending || (!chatInputText.trim() && attachments.length === 0)}
                onMouseDown={(event) => {
                  event.stopPropagation();
                }}
              >
                {isSending ? tr('发送中...', 'Sending...') : tr('发送', 'Send')}
              </button>
            </div>
            <div className="mt-1 px-1 text-[10px] leading-tight text-white/70">
              {tr('Enter 发送，Shift + Enter 换行', 'Enter to send, Shift + Enter for new line')}
            </div>
          </form>
        </div>
      ) : null}
      {chatSendStatus ? (
        <div className="pointer-events-none absolute bottom-20 left-4 right-4 z-[2147483646] rounded-md bg-black/35 px-3 py-2 text-[11px] text-white/80">
          {chatSendStatus}
        </div>
      ) : null}
      {attachments.length > 0 ? (
        <div className="absolute bottom-24 left-4 right-4 z-[2147483646] flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="relative">
              <img
                src={attachment.dataUrl}
                alt="attachment"
                className="h-16 w-20 rounded-md border border-white/20 object-cover"
              />
              <button
                type="button"
                onMouseDown={(event) => {
                  event.stopPropagation();
                  handleRemoveAttachment(attachment.id);
                }}
                className="pointer-events-auto absolute -right-1 -top-1 rounded-full border border-white/60 bg-black px-1.5 text-xs text-white"
              >
                ×
              </button>
              <span className="sr-only">{tr('移除图片', 'Remove image')}</span>
            </div>
          ))}
        </div>
      ) : null}
      {showCloseConfirm ? (
        <div
          className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/65 p-4"
          onMouseDown={() => {
            setShowCloseConfirm(false);
          }}
        >
          <div
            className="w-full max-w-sm rounded-md border border-white/20 bg-black/80 p-4 text-white shadow-xl"
            onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
              event.stopPropagation();
            }}
          >
            <div className="text-sm font-medium">{tr('确认关闭桌面娘？', 'Close desktop companion?')}</div>
            <div className="mt-1 text-xs text-white/80">{tr('关闭后窗口将退出，是否继续？', 'The floating window will be closed. Continue?')}</div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-white/30 px-3 py-1 text-xs text-white hover:bg-white/10"
                onClick={cancelCloseConfirm}
              >
                {tr('取消', 'Cancel')}
              </button>
              <button
                type="button"
                className="rounded border border-red-300 px-3 py-1 text-xs text-red-200 hover:bg-red-500/30"
                onClick={confirmClose}
              >
                {tr('确认关闭', 'Confirm close')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
