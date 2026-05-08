export function detectNetworkIssues(lines: string[]): string[] {
  const issuePatterns = [
    /certificate verify failed/i,
    /ssl/i,
    /tls/i,
    /unable to get local issuer certificate/i,
    /max retries exceeded/i,
    /connection error/i,
    /econn/i,
    /timed out|timeout/i,
  ]

  const issues = new Set<string>()
  for (const line of lines) {
    for (const pattern of issuePatterns) {
      if (pattern.test(line)) {
        issues.add(line)
        break
      }
    }
  }

  return Array.from(issues)
}

export function selectNetworkProbeTool(tools: unknown[]): {
  name: string
  arguments: Record<string, unknown>
} | null {
  const toolList = Array.isArray(tools) ? tools : []

  for (const rawTool of toolList) {
    const tool = rawTool as {
      name?: string
      inputSchema?: {
        required?: string[]
      }
    }
    const name = tool.name ?? ''
    if (!/(wikipedia|fetch|http|web|search)/i.test(name)) {
      continue
    }

    const required = Array.isArray(tool.inputSchema?.required)
      ? tool.inputSchema.required
      : []

    if (required.length === 0) {
      return { name, arguments: {} }
    }

    if (required.includes('url')) {
      return { name, arguments: { url: 'https://example.com' } }
    }
    if (required.includes('query')) {
      return { name, arguments: { query: 'OpenAI' } }
    }
    if (required.includes('q')) {
      return { name, arguments: { q: 'OpenAI' } }
    }
  }

  return null
}
