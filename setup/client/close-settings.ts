export interface SettingsWindowApi {
  app: { exit: (code: number) => Promise<void> }
  window: { getCurrentWindow: () => { close: () => Promise<void> } }
}

/** Preview cleanup is best effort; a stalled host must not keep Settings open. */
export async function dismissSettings(
  tauri: SettingsWindowApi | undefined,
  cleanup: () => Promise<void>,
  timeoutMs = 500,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.resolve().then(cleanup).catch(() => {}),
      new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs) }),
    ])
  } finally {
    clearTimeout(timer)
  }
  if (!tauri) return
  try { await tauri.app.exit(0) }
  catch { await tauri.window.getCurrentWindow().close() }
}
