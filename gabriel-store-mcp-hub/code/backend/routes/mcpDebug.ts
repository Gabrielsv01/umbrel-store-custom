import type { FastifyInstance } from 'fastify'
import type Docker from 'dockerode'
import type { McpRecord } from '../types/mcp.js'
import http from 'node:http'

interface McpDebugRouteOptions {
  docker: Docker
  loadData: () => McpRecord
  mcpLabel: string
}

export function registerMcpDebugRoutes(
  fastify: FastifyInstance,
  options: McpDebugRouteOptions
): void {
  const { docker, loadData, mcpLabel } = options

  fastify.get<{ Params: { id: string } }>(
    '/api/mcp/:id/debug',
    async (req, reply) => {
      const { id } = req.params
      const data = loadData()
      const mcpData = data[id]

      if (!mcpData) {
        return reply.code(404).send({
          error: 'MCP not found',
          id,
        })
      }

      const report: any = {
        id,
        mcp: mcpData,
        container: {
          exists: false,
          running: false,
          status: 'unknown',
          networkConnected: false,
          networks: [],
          inspect: null,
          logs: null,
        },
        httpTest: {
          attempted: false,
          success: false,
          error: null,
        },
        namespace: null,
        warnings: [],
      }

      try {
        // Check container status
        const container = docker.getContainer(id)
        const inspect = await container.inspect()

        report.container.exists = true
        report.container.status = inspect.State.Status
        report.container.running = inspect.State.Running
        report.container.inspect = {
          id: inspect.Id,
          name: inspect.Name,
          image: inspect.Image,
          state: inspect.State,
          config: {
            hostname: inspect.Config.Hostname,
            env: inspect.Config.Env,
            exposedPorts: inspect.Config.ExposedPorts,
          },
          networkSettings: {
            networks: Object.keys(inspect.NetworkSettings.Networks),
            ipAddress: inspect.NetworkSettings.IPAddress,
          },
        }

        // Check if connected to mcp-hub-network
        const networks = Object.keys(inspect.NetworkSettings.Networks || {})
        report.container.networks = networks
        report.container.networkConnected = networks.includes('mcp-hub-network')

        if (!report.container.networkConnected && mcpData.transport === 'http') {
          report.warnings.push(
            'HTTP MCP is not connected to mcp-hub-network - may cause DNS resolution issues'
          )
        }

        // Get recent logs
        try {
          const logs = await container.logs({
            stdout: true,
            stderr: true,
            tail: 20,
          })
          report.container.logs = logs.toString('utf-8')
        } catch (err) {
          report.container.logs = `Failed to fetch logs: ${err instanceof Error ? err.message : String(err)}`
        }

        // If it's an HTTP MCP, test connectivity
        if (mcpData.transport === 'http' && (mcpData.isCustomToolsMcp || mcpData.isCustomNamespace)) {
          report.httpTest.attempted = true

          let host = 'localhost'
          let port = mcpData.port || 8000

          if (mcpData.isCustomToolsMcp) {
            host = mcpData.containerName || 'localhost'
          } else if (mcpData.isCustomNamespace) {
            // For namespaces, use the container's network name
            host = report.container.inspect?.name?.replace('/', '') || 'localhost'
          }

          const url = `http://${host}:${port}/mcp`

          await new Promise<void>((resolve) => {
            const testPayload = JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: {
                  name: 'MCP Debug',
                  version: '1.0.0',
                },
              },
            })

            const req = http.request(
              url,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(testPayload),
                },
                timeout: 5000,
              },
              (res) => {
                let data = ''
                res.on('data', (chunk) => {
                  data += chunk
                })
                res.on('end', () => {
                  try {
                    JSON.parse(data)
                    report.httpTest.success = true
                    report.httpTest.error = null
                  } catch (err) {
                    report.httpTest.success = false
                    report.httpTest.error = `Invalid JSON response: ${err instanceof Error ? err.message : String(err)}`
                  }
                  resolve()
                })
              }
            )

            req.on('error', (err) => {
              report.httpTest.success = false
              report.httpTest.error = `${(err as NodeJS.ErrnoException).code || 'UNKNOWN'}: ${err.message}`

              const code = (err as NodeJS.ErrnoException).code
              if (code === 'ENOTFOUND') {
                report.warnings.push(
                  `DNS resolution failed for "${host}" - container may not exist or not be on the same network`
                )
              } else if (code === 'ECONNREFUSED') {
                report.warnings.push(
                  `Connection refused to ${host}:${port} - container may not be listening or port is wrong`
                )
              } else if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH') {
                report.warnings.push(
                  `Network unreachable to ${host}:${port} - network connectivity issue`
                )
              }
              resolve()
            })

            req.on('timeout', () => {
              req.destroy()
              report.httpTest.success = false
              report.httpTest.error = `Connection timeout to ${host}:${port}`
              report.warnings.push('Connection timeout - container may be slow to respond')
              resolve()
            })

            req.write(testPayload)
            req.end()
          })
        }

        // Check if this MCP is used by any namespace
        for (const [containerId, mcpInfo] of Object.entries(data)) {
          if (
            mcpInfo?.isCustomNamespace &&
            Array.isArray(mcpInfo.enabledMcps) &&
            mcpInfo.enabledMcps.includes(id)
          ) {
            report.namespace = {
              id: containerId,
              name: mcpInfo.name,
              enabledMcps: mcpInfo.enabledMcps,
            }
            break
          }
        }

        // Summary
        if (report.container.exists && !report.container.running) {
          report.warnings.push('Container exists but is not running')
        }

        if (mcpData.isCustomToolsMcp && !mcpData.containerName) {
          report.warnings.push('containerName is missing - may cause connection issues')
        }

        return reply.send(report)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        // Container doesn't exist as running container
        if (
          message.includes('no such container') ||
          message.includes('404')
        ) {
          report.warnings.push(`Container ${id} does not exist in Docker`)
        }

        return reply.send(report)
      }
    }
  )
}
