/** Redact recognizable secrets without treating assistant text as authorization. */
const secretKey = /(?:api[-_]?key|token|password|passwd|secret|authorization|cookie|private[-_]?key)/i
export function redactText(text: string, secrets: readonly string[] = []): string {
  for (const secret of secrets) if (secret.length >= 6) text = text.replaceAll(secret, '[redacted]')
  return text.replace(/\b(?:sk-(?:proj-)?[\w-]{20,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{30,})\b/g, '[redacted]')
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/((?:api[-_]?key|token|password|passwd|secret)\s*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s"',;}]+)/gi, '$1[redacted]')
    .replace(/(\bauthorization\s*[:=]\s*["']?\s*(?:Bearer|Basic)\s+)([^\s"',;}]+)/gi, '$1[redacted]')
    .replace(/(\b(?:set-cookie|cookie)\s*["']?\s*[:=]\s*["']?)([^\r\n"']+)/gi, '$1[redacted]')
}
export function redact(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === 'string') return redactText(value, secrets)
  if (Array.isArray(value)) return value.map(item => redact(item, secrets))
  // Only a secret-named leaf string is masked whole; nested objects stay readable so the
  // reviewer still sees the action's target and scope.
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (secretKey.test(key) && typeof item === 'string') return [key, '[redacted]']
    // Logged native/PTC arguments are JSON strings. Redact their leaves before
    // serializing again, including quoted values with spaces or multiple cookies.
    if (key === 'arguments' && typeof item === 'string') {
      try {
        const parsed: unknown = JSON.parse(item)
        const masked = JSON.stringify(redact(parsed, secrets))
        return [key, masked === JSON.stringify(parsed) ? item : masked]
      } catch { return [key, redactText(item, secrets)] }
    }
    return [key, redact(item, secrets)]
  }))
  return value
}
export function focusedHistory<T extends { readonly kind: string; readonly role: string; readonly source?: unknown }>(history: readonly T[]): readonly T[] {
  const humans = [...new Set(history.filter(item => item.kind === 'user-message' && item.role === 'human-instruction').map(item => JSON.stringify(item.source)))].slice(-2)
  return history.map(item => item.role === 'human-instruction' && humans.includes(JSON.stringify(item.source)) ? { ...item, focus: 'recent-user-prompt' } : item)
}
