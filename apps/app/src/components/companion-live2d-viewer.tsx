import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Application, ENV, settings as pixiSettings, Ticker, type DisplayObject } from 'pixi.js';
import { Cubism4ModelSettings, type Cubism4InternalModel, Live2DModel } from 'pixi-live2d-display';
import { convertFileSrc } from '@tauri-apps/api/core';
import JSON5 from 'json5';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/components/card';
import { tauriInvoke } from '@/lib/tauri';
import { openCompanionFloatingWindow } from '@/lib/companion-floating-window';
import { useLocale } from '@/lib/locale-context';

type CompanionMode = 'idle' | 'thinking' | 'speaking';

type CompanionLive2dViewerProps = {
  activeModelId: string | null;
  companionMode?: CompanionMode;
  mouthOpen?: number | null;
  standaloneWindow?: boolean;
  initialModelPath?: string | null;
  showOpenFloatingButton?: boolean;
  onOpenFloatingWindow?: () => Promise<void> | void;
  onModelReady?: () => void;
};

type Live2DModelInstance = {
  destroy: () => void;
  motion?: (group: string, index?: number, priority?: number) => Promise<boolean> | boolean;
  expression?: (index: number) => Promise<boolean> | boolean;
  setParameterValueById?: (id: string, value: number) => void;
  internalModel?: Cubism4InternalModel & {
    focus?: (x: number, y: number) => void;
    coreModel?: {
      setParameterValueById?: (id: string, value: number) => void;
    };
    focusController?: {
      setTarget?: (x: number, y: number) => void;
      focus?: (x: number, y: number) => void;
    };
  };
  focus?: (x: number, y: number) => void;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  scale: { set: (x: number, y?: number) => void };
  anchor?: { set: (x: number, y?: number) => void };
};

type WindowWithLive2D = Window & {
  Live2DCubismCore?: unknown;
};

const CUBISM_CORE_SCRIPT_ID = 'companion-live2d-cubism-core';
const CUBISM_CORE_LOCAL_URL = '/live2dcubismcore.min.js';
const CUBISM_CORE_CDN_URL = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';
const STATIC_MODEL_ID = '__builtin_static_model__';
const STATIC_MODEL_PATH = '/live2d-models/standard/cat.model3.json';
const CUBISM_PARAM_MOUTH_OPEN_Y = 'ParamMouthOpenY';
const COMPANION_FLOATING_WINDOW_URL_FLAG = 'floatingWindow';
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.12;
const AUTO_RETRY_MAX_ATTEMPTS = 3;
const AUTO_RETRY_BASE_DELAY_MS = 250;
const FULL_RELOAD_MARK_KEY = 'companion-live2d-full-reload';
const FULL_RELOAD_KEY_PREFIX = `${FULL_RELOAD_MARK_KEY}-v1`;
const FULL_RELOAD_COOLDOWN_MS = 60_000;
const MODEL_FIT_SCALE = 1.0;
const FLOATING_WINDOW_BACKGROUND = 'transparent';
const MAX_CANVAS_DIMENSION_FALLBACK = 1;
const DEBUG_MOUSE_TRACK_INTERVAL_MS = 80;
const FLOATING_MOUSE_TRACK_INTERVAL_MS = 24;
const ENABLE_FLOATING_MOUSE_FEED = true;
const MODEL_REVEAL_MIN_LOADING_MS = 300;
const MODEL_REVEAL_MAX_LOADING_MS = 1200;

type Cubism4ModelSettingsInput = ConstructorParameters<typeof Cubism4ModelSettings>[0];

type ModelTransformState = {
  baseX: number;
  baseY: number;
  baseScale: number;
  modelWidth: number;
  modelHeight: number;
};

type InteractionState = {
  isDragging: boolean;
  lastX: number;
  lastY: number;
  panX: number;
  panY: number;
  zoom: number;
};

const MOTION_GROUPS: Record<CompanionMode, string[]> = {
  speaking: ['speaking', 'talk', 'talking', 'tap_head'],
  thinking: ['thinking', 'idle', 'thinking02'],
  idle: ['idle', 'stand', 'default'],
};

let cubismCorePromise: Promise<void> | null = null;
Live2DModel.registerTicker(Ticker);

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'unknown';
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').trim();
}

function isLikelyShaderLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('checkMaxIfStatementsInShader') || error.message.includes('Invalid value of `0`');
  }
  if (typeof error === 'string') {
    return error.includes('checkMaxIfStatementsInShader') || error.includes('Invalid value of `0`');
  }
  return false;
}


function isFloatingWindowQueryEnabled(rawSearch: string | null | undefined): boolean {
  if (!rawSearch) {
    return false;
  }
  const params = new URLSearchParams(rawSearch.startsWith('?') ? rawSearch.slice(1) : rawSearch);
  const flag = params.get(COMPANION_FLOATING_WINDOW_URL_FLAG)?.trim() ?? '';
  return flag === '1' || flag.toLowerCase() === 'true';
}

function detectFloatingWindowFromRuntime(): boolean {
  const path = window.location.pathname;
  const hash = window.location.hash;
  const search = window.location.search;

  if (path.includes('/companion/floating')) {
    return true;
  }
  if (hash.includes('/companion/floating')) {
    return true;
  }
  if (isFloatingWindowQueryEnabled(search)) {
    return true;
  }
  const hashQueryStart = hash.indexOf('?');
  if (hashQueryStart >= 0 && isFloatingWindowQueryEnabled(hash.slice(hashQueryStart + 1))) {
    return true;
  }

  try {
    const currentWindow = getCurrentWindow();
    if (currentWindow?.label === 'companion-floating') {
      return true;
    }
  } catch {
    // best effort
  }

  return false;
}

