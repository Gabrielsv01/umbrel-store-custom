import type { McpTransport } from '../types/mcp.js'

export interface CatalogEntry {
  id: string
  name: string
  description: string
  category: string
  image: string
  transport: McpTransport
  command?: string
  port?: number
  env?: Record<string, string>
  secretKeys?: string[]
}

export const catalog: CatalogEntry[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Manage repos, issues, pull requests and code via GitHub API.',
    category: 'Developer Tools',
    image: 'ghcr.io/github/github-mcp-server',
    transport: 'stdio',
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    secretKeys: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
  },
  {
    id: 'playwright',
    name: 'Playwright',
    description: 'Control a real browser — navigate, screenshot, interact with pages.',
    category: 'Browser Automation',
    image: 'mcr.microsoft.com/playwright:v1.54.0-noble',
    transport: 'streamable-http',
    command: 'npx -y @playwright/mcp@latest --host 0.0.0.0 --port 8931',
    port: 8931,
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read and write files on the host filesystem.',
    category: 'Storage',
    image: 'mcp/filesystem:latest',
    transport: 'stdio',
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent in-memory key-value store for LLM context.',
    category: 'Storage',
    image: 'mcp/memory:latest',
    transport: 'stdio',
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: 'Fetch arbitrary HTTP URLs and return content to the LLM.',
    category: 'Web',
    image: 'mcp/fetch:latest',
    transport: 'stdio',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web and local search powered by Brave Search API.',
    category: 'Web',
    image: 'mcp/brave-search:latest',
    transport: 'stdio',
    env: { BRAVE_API_KEY: '' },
    secretKeys: ['BRAVE_API_KEY'],
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Query and inspect PostgreSQL databases.',
    category: 'Database',
    image: 'mcp/postgres:latest',
    transport: 'stdio',
    env: { DATABASE_URI: 'postgresql://user:password@host:5432/db' },
    secretKeys: ['DATABASE_URI'],
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Dynamic step-by-step reasoning tool for complex problems.',
    category: 'Reasoning',
    image: 'mcp/sequential-thinking:latest',
    transport: 'stdio',
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description: 'Headless Chrome automation — screenshot, scrape, interact.',
    category: 'Browser Automation',
    image: 'mcp/puppeteer:latest',
    transport: 'stdio',
  },
  {
    id: 'time',
    name: 'Time',
    description: 'Get current time, convert timezones, and format dates.',
    category: 'Utilities',
    image: 'mcp/time:latest',
    transport: 'stdio',
  },
]
