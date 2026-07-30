export function logDevWarn(...args) {
  if (import.meta.env.DEV) {
    console.warn(...args)
  }
}

export function logDevInfo(...args) {
  if (import.meta.env.DEV) {
    console.info(...args)
  }
}
