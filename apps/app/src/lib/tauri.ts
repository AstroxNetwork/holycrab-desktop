type InvokeArgs = Record<string, unknown> | undefined

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export async function tauriInvoke<T>(command: string, args?: InvokeArgs) {
  try {
    const core = await import('@tauri-apps/api/core')
    return await core.invoke<T>(command, args)
  } catch (error) {
    throw new Error(`Tauri invoke failed (${command}): ${errorText(error)}`)
  }
}

