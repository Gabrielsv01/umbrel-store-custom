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
          BACKEND_HOST: 'mcp-hub:3001',
        }

        // Get the appropriate MCP wrapper server script based on transport
        // The files are copied to dist/ during build (see package.json build script)
        // __dirname is dist/routes/, so we need to go up one level
        const wrapperFileName = {
          http: 'mcp-wrapper-server-http.js',
          stdio: 'mcp-wrapper-server-stdio.js',
          'streamable-http': 'mcp-wrapper-server-streamable-http.js',
        }[namespace.transport] || 'mcp-wrapper-server-http.js'

        const wrapperScript = path.join(__dirname, `../${wrapperFileName}`)

        if (!fs.existsSync(wrapperScript)) {
          throw new Error(
            `MCP wrapper script not found at: ${wrapperScript}\n` +
            `Make sure to run: pnpm run build (which copies the files to dist/)`
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
          port: namespace.transport === 'stdio' ? undefined : namespace.port,
          transport: namespace.transport,
          mcpLabel,
        })

        const container = await docker.createContainer(containerOptions)
        const shortId = container.id.slice(0, 12)

        // Update environment with container ID and restart
        // Note: BACKEND_HOST should be mcp-hub:3001 (container internal port)
        // so wrapper can reach backend when both are on the same Docker network
        const updatedEnv = {
          ENABLED_MCPS: mcpConfig.ENABLED_MCPS,
          DISABLED_TOOLS: mcpConfig.DISABLED_TOOLS,
          NAMESPACE_ID: mcpConfig.NAMESPACE_ID,
          PORT: mcpConfig.PORT,
          BACKEND_HOST: 'mcp-hub:3001',
          NODE_ENV: 'production',
          CONTAINER_ID: shortId,
        }

        const updatedOptions = buildContainerOptions({
          name: containerName,
          image: 'node:20-alpine',
          command: ['sh', '-c', `mkdir -p /app && echo "${scriptBase64}" | base64 -d > /app/mcp-wrapper-server.js && node /app/mcp-wrapper-server.js`],
          env: updatedEnv,
          port: namespace.transport === 'stdio' ? undefined : namespace.port,
          transport: namespace.transport,
          mcpLabel,
        })

        await container.stop().catch(() => undefined)
        await container.remove()

        const newContainer = await docker.createContainer(updatedOptions)
        await newContainer.start()

        // Connect to mcp-hub network so wrapper can reach backend at mcp-hub:3001
        try {
          const mcp_hub_network = docker.getNetwork('mcp-hub-network')
          await mcp_hub_network.connect({ Container: newContainer.id })
          console.error(`[namespaces.deploy] Connected container ${newContainer.id.slice(0, 12)} to mcp-hub-network network`)
        } catch (err) {
          console.error(`[namespaces.deploy] Failed to connect container to network:`, err instanceof Error ? err.message : String(err))
        }

        const finalShortId = newContainer.id.slice(0, 12)
        const data = loadData()

        // Save namespace metadata
        data[finalShortId] = {
          name: `${namespace.name} (custom)`,
          image: 'node:20-alpine',
          command: 'node /app/mcp-wrapper-server.js',
          env: mcpConfig,
          port: namespace.port,
          transport: namespace.transport,
          isCustomNamespace: true,
          namespaceId: namespace.id,
          enabledMcps: enabledMcps.map((m) => m.id),
          disabledTools: namespace.disabledTools && namespace.disabledTools.length > 0 ? namespace.disabledTools : undefined,
        }
        saveData(data)

        return reply.code(200).send({
          id: finalShortId,
          name: data[finalShortId].name,
          image: 'node:20-alpine',
          status: 'running',
          meta: data[finalShortId],
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to deploy namespace'
        return reply.code(500).send({ error: message })
      }
    }
  )
}
