import type Docker from 'dockerode'

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values.map((v) => v.trim()).filter(Boolean)) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }

  return result
}

export function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

export function tryParseJsonFragment(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  for (let end = text.length; end > start + 1; end -= 1) {
    const candidate = text.slice(start, end)
    const parsed = tryParseJson(candidate)
    if (parsed) return parsed
  }

  return null
}

export function tryParseSseData(text: string): Record<string, unknown> | null {
  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    const parsed = tryParseJson(payload)
    if (parsed) return parsed
  }
  return null
}

export async function getContainerHosts(
  container: Docker.Container,
  fallbackName?: string,
): Promise<string[]> {
  const info = await container.inspect().catch(() => null)
  if (!info) return fallbackName ? [fallbackName] : []

  const hosts: string[] = []

  const inspectName = typeof info.Name === 'string' ? info.Name.replace(/^\//, '') : ''
  if (inspectName) hosts.push(inspectName)
  if (fallbackName) hosts.push(fallbackName)

  const networks = info.NetworkSettings?.Networks ?? {}
  for (const net of Object.values(networks) as Array<{
    IPAddress?: string
    Aliases?: string[]
    DNSNames?: string[]
  }>) {
    if (net.IPAddress) hosts.push(net.IPAddress)
    if (Array.isArray(net.Aliases)) hosts.push(...net.Aliases)
    if (Array.isArray(net.DNSNames)) hosts.push(...net.DNSNames)
  }

  return unique(hosts)
}
