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

function findOldContainerByNamespaceId(
  data: McpRecord,
  namespaceId: string
): string | null {
  for (const [containerId, mcpData] of Object.entries(data)) {
    if (mcpData.namespaceId === namespaceId) {
      return containerId
    }
  }
  return null
}

async function deployNamespaceContainer(
  docker: Docker,
  loadData: () => McpRecord,
  saveData: (data: McpRecord) => void,
  namespace: DeployNamespacePayload['namespace'],
  enabledMcps: DeployNamespacePayload['enabledMcps'],
  buildContainerOptions: (opts: any) => any,
  mcpLabel: string,
  oldContainerId?: string
) {
  const mcpConfig = {
    ENABLED_MCPS: enabledMcps
      .map((m) => `${m.id}:${m.name}:${m.image}`)
      .join(';'),
    DISABLED_TOOLS: namespace.disabledTools.join(','),
    NAMESPACE_ID: namespace.id,
    PORT: String(namespace.port),
    BACKEND_HOST: 'mcp-hub:3001',
  }

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
  const containerName = `mcp-custom-${namespace.id.replace(/[^a-z0-9-]/g, '-')}`

  const updatedEnv = {
    ENABLED_MCPS: mcpConfig.ENABLED_MCPS,
    DISABLED_TOOLS: mcpConfig.DISABLED_TOOLS,
    NAMESPACE_ID: mcpConfig.NAMESPACE_ID,
    PORT: mcpConfig.PORT,
    BACKEND_HOST: 'mcp-hub:3001',
    NODE_ENV: 'production',
  }

  const containerOptions = buildContainerOptions({
    name: containerName,
    image: 'node:20-alpine',
    command: ['sh', '-c', `mkdir -p /app && echo "${scriptBase64}" | base64 -d > /app/mcp-wrapper-server.js && node /app/mcp-wrapper-server.js`],
    env: updatedEnv,
    port: namespace.transport === 'stdio' ? undefined : namespace.port,
    transport: namespace.transport,
    mcpLabel,
  })

  const newContainer = await docker.createContainer(containerOptions)
  await newContainer.start()

  try {
    const mcp_hub_network = docker.getNetwork('mcp-hub-network')
    await mcp_hub_network.connect({ Container: newContainer.id })
    console.error(`[namespaces] Connected container ${newContainer.id.slice(0, 12)} to mcp-hub-network`)
  } catch (err) {
    console.error(`[namespaces] Failed to connect to network:`, err instanceof Error ? err.message : String(err))
  }

  const finalShortId = newContainer.id.slice(0, 12)
  const data = loadData()

  // Remove old container metadata if updating
  if (oldContainerId && data[oldContainerId]) {
    delete data[oldContainerId]
  }

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

  return {
    id: finalShortId,
    name: data[finalShortId].name,
    image: 'node:20-alpine',
    status: 'running',
    meta: data[finalShortId],
  }
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
        const result = await deployNamespaceContainer(
          docker,
          loadData,
          saveData,
          namespace,
          enabledMcps,
          buildContainerOptions,
          mcpLabel
        )
        return reply.code(200).send(result)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to deploy namespace'
        return reply.code(500).send({ error: message })
      }
    }
  )

  fastify.put<{ Params: { namespaceId: string }; Body: DeployNamespacePayload }>(
    '/api/namespaces/:namespaceId',
    async (req, reply) => {
      const { namespaceId } = req.params
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
        const data = loadData()
        const oldContainerId = findOldContainerByNamespaceId(data, namespaceId)

        // Remove old container if found
        if (oldContainerId) {
          try {
            const oldContainer = docker.getContainer(oldContainerId)
            console.error(`[namespaces.update] Stopping old container ${oldContainerId}`)
            await oldContainer.stop().catch(() => undefined)
            console.error(`[namespaces.update] Removing old container ${oldContainerId}`)
            await oldContainer.remove()
          } catch (err) {
            console.error(`[namespaces.update] Error removing old container:`, err instanceof Error ? err.message : String(err))
          }
        }

        const result = await deployNamespaceContainer(
          docker,
          loadData,
          saveData,
          namespace,
          enabledMcps,
          buildContainerOptions,
          mcpLabel,
          oldContainerId || undefined
        )
        return reply.code(200).send(result)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to update namespace'
        return reply.code(500).send({ error: message })
      }
    }
  )

  fastify.delete<{ Params: { namespaceId: string } }>(
    '/api/namespaces/:namespaceId',
    async (req, reply) => {
      const { namespaceId } = req.params

      try {
        const data = loadData()
        const containerId = findOldContainerByNamespaceId(data, namespaceId)

        if (!containerId) {
          return reply.code(404).send({ error: 'Namespace container not found' })
        }

        try {
          const container = docker.getContainer(containerId)
          console.error(`[namespaces.delete] Stopping container ${containerId}`)
          await container.stop().catch(() => undefined)
          console.error(`[namespaces.delete] Removing container ${containerId}`)
          await container.remove()
        } catch (err) {
          console.error(`[namespaces.delete] Error removing container:`, err instanceof Error ? err.message : String(err))
          return reply.code(500).send({
            error: err instanceof Error ? err.message : 'Failed to remove container'
          })
        }

        // Remove metadata
        if (data[containerId]) {
          delete data[containerId]
          saveData(data)
        }

        return reply.code(200).send({ success: true })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to delete namespace'
        return reply.code(500).send({ error: message })
      }
    }
  )
}
