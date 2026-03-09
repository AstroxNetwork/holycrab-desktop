import { create } from 'zustand'
import type { LifecycleCompanionState, LifecycleTaskState } from '@/lib/lifecycle-bus'

type TaskMap = Record<string, LifecycleTaskState>

type LifecycleStoreState = {
  tasks: TaskMap
  companion: LifecycleCompanionState | null
  patchTask: (task: LifecycleTaskState) => void
  patchCompanion: (companion: LifecycleCompanionState | null) => void
  replaceTasks: (tasks: LifecycleTaskState[]) => void
  replaceCompanion: (companion: LifecycleCompanionState | null) => void
}

function normalizeUpdatedAtUnixMs(value: number | string | undefined | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Date.now()
  }
  return value
}

function normalizeTask(task: LifecycleTaskState): LifecycleTaskState | null {
  const key = task?.key?.trim()
  if (!key) return null
  return {
    key,
    scope: String(task.scope || '').trim(),
    status: String(task.status || '').trim().toLowerCase(),
    updatedAtUnixMs: normalizeUpdatedAtUnixMs(task.updatedAtUnixMs),
    message: task.message ?? null,
    source: task.source ?? null,
  }
}

export const useLifecycleStore = create<LifecycleStoreState>()((set) => ({
  tasks: {},
  companion: null,
  patchTask: (task) => {
    const normalized = normalizeTask(task)
    if (!normalized) return
    set((state) => ({
      tasks: {
        ...state.tasks,
        [normalized.key]: normalized,
      },
    }))
  },
  replaceTasks: (tasks) => {
    const next: TaskMap = {}
    for (const task of tasks) {
      const normalized = normalizeTask(task)
      if (!normalized) continue
      next[normalized.key] = normalized
    }
    set({ tasks: next })
  },
  patchCompanion: (companion) => {
    set((state) => {
      if (!companion) return { ...state, companion: null }
      const rawMouthOpen = companion.mouthOpen
      const mouthOpen = rawMouthOpen === null
        ? null
        : typeof rawMouthOpen === 'number' && Number.isFinite(rawMouthOpen)
          ? Math.max(0, Math.min(1, rawMouthOpen))
          : undefined
      const normalized: LifecycleCompanionState = {
        speaking: Boolean(companion.speaking),
        mouthOpen,
        updatedAtUnixMs: normalizeUpdatedAtUnixMs(companion.updatedAtUnixMs),
        source: companion.source ?? null,
      }
      return { ...state, companion: normalized }
    })
  },
  replaceCompanion: (companion) => {
    set({
      companion: companion
        ? {
          speaking: Boolean(companion.speaking),
          mouthOpen: companion.mouthOpen === null
            ? null
            : typeof companion.mouthOpen === 'number' && Number.isFinite(companion.mouthOpen)
              ? Math.max(0, Math.min(1, companion.mouthOpen))
              : undefined,
          updatedAtUnixMs: normalizeUpdatedAtUnixMs(companion.updatedAtUnixMs),
          source: companion.source ?? null,
        }
        : null,
    })
  },
}))