function detectFloatingWindowState(standaloneWindow: boolean): boolean {
  return standaloneWindow || detectFloatingWindowFromRuntime();
}

type FullReloadMark = {
  modelId: string;
  modelPath: string;
  reason: string;
  timestamp: number;
};

function getFullReloadMarkKey(modelId: string, modelPath: string): string {
  return `${FULL_RELOAD_KEY_PREFIX}__${modelId}__${modelPath}`;
}

function shouldReloadWholeWindowForShaderError(modelId: string, modelPath: string, error: unknown): boolean {
  if (typeof sessionStorage === 'undefined') {
    return false;
  }

  const normalizedPath = normalizePath(modelPath);
  const key = getFullReloadMarkKey(modelId, normalizedPath);

  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as FullReloadMark;
        if (typeof parsed.timestamp === 'number' && Date.now() - parsed.timestamp < FULL_RELOAD_COOLDOWN_MS) {
          return false;
        }
      } catch {
        sessionStorage.removeItem(key);
      }
    }

    sessionStorage.setItem(
      key,
      JSON.stringify({
        modelId,
        modelPath: normalizedPath,
        reason: describeError(error),
        timestamp: Date.now(),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

function clearFullReloadMark(modelId: string, modelPath: string): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }

  try {
    sessionStorage.removeItem(getFullReloadMarkKey(modelId, normalizePath(modelPath)));
  } catch {
    // best effort cleanup
  }
}

function getCanvasRenderSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const parent = canvas.parentElement as HTMLElement | null;
  const parentRect = parent?.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const fallbackWidth = Number(parentRect?.width) || Number(canvasRect.width) || 0;
  const fallbackHeight = Number(parentRect?.height) || Number(canvasRect.height) || 0;
  return {
    width: Math.max(MAX_CANVAS_DIMENSION_FALLBACK, Math.floor(canvas.clientWidth || fallbackWidth)),
    height: Math.max(MAX_CANVAS_DIMENSION_FALLBACK, Math.floor(canvas.clientHeight || fallbackHeight)),
  };
}

function createPixiApplication(canvas: HTMLCanvasElement, forceCanvas: boolean): Application {
  const { width, height } = getCanvasRenderSize(canvas);
  pixiSettings.PREFER_ENV = ENV.WEBGL_LEGACY;
  return new Application({
    view: canvas,
    autoDensity: true,
    backgroundAlpha: 0,
    width,
    height,
    resolution: window.devicePixelRatio,
    forceCanvas,
  });
}

function isLocalFsPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return (
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.startsWith('/Users/') ||
    normalized.startsWith('/private/') ||
    normalized.startsWith('/home/') ||
    normalized.startsWith('/var/') ||
    normalized.startsWith('/tmp/')
  );
}

function parentDir(filePath: string): string {
  const normalized = normalizePath(filePath).replace(/\/$/, '');
  const index = normalized.lastIndexOf('/');
  if (index <= 0) {
    return '/';
  }
  return normalized.slice(0, index);
}

function joinPath(base: string, relative: string): string {
  const left = normalizePath(base);
  const right = normalizePath(relative);
  if (!left) {
    return right;
  }
  if (right.startsWith('/')) {
    return right;
  }
  return `${left}/${right}`;
}

function toModelUrl(filePath: string): string {
  const normalized = normalizePath(filePath);

  if (normalized.startsWith('asset://') || normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('blob:')) {
    return normalized;
  }

  if (isLocalFsPath(normalized)) {
    return convertFileSrc(normalized);
  }

  if (normalized.startsWith('/')) {
    return normalized;
  }

  return new URL(normalized, window.location.origin).toString();
}

function resolveModelAssetUrl(modelUrl: string, modelDir: string, fileName: string): string {
  if (isLocalFsPath(modelUrl) || isLocalFsPath(modelDir)) {
    return convertFileSrc(joinPath(modelDir, fileName));
  }

  if (modelUrl.startsWith('http://') || modelUrl.startsWith('https://') || modelUrl.startsWith('asset://') || modelUrl.startsWith('blob:')) {
    return new URL(fileName, modelUrl).toString();
  }

  if (modelUrl.startsWith('/')) {
    const base = new URL(modelUrl, window.location.origin).toString();
    return new URL(fileName, base).toString();
  }

  return new URL(fileName, new URL(modelUrl, window.location.origin).toString()).toString();
}

