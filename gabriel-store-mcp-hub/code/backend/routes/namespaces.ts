import type { FastifyInstance } from 'fastify'
import type Docker from 'dockerode'
import type { McpRecord } from '../types/mcp.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface DeployNamespacePayload {
  namespace: {
    id: string
    name: string
    description?: string
    transport: 'http' | 'stdio' | 'streamable-http'
    port: number
    enabledMcps: string[]
    disabledTools: string[]
  }
  enabledMcps: Array<{
    id: string
    name: string
    image: string
  }>
}

interface NamespaceRouteOptions {
  docker: Docker
  loadData: () => McpRecord
  saveData: (data: McpRecord) => void
  mcpLabel: string
  buildContainerOptions: (opts: any) => any
}

export function registerNamespaceRoutes(
  fastify: FastifyInstance,
  options: NamespaceRouteOptions
): void {
  const { docker, loadData, saveData, mcpLabel, buildContainerOptions } = options

  fastify.post<{ Body: DeployNamespacePayload }>(
    '/api/namespaces/deploy',
    async (req, reply) => {
      const { namespace, enabledMcps } = req.body ?? {}

      if (!namespace) {
        return reply.code(400).send({ error: 'namespace is required' })
      }

      const nameStr = String(namespace.name || '').trim()
      if (!nameStr) {
        return reply.code(400).send({ error: 'namespace name is required' })
      }

      if (!enabledMcps || enabledMcps.length === 0) {
        return reply.code(400).send({ error: 'at least one MCP must be enabled' })
      }

      const validTransports = ['http', 'stdio', 'streamable-http']
      if (!namespace.transport || !validTransports.includes(namespace.transport)) {
        return reply.code(400).send({ error: 'invalid transport type' })
      }

      try {
        // Build environment with MCP configuration
        const mcpConfig = {
          ENABLED_MCPS: enabledMcps
            .map((m) => `${m.id}:${m.name}:${m.image}`)
            .join(';'),
          DISABLED_TOOLS: namespace.disabledTools.join(','),
          NAMESPACE_ID: namespace.id,
          PORT: String(namespace.port),
        }

        // Get the MCP wrapper server script content
        // The file is copied to dist/ during build (see package.json build script)
        // __dirname is dist/routes/, so we need to go up one level
        const wrapperScript = path.join(__dirname, '../mcp-wrapper-server.js')

        if (!fs.existsSync(wrapperScript)) {
          throw new Error(
            `MCP wrapper script not found at: ${wrapperScript}\n` +
            `Make sure to run: pnpm run build (which copies the file to dist/)`
          )
        }

        const scriptContent = fs.readFileSync(wrapperScript, 'utf-8')
        const scriptBase64 = Buffer.from(scriptContent).toString('base64')

        // Create container for custom MCP
        const containerName = `mcp-custom-${namespace.id.replace(/[^a-z0-9-]/g, '-')}`

        const containerOptions = buildContainerOptions({
          name: containerName,
          image: 'node:20-alpine',
          command: ['sh', '-c', `mkdir -p /app && echo "${scriptBase64}" | base64 -d > /app/mcp-wrapper-server.js && node /app/mcp-wrapper-server.js`],
          env: {
            ...mcpConfig,
            NODE_ENV: 'production',
          },
          port: namespace.port,
          transport: namespace.transport,
          mcpLabel,
        })

        const container = await docker.createContainer(containerOptions)
        await container.start()

        const shortId = container.id.slice(0, 12)
        const data = loadData()

        // Save namespace metadata
        data[shortId] = {
          name: `${namespace.name} (custom)`,
          image: 'node:20-alpine',
          command: 'node /app/mcp-wrapper-server.js',
          env: mcpConfig,
          port: namespace.port,
          transport: namespace.transport,
          isCustomNamespace: true,
          namespaceId: namespace.id,
          enabledMcps: enabledMcps.map((m) => m.id),
        }
        saveData(data)

        return reply.code(200).send({
          id: shortId,
          name: containerName,
          image: 'node:20-alpine',
          status: 'running',
          meta: data[shortId],
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to deploy namespace'
        return reply.code(500).send({ error: message })
      }
    }
  )
}