function createLoadError(
  selectedModelId: string | null,
  filePath: string,
  requestModelUrl: string,
  details: string,
  labels: {
    previewFailed: string;
    modelId: string;
    resolvedModelId: string;
    path: string;
    url: string;
    unknown: string;
  },
) {
  return (
    <span>
      <span className="block">{labels.previewFailed}</span>
      <span className="block">{labels.modelId}: {selectedModelId ?? labels.unknown}</span>
      <span className="block">{labels.resolvedModelId}: {selectedModelId ?? labels.unknown}</span>
      <span className="block">{labels.path}: {filePath || labels.unknown}</span>
      <span className="block">{labels.url}: {requestModelUrl || labels.unknown}</span>
      <span className="block">{details}</span>
    </span>
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampMouthOpen(raw: number): number {
  const value = clamp01(raw);
  return value < 0.02 ? 0 : value * 2;
}

function applyMouth(model: Live2DModelInstance | null, rawValue: number): void {
  if (!model) {
    return;
  }

  const value = clampMouthOpen(rawValue);
  const internalModel = model.internalModel as
    | {
        setParameterValueById?: (id: string, value: number) => void;
      }
    | undefined;

  if (model.setParameterValueById) {
    model.setParameterValueById(CUBISM_PARAM_MOUTH_OPEN_Y, value);
    return;
  }

  if (internalModel?.setParameterValueById) {
    internalModel.setParameterValueById(CUBISM_PARAM_MOUTH_OPEN_Y, value);
  }
}

function computeBaseViewportTransform(canvas: HTMLCanvasElement, app: Application, model: Live2DModelInstance): ModelTransformState {
  const renderSize = getCanvasRenderSize(canvas);
  const width = Math.max(1, renderSize.width);
  const height = Math.max(1, renderSize.height);
  try {
    app.renderer.resize(width, height);
  } catch {
    // app renderers on older pixi versions may expose resize differently
  }

  const boundsModelWidth = (() => {
    const displayModel = model as { getBounds?: () => { width?: number; height?: number } };
    if (typeof displayModel.getBounds === 'function') {
      const bounds = displayModel.getBounds();
      const boundsWidth = Number(bounds?.width);
      if (Number.isFinite(boundsWidth) && boundsWidth > 0) {
        return boundsWidth;
      }
    }
    const parsedWidth = Number(model.width);
    if (Number.isFinite(parsedWidth) && parsedWidth > 0) {
      return parsedWidth;
    }
    return 1;
  })();

  const boundsModelHeight = (() => {
    const displayModel = model as { getBounds?: () => { width?: number; height?: number } };
    if (typeof displayModel.getBounds === 'function') {
      const bounds = displayModel.getBounds();
      const boundsHeight = Number(bounds?.height);
      if (Number.isFinite(boundsHeight) && boundsHeight > 0) {
        return boundsHeight;
      }
    }
    const parsedHeight = Number(model.height);
    if (Number.isFinite(parsedHeight) && parsedHeight > 0) {
      return parsedHeight;
    }
    return 1;
  })();

  const baseScale = Math.min(width / boundsModelWidth, height / boundsModelHeight) * MODEL_FIT_SCALE;
  return {
    baseX: width / 2,
    baseY: height,
    baseScale,
    modelWidth: boundsModelWidth,
    modelHeight: boundsModelHeight,
  };
}

function computeViewportTransformFromKnownModelSize(
  canvas: HTMLCanvasElement,
  app: Application,
  modelWidth: number,
  modelHeight: number,
): ModelTransformState {
  const renderSize = getCanvasRenderSize(canvas);
  const width = Math.max(1, renderSize.width);
  const height = Math.max(1, renderSize.height);
  try {
    app.renderer.resize(width, height);
  } catch {
    // best effort
  }
  const safeModelWidth = Number.isFinite(modelWidth) && modelWidth > 0 ? modelWidth : 1;
  const safeModelHeight = Number.isFinite(modelHeight) && modelHeight > 0 ? modelHeight : 1;
  const baseScale = Math.min(width / safeModelWidth, height / safeModelHeight) * MODEL_FIT_SCALE;
  return {
    baseX: width / 2,
    baseY: height,
    baseScale,
    modelWidth: safeModelWidth,
    modelHeight: safeModelHeight,
  };
}

function applyViewportTransform(model: Live2DModelInstance, fitState: ModelTransformState, interactionState: InteractionState): void {
  const scale = fitState.baseScale * interactionState.zoom;
  model.scale.set(scale);
  const hasAnchorSetter = typeof model.anchor?.set === 'function';
  if (hasAnchorSetter) {
    model.anchor?.set(0.5, 1);
    model.x = fitState.baseX + interactionState.panX;
    model.y = fitState.baseY + interactionState.panY;
    return;
  }

  const safeWidth = Math.max(1, fitState.modelWidth * scale);
  const safeHeight = Math.max(1, fitState.modelHeight * scale);

  model.x = fitState.baseX - safeWidth / 2 + interactionState.panX;
  model.y = fitState.baseY - safeHeight + interactionState.panY;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInteractionZoom(value: number): number {
  return clamp(value, MIN_ZOOM, MAX_ZOOM);
}

async function ensureCubismRuntimeLoaded() {
  if ((window as WindowWithLive2D).Live2DCubismCore) {
    return;
  }

  if (!cubismCorePromise) {
    cubismCorePromise = (async () => {
      const sources = [CUBISM_CORE_LOCAL_URL, CUBISM_CORE_CDN_URL];
      let lastError: unknown = null;

      const loadScript = (src: string): Promise<void> =>
        new Promise((resolve, reject) => {
          if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
          }
          const script = document.createElement('script');
          script.id = CUBISM_CORE_SCRIPT_ID;
          script.src = src;
          script.type = 'text/javascript';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error(`Failed to load ${src}`));
          document.head.appendChild(script);
        });

      for (const source of sources) {
        try {
          await loadScript(source);
          if ((window as WindowWithLive2D).Live2DCubismCore) {
            return;
          }
          lastError = new Error(`runtime loaded but Live2DCubismCore not found: ${source}`);
        } catch (error) {
          lastError = error;
        }
      }

      throw new Error(`Cubism runtime unavailable: ${describeError(lastError)}`);
    })();
  }

  try {
    await cubismCorePromise;
  } catch (error) {
    cubismCorePromise = null;
    throw error;
  }
}

async function resolveActiveModelIdFromBackend(): Promise<string | null> {
  try {
    return await tauriInvoke<string | null>('companion_live2d_get_active_model');
  } catch {
    return null;
  }
}

async function resolveActiveModelPathFromBackend(): Promise<string | null> {
  return tauriInvoke<string | null>('companion_live2d_get_active_model_path');
}

async function resolveModelPathFromBackendById(modelId: string | null): Promise<string | null> {
  if (!modelId) {
    return resolveActiveModelPathFromBackend();
  }
  return tauriInvoke<string | null>('companion_live2d_get_model_path', {
    input: { modelId },
  });
}

async function buildModel(modelFilePath: string): Promise<Live2DModelInstance> {
  const normalized = normalizePath(modelFilePath);
  const modelUrl = toModelUrl(normalized);
  const response = await fetch(modelUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch model config (${response.status}) from ${modelUrl}`);
  }

  const raw = await response.text();
  const modelObject = JSON5.parse(raw) as Record<string, unknown>;
  const settings = new Cubism4ModelSettings({
    ...(modelObject as Record<string, unknown>),
    url: modelUrl,
  } as Cubism4ModelSettingsInput);

  const modelDirectory = parentDir(normalized);
  settings.replaceFiles(fileName => {
    if (isLocalFsPath(normalized)) {
      return convertFileSrc(joinPath(modelDirectory, fileName));
    }
    return resolveModelAssetUrl(modelUrl, modelDirectory, fileName);
  });

  const model = (await Live2DModel.from(settings)) as unknown as Live2DModelInstance;
  return model;
}

function findMotionsForMode(_model: Live2DModelInstance, mode: CompanionMode): string[] {
  return [...MOTION_GROUPS[mode]];
}

type WindowOriginResult = {
  x: number;
  y: number;
};

async function resolveWindowOriginInDesktop(): Promise<WindowOriginResult | null> {
  let tauriXRaw: number | null = null;
  let tauriYRaw: number | null = null;
  try {
    const position = await tauriInvoke<{ x: number; y: number; source: 'inner' | 'outer' }>('companion_live2d_get_window_origin_position');
    const x = Number(position.x);
    const y = Number(position.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      tauriXRaw = x;
      tauriYRaw = y;
    }
  } catch {
    // debug only
  }

  const dpr = Number(window.devicePixelRatio);
  const hasDpr = Number.isFinite(dpr) && dpr > 0;
  const tauriXCss = tauriXRaw !== null && hasDpr ? tauriXRaw / dpr : tauriXRaw;
  const tauriYCss = tauriYRaw !== null && hasDpr ? tauriYRaw / dpr : tauriYRaw;
  const finalX = tauriXCss;
  const finalY = tauriYCss;

  if (Number.isFinite(finalX) && Number.isFinite(finalY)) {
    return {
        x: Number(finalX),
        y: Number(finalY),
      };
  }

  return null;
}

function applyWindowLocalCursorToModel(model: Live2DModelInstance, localX: number, localY: number): void {
  if (!Number.isFinite(localX) || !Number.isFinite(localY)) {
    return;
  }

  const targetX = localX;
  const targetY = localY;

  if (typeof model.focus === 'function') {
    model.focus(targetX, targetY);
  }
}

export function CompanionLive2dViewer({
  activeModelId,
  companionMode = 'idle',
  mouthOpen,
  standaloneWindow = false,
  initialModelPath,
  showOpenFloatingButton = true,
  onOpenFloatingWindow,
  onModelReady,
}: CompanionLive2dViewerProps) {
  const { t, locale } = useLocale();
  const tr = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const loadErrorLabels = {
    previewFailed: tr('Live2D 预览失败', 'Live2D preview failed'),
    modelId: tr('模型 ID', 'Model ID'),
    resolvedModelId: tr('解析模型 ID', 'Resolved Model ID'),
    path: tr('路径', 'Path'),
    url: 'URL',
    unknown: tr('未知', 'unknown'),
  };
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<Application | null>(null);
  const modelRef = useRef<Live2DModelInstance | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const renderTokenRef = useRef(0);
  const currentModeRef = useRef<CompanionMode>('idle');
  const fitTransformRef = useRef<ModelTransformState | null>(null);
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const resizeListenerRef = useRef<(() => void) | null>(null);
  const debugMouseTimerRef = useRef<number | null>(null);
  const interactionRef = useRef<InteractionState>({
    isDragging: false,
    lastX: 0,
    lastY: 0,
    panX: 0,
    panY: 0,
    zoom: 1,
  });
  const isMountedRef = useRef(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ReactNode>('');
  const [hasActiveModel, setHasActiveModel] = useState(false);
  const [isFloatingWindow, setIsFloatingWindow] = useState(() => detectFloatingWindowState(standaloneWindow));
  const [debugSnapshot, setDebugSnapshot] = useState({
    activeModelId: '',
    hasModel: 'no',
    loading: 'no',
    hasError: 'no',
    canvas: '0x0',
    modelXY: '0,0',
    scale: '0',
    fit: 'n/a',
  });
  const isFloatingMode = isFloatingWindow || standaloneWindow;

  useEffect(() => {
    const syncFloatingWindowState = () => {
      setIsFloatingWindow(detectFloatingWindowState(standaloneWindow));
    };
    syncFloatingWindowState();
    window.addEventListener('hashchange', syncFloatingWindowState);
    window.addEventListener('popstate', syncFloatingWindowState);
    return () => {
      window.removeEventListener('hashchange', syncFloatingWindowState);
      window.removeEventListener('popstate', syncFloatingWindowState);
    };
  }, [standaloneWindow]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const canvas = canvasRef.current;
      const model = modelRef.current;
      const fit = fitTransformRef.current;
      const interaction = interactionRef.current;
      const modelScale = fit ? fit.baseScale * interaction.zoom : 0;
      const canvasWidth = canvas?.clientWidth ?? 0;
      const canvasHeight = canvas?.clientHeight ?? 0;
      const modelX = typeof model?.x === 'number' ? model.x : 0;
      const modelY = typeof model?.y === 'number' ? model.y : 0;
      setDebugSnapshot({
        activeModelId: (activeModelId ?? '').trim() || 'null',
        hasModel: model ? 'yes' : 'no',
        loading: loading ? 'yes' : 'no',
        hasError: error ? 'yes' : 'no',
        canvas: `${Math.round(canvasWidth)}x${Math.round(canvasHeight)}`,
        modelXY: `${Math.round(modelX)},${Math.round(modelY)}`,
        scale: Number.isFinite(modelScale) ? modelScale.toFixed(4) : 'nan',
        fit: fit
          ? `${Math.round(fit.baseX)},${Math.round(fit.baseY)} | ${fit.baseScale.toFixed(4)} | ${Math.round(fit.modelWidth)}x${Math.round(fit.modelHeight)}`
          : 'n/a',
      });
    }, 300);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeModelId, error, loading]);

  const disposeViewer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (resizeListenerRef.current) {
      window.removeEventListener('resize', resizeListenerRef.current);
      resizeListenerRef.current = null;
    }
    if (debugMouseTimerRef.current !== null) {
      clearInterval(debugMouseTimerRef.current);
      debugMouseTimerRef.current = null;
    }
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    interactionRef.current.isDragging = false;
    interactionRef.current.panX = 0;
    interactionRef.current.panY = 0;
    interactionRef.current.zoom = 1;
    fitTransformRef.current = null;
    if (modelRef.current) {
      try {
        modelRef.current.destroy();
      } catch {
        // best effort
      }
      modelRef.current = null;
    }
    if (appRef.current) {
      try {
        appRef.current.destroy(true);
      } catch {
        // best effort
      }
      appRef.current = null;
    }
    setHasActiveModel(false);
  }, []);

  const playMotion = useCallback(async (mode: CompanionMode) => {
    const model = modelRef.current;
    if (!model?.motion) {
      return;
    }

    for (const group of findMotionsForMode(model, mode)) {
      try {
        const ok = await model.motion(group, 0, 1);
        if (ok) {
          return;
        }
      } catch {
        // ignore unsupported motion groups
      }
    }
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const renderActiveModel = useCallback(async () => {
    const token = ++renderTokenRef.current;
    setLoading(true);
    setError('');
    setHasActiveModel(false);

    disposeViewer();
    clearRetryTimer();

    const isRequestedStaticPreview = activeModelId === STATIC_MODEL_ID;
    const hasInitialModelPath = Boolean(initialModelPath && initialModelPath.trim());
    const selectedModelId = isRequestedStaticPreview ? STATIC_MODEL_ID : activeModelId;

    const resolvedBackendModelId = !isRequestedStaticPreview && !selectedModelId && !hasInitialModelPath
      ? await resolveActiveModelIdFromBackend()
      : null;
    const finalModelId = selectedModelId || resolvedBackendModelId;
    const isStaticPreview = isRequestedStaticPreview || finalModelId === STATIC_MODEL_ID;

    const resolvedModelPath = isStaticPreview
      ? STATIC_MODEL_PATH
      : (initialModelPath && initialModelPath.trim()) || (await resolveModelPathFromBackendById(finalModelId))?.trim();

    if (!isStaticPreview && !resolvedModelPath && !finalModelId) {
      setError(t('companion.live2d.preview.noModel'));
      setLoading(false);
      onModelReady?.();
      return;
    }

    const modelPath = isStaticPreview ? STATIC_MODEL_PATH : resolvedModelPath || null;
    const requestedModelId = isStaticPreview ? STATIC_MODEL_ID : finalModelId || (hasInitialModelPath ? 'floating-path-model' : 'unknown');

    if (!modelPath) {
      const missingPathError = createLoadError(
        requestedModelId,
        modelPath ?? '',
        toModelUrl(modelPath ?? ''),
        isFloatingWindow
          ? tr('floating 模式未解析到模型路径', 'Floating mode could not resolve model path') + ` (${requestedModelId})`
          : tr('后端未返回模型路径', 'No model path available from backend'),
        loadErrorLabels,
      );
      setError(missingPathError);
      setLoading(false);
      onModelReady?.();
      return;
    }

    const requestModelId = requestedModelId;
    const requestModelUrl = toModelUrl(modelPath);

    try {
      await ensureCubismRuntimeLoaded();
      const layoutWaitStartedAt = performance.now();
      let stableViewportCount = 0;
      let lastViewportWidth = 0;
      let lastViewportHeight = 0;
      while (true) {
        if (token !== renderTokenRef.current || !isMountedRef.current) {
          return;
        }
        const viewport = viewportRef.current;
        const canvas = canvasRef.current;
        const viewportRect = viewport?.getBoundingClientRect();
        const canvasRect = canvas?.getBoundingClientRect();
        const width = Math.round(
          (viewport?.clientWidth ?? 0)
          || Number(viewportRect?.width ?? 0)
          || (canvas?.clientWidth ?? 0)
          || Number(canvasRect?.width ?? 0),
        );
        const height = Math.round(
          (viewport?.clientHeight ?? 0)
          || Number(viewportRect?.height ?? 0)
          || (canvas?.clientHeight ?? 0)
          || Number(canvasRect?.height ?? 0),
        );
        const hasUsableViewport = width >= 32 && height >= 32;
        if (hasUsableViewport && width === lastViewportWidth && height === lastViewportHeight) {
          stableViewportCount += 1;
        } else {
          stableViewportCount = hasUsableViewport ? 1 : 0;
          lastViewportWidth = width;
          lastViewportHeight = height;
        }
        const elapsed = performance.now() - layoutWaitStartedAt;
        const reachedMinWait = elapsed >= MODEL_REVEAL_MIN_LOADING_MS;
        const reachedMaxWait = elapsed >= MODEL_REVEAL_MAX_LOADING_MS;
        if ((hasUsableViewport && stableViewportCount >= 2 && reachedMinWait) || reachedMaxWait) {
          break;
        }
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }

      const canvas = canvasRef.current;
      if (!canvas || token !== renderTokenRef.current || !isMountedRef.current) {
        return;
      }

      const renderWithRenderer = async (forceCanvas: boolean): Promise<void> => {
        const app = createPixiApplication(canvas, forceCanvas);
        appRef.current = app;
        const modelLoadStartedAt = performance.now();

        try {
          const model = await buildModel(modelPath);

          if (!appRef.current || token !== renderTokenRef.current || !isMountedRef.current) {
            model.destroy();
            return;
          }

          app.stage.addChild(model as DisplayObject);
          modelRef.current = model;
          fitTransformRef.current = computeBaseViewportTransform(canvas, app, model);
          interactionRef.current = {
            ...interactionRef.current,
            panX: 0,
            panY: 0,
            zoom: 1,
          };
          applyViewportTransform(model, fitTransformRef.current, interactionRef.current);
          applyMouth(model, mouthOpen ?? 0);
          retryAttemptRef.current = 0;
          clearRetryTimer();
          setHasActiveModel(true);
          setLoading(false);
          clearFullReloadMark(requestModelId, modelPath);
          let modelReadyNotified = false;
          let stableResizeCount = 0;
          let lastViewportWidth = 0;
          let lastViewportHeight = 0;
          const notifyModelReady = () => {
            if (modelReadyNotified) {
              return;
            }
            modelReadyNotified = true;
            onModelReady?.();
          };

          const onResize = () => {
            if (!isMountedRef.current || token !== renderTokenRef.current) {
              return;
            }

            const currentApp = appRef.current;
            const currentCanvas = canvasRef.current;
            const currentModel = modelRef.current;
            const observedViewport = viewportRef.current;
            if (!currentApp || !currentCanvas || !currentModel || !observedViewport) {
              return;
            }

            const viewportRect = observedViewport.getBoundingClientRect();
            const canvasRect = currentCanvas.getBoundingClientRect();
            const viewportWidth = Math.max(
              1,
              Math.round(
                observedViewport.clientWidth
                || Number(viewportRect.width)
                || currentCanvas.clientWidth
                || Number(canvasRect.width),
              ),
            );
            const viewportHeight = Math.max(
              1,
              Math.round(
                observedViewport.clientHeight
                || Number(viewportRect.height)
                || currentCanvas.clientHeight
                || Number(canvasRect.height),
              ),
            );

            try {
              currentApp.renderer.resize(viewportWidth, viewportHeight);
            } catch {
              // best effort
            }

            if (!fitTransformRef.current) {
              return;
            }

            const fitState = computeViewportTransformFromKnownModelSize(
              currentCanvas,
              currentApp,
              fitTransformRef.current.modelWidth,
              fitTransformRef.current.modelHeight,
            );
            if (!isMountedRef.current || token !== renderTokenRef.current || appRef.current !== app || !modelRef.current) {
              return;
            }
            if (!modelRef.current || !fitTransformRef.current) {
              return;
            }
            fitTransformRef.current = fitState;
            applyViewportTransform(modelRef.current, fitState, interactionRef.current);

            if (viewportWidth === lastViewportWidth && viewportHeight === lastViewportHeight) {
              stableResizeCount += 1;
            } else {
              stableResizeCount = 1;
              lastViewportWidth = viewportWidth;
              lastViewportHeight = viewportHeight;
            }

            const elapsed = performance.now() - modelLoadStartedAt;
            const meetsMinLoadingTime = elapsed >= MODEL_REVEAL_MIN_LOADING_MS;
            const reachedMaxLoadingTime = elapsed >= MODEL_REVEAL_MAX_LOADING_MS;
            const hasStableLayout = stableResizeCount >= 2;
            const hasUsableViewport = viewportWidth >= 32 && viewportHeight >= 32;
            const shouldReveal = reachedMaxLoadingTime || (meetsMinLoadingTime && hasStableLayout && hasUsableViewport);

            if (shouldReveal && hasUsableViewport) {
              notifyModelReady();
            }
          };

          const observedElement = viewportRef.current || canvas;
          resizeObserverRef.current = new ResizeObserver(onResize);
          resizeObserverRef.current.observe(observedElement);
          window.addEventListener('resize', onResize);
          resizeListenerRef.current = onResize;
          onResize();
          window.setTimeout(onResize, 80);
          window.setTimeout(onResize, 220);
          window.setTimeout(onResize, MODEL_REVEAL_MAX_LOADING_MS);
          window.setTimeout(() => {
            if (!isMountedRef.current || token !== renderTokenRef.current || appRef.current !== app) {
              return;
            }
            notifyModelReady();
          }, MODEL_REVEAL_MAX_LOADING_MS + 40);

          void playMotion(currentModeRef.current);
        } catch (error) {
          if (appRef.current === app) {
            appRef.current = null;
          }
          try {
            app.destroy(true);
          } catch {
            // best effort cleanup
          }
          throw error;
        }
      };

      try {
        await renderWithRenderer(false);
      } catch (error) {
        if (!isLikelyShaderLimitError(error)) {
          throw error;
        }

        const canReloadWindow = shouldReloadWholeWindowForShaderError(requestModelId, modelPath, error);
        if (canReloadWindow) {
          clearRetryTimer();
          const reloadError = createLoadError(
            requestModelId,
            modelPath,
            requestModelUrl,
            `${describeError(error)} ${tr('准备重载整个视窗', 'preparing full window reload')}`,
            loadErrorLabels,
          );
          setError(reloadError);
          setLoading(true);
          retryTimerRef.current = window.setTimeout(() => {
            if (!isMountedRef.current || token !== renderTokenRef.current) {
              return;
            }
            window.location.reload();
          }, 220);
          return;
        }

        disposeViewer();
        const shouldRetry = retryAttemptRef.current < AUTO_RETRY_MAX_ATTEMPTS;
        if (shouldRetry) {
          retryAttemptRef.current += 1;
          clearRetryTimer();
          const delay = AUTO_RETRY_BASE_DELAY_MS * retryAttemptRef.current;
          const retryError = createLoadError(
            requestModelId,
            modelPath,
            requestModelUrl,
            `${describeError(error)} ${tr('将自动重试', 'auto retry')} (${retryAttemptRef.current}/${AUTO_RETRY_MAX_ATTEMPTS})`,
            loadErrorLabels,
          );
          setError(retryError);
          setLoading(true);
          retryTimerRef.current = window.setTimeout(() => {
            if (!isMountedRef.current || token !== renderTokenRef.current) {
              return;
            }
            void renderActiveModel();
          }, delay);
          return;
        }

        await renderWithRenderer(true);
      }
    } catch (err) {
      if (!isMountedRef.current || token !== renderTokenRef.current) {
        return;
      }
      setError(createLoadError(requestModelId, modelPath, requestModelUrl, describeError(err), loadErrorLabels));
      setLoading(false);
      disposeViewer();
      onModelReady?.();
    }
  }, [
    activeModelId,
    clearRetryTimer,
    disposeViewer,
    initialModelPath,
    isFloatingMode,
    locale,
    mouthOpen,
    onModelReady,
    playMotion,
    t,
    standaloneWindow,
  ]);

  const handleFullReload = useCallback(() => {
    if (!isMountedRef.current) {
      return;
    }
    retryAttemptRef.current = 0;
    clearRetryTimer();
    setError('');
    window.location.reload();
  }, [clearRetryTimer]);

  const handleRetry = useCallback(() => {
    if (!isMountedRef.current) {
      return;
    }
    clearRetryTimer();
    retryAttemptRef.current = 0;
    setError('');
    void renderActiveModel();
  }, [clearRetryTimer, renderActiveModel]);

  useEffect(() => {
    if (!isFloatingMode) {
      return undefined;
    }
    if (debugMouseTimerRef.current !== null) {
      clearInterval(debugMouseTimerRef.current);
      debugMouseTimerRef.current = null;
    }

    debugMouseTimerRef.current = window.setInterval(
      () => {
        void (async () => {
          try {
            const position = await tauriInvoke<{ x: number; y: number }>('companion_live2d_get_global_mouse_position');
            const windowOrigin = await resolveWindowOriginInDesktop();
            if (!windowOrigin) {
              return;
            }
            const windowScreenX = windowOrigin.x;
            const windowScreenY = windowOrigin.y;
            if (
              !Number.isFinite(position.x) ||
              !Number.isFinite(position.y) ||
              !Number.isFinite(windowScreenX) ||
              !Number.isFinite(windowScreenY)
            ) {
              return;
            }
            const modelInstance = modelRef.current;
            const hasModel = modelInstance !== null;
            if (hasModel && ENABLE_FLOATING_MOUSE_FEED && modelInstance !== null) {
              applyWindowLocalCursorToModel(modelInstance, position.x - windowScreenX, position.y - windowScreenY);
            }
          } catch {
          }
        })();
      },
      hasActiveModel ? FLOATING_MOUSE_TRACK_INTERVAL_MS : DEBUG_MOUSE_TRACK_INTERVAL_MS,
    );

    return () => {
      if (debugMouseTimerRef.current !== null) {
        clearInterval(debugMouseTimerRef.current);
        debugMouseTimerRef.current = null;
      }
    };
  }, [hasActiveModel, isFloatingMode]);

  const openFloatingWindowInternally = useCallback(async () => {
    if (standaloneWindow) {
      return;
    }

    try {
      const activeModelIdFromState = activeModelId?.trim();
      const backendActiveModelId = await tauriInvoke<string | null>('companion_live2d_get_active_model');
      const resolvedModelId = (activeModelIdFromState || backendActiveModelId)?.trim();
      const backendActiveModelPath = (await resolveActiveModelPathFromBackend())?.trim() ?? '';

      if (!resolvedModelId && !backendActiveModelPath) {
        setError(t('companion.live2d.preview.noModel'));
        return;
      }

      if (resolvedModelId) {
        try {
          await tauriInvoke('companion_live2d_set_active_model', { input: { modelId: resolvedModelId } });
        } catch {
          // best effort: keep invocation non-blocking if state sync is slow
        }
      }

      const resolvedModelPath = resolvedModelId
        ? ((
            await tauriInvoke<string | null>('companion_live2d_get_model_path', {
              input: { modelId: resolvedModelId },
            })
          )?.trim() ?? '')
        : backendActiveModelPath;

      const modelPathForPayload = resolvedModelPath ?? '';
      await openCompanionFloatingWindow({
        modelId: resolvedModelId,
        mode: companionMode,
        modelPath: modelPathForPayload,
      });
    } catch (error) {
      setError(`${t('companion.live2d.preview.failedToOpenFloatingWindow')}（${describeError(error)}）`);
    }
  }, [activeModelId, companionMode, standaloneWindow, t]);

  const handleOpenFloatingWindow = useCallback(async () => {
    if (onOpenFloatingWindow) {
      await onOpenFloatingWindow();
      return;
    }
    await openFloatingWindowInternally();
  }, [onOpenFloatingWindow, openFloatingWindowInternally]);

  const viewportContainerClassName = isFloatingMode
    ? 'absolute inset-0 overflow-hidden rounded-none'
    : 'relative min-h-[460px] w-full overflow-hidden rounded-lg border border-border/40 bg-black/10 touch-none lg:min-h-[540px]';

  const renderViewport = (floatingMode: boolean) => (
    <div
      ref={viewportRef}
      className={floatingMode ? 'absolute inset-0 overflow-hidden rounded-none' : 'relative h-full min-h-[460px] w-full overflow-hidden rounded-lg lg:min-h-[540px]'}
      style={
        floatingMode
          ? {
              width: '100%',
              height: '100%',
              backgroundColor: FLOATING_WINDOW_BACKGROUND,
            }
          : undefined
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
      onWheel={handleContainerWheelCapture}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />
      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{t('companion.live2d.preview.loading')}</div>
      ) : null}
      {!hasActiveModel && !loading && !error ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{t('companion.live2d.preview.noModel')}</div>
      ) : null}
      {error ? (
        <div className="absolute inset-x-2 top-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={handleFullReload}
              className="mr-2 rounded border border-destructive/30 px-2 py-1 text-xs hover:bg-destructive/20"
            >
              {tr('重载窗口', 'Reload Window')}
            </button>
            <button type="button" onClick={handleRetry} className="rounded border border-destructive/30 px-2 py-1 text-xs hover:bg-destructive/20">
              {tr('重试', 'Retry')}
            </button>
          </div>
        </div>
      ) : null}
      {floatingMode || !showOpenFloatingButton ? null : (
        <button
          type="button"
          onClick={handleOpenFloatingWindow}
          className="absolute right-2 top-2 rounded-md border border-border/40 bg-background/80 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur hover:bg-background"
        >
          {tr('独立弹窗', 'Open Floating Window')}
        </button>
      )}
    </div>
  );

  useEffect(() => {
    retryAttemptRef.current = 0;
  }, [activeModelId]);

  useEffect(() => {
    isMountedRef.current = true;
    void renderActiveModel();
    return () => {
      isMountedRef.current = false;
      renderTokenRef.current += 1;
      disposeViewer();
    };
  }, [activeModelId, renderActiveModel, disposeViewer]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model) {
      return;
    }
    applyMouth(model, mouthOpen ?? 0);
  }, [mouthOpen]);

  useEffect(() => {
    if (currentModeRef.current !== companionMode) {
      currentModeRef.current = companionMode;
      void playMotion(companionMode);
    }
  }, [companionMode, playMotion]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      const target = event.target;
      if (target instanceof Element && target.closest('button, [role="button"], a, input, textarea, select, option, label')) {
        return;
      }

      const interaction = interactionRef.current;
      if (!hasActiveModel || !modelRef.current) {
        return;
      }
      interaction.isDragging = true;
      interaction.lastX = event.clientX;
      interaction.lastY = event.clientY;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [hasActiveModel],
  );

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    const model = modelRef.current;
    const fitState = fitTransformRef.current;
    if (!model || !fitState) {
      return;
    }

    if (!interaction.isDragging) {
      return;
    }

    const deltaX = event.clientX - interaction.lastX;
    const deltaY = event.clientY - interaction.lastY;
    interaction.lastX = event.clientX;
    interaction.lastY = event.clientY;
    interaction.panX += deltaX;
    interaction.panY += deltaY;
    applyViewportTransform(model, fitState, interaction);
  }, []);

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (interactionRef.current.isDragging) {
      interactionRef.current.isDragging = false;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const model = modelRef.current;
    const fitState = fitTransformRef.current;
    if (!model || !fitState) {
      return;
    }

    event.preventDefault();

    const factor = Math.exp(-event.deltaY * ZOOM_STEP * 0.01);
    const nextZoom = clampInteractionZoom(interactionRef.current.zoom * factor);
    if (nextZoom === interactionRef.current.zoom) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;

    const oldTotalScale = fitState.baseScale * interactionRef.current.zoom;
    const newTotalScale = fitState.baseScale * nextZoom;

    const oldPanX = interactionRef.current.panX;
    const oldPanY = interactionRef.current.panY;

    const focalX = pointerX - fitState.baseX;
    const focalY = pointerY - fitState.baseY;

    interactionRef.current.panX = focalX - ((focalX - oldPanX) * newTotalScale) / oldTotalScale;
    interactionRef.current.panY = focalY - ((focalY - oldPanY) * newTotalScale) / oldTotalScale;
    interactionRef.current.zoom = nextZoom;

    applyViewportTransform(model, fitState, interactionRef.current);
  }, []);

  const handleContainerWheelCapture = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      handleWheel(event);
    },
    [handleWheel],
  );

  if (isFloatingMode) {
    return (
      <div className={viewportContainerClassName} style={{ width: '100%', height: '100%' }}>
        {renderViewport(true)}
      </div>
    );
  }

  return (
    <Card className="space-y-3 rounded-xl border border-border/40 bg-surface-elevated/55 p-0">
      <CardHeader>
        <CardTitle>{t('companion.live2d.preview.preview')}</CardTitle>
        <CardDescription>{t('companion.live2d.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={viewportContainerClassName}>{renderViewport(false)}</div>
      </CardContent>
    </Card>
  );
}
