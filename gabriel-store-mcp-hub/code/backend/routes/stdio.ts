import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { runStdioHealthCheck } from '../services/stdioHealth.js'
import type {
  RegisterStdioRoutesDeps,
  ResolvedStdioContainer,
  StdioHealthQuery,
  StdioProxyMessageQuery,
  StdioProxySession,
  StdioWsMessage,
} from '../types/stdio.js'

export function registerStdioRoutes(
  fastify: FastifyInstance,
  deps: RegisterStdioRoutesDeps,
): void {
  const {
    resolveStdioContainer,
    createDockerMultiplexDecoder,
    createLineDecoder,
    detectNetworkIssues,
    selectNetworkProbeTool,
  } = deps

  const stdioProxySessions = new Map<string, StdioProxySession>()

  const closeStdioProxySession = async (sessionId: string): Promise<void> => {
    const session = stdioProxySessions.get(sessionId)
    if (!session || session.closed) return

    session.closed = true
    stdioProxySessions.delete(sessionId)

    try {
      ;(session.stream as unknown as Readable).destroy()
    } catch {
      // ignore stream close errors
    }
  }

  fastify.post<{
    Params: { id: string };
    Body: { jsonrpc: string; id: string | number; method: string; params?: any };
  }>('/api/stdio/proxy/:id', async (req, reply) => {
    const { id } = req.params;
    const payload = req.body;

    const { container } = await resolveStdioContainer(id).catch((err) => {
      return reply.code(404).send({ error: err.message });
    });

    const stream = await container.attach({
      stream: true, stdin: true, stdout: true, stderr: true, hijack: true, logs: true
    });

    const getMcpResponse = () => new Promise((resolve, reject) => {
      let responseBuffer = '';
      let isFinished = false;

      const timeout = setTimeout(() => {
        if (!isFinished) {
          isFinished = true;
          cleanup();
          reject(new Error('TIMEOUT_MCP'));
        }
      }, 30000); // 30 segundos para chamadas complexas

      const cleanup = () => {
        clearTimeout(timeout);
        try { (stream as any).destroy(); } catch {}
      };

      const decode = createDockerMultiplexDecoder((payloadText, streamType) => {
        if (streamType === 2) {
          console.error(`[CONTAINER LOG]: ${payloadText.trim()}`);
          return;
        }
        if (isFinished || streamType !== 1) return;

        responseBuffer += payloadText;
        const lines = responseBuffer.split('\n');
        
        // Preserva a última linha incompleta no buffer
        responseBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('{')) continue;

          try {
            const parsed = JSON.parse(trimmed);
            // Comparação flexível de ID (string ou number)
            if (parsed && String(parsed.id) === String(payload.id)) {
              isFinished = true;
              cleanup();
              resolve(parsed);
              return;
            }
          } catch {
            // Linha malformada ou incompleta
          }
        }
      });

      stream.on('data', decode);
      stream.on('error', (err) => {
        isFinished = true;
        cleanup();
        reject(err);
      });

      // Boot Delay Inteligente
      container.inspect().then(async (info) => {
        const state = info?.State as any;
        const uptime = Date.now() - new Date(state?.StartedAt || 0).getTime();
        const waitTime = uptime < 3000 ? 2200 : 100;
        
        await new Promise(r => setTimeout(r, waitTime));
        
        if (!isFinished) {
          stream.write(`${JSON.stringify(payload)}\n`);
        }
      });
    });

    try {
      const result = await getMcpResponse();
      return reply.type('application/json').send(result);
    } catch (err: any) {
      if (err.message === 'TIMEOUT_MCP') {
        return reply.code(504).send({ error: 'Gateway Timeout', details: 'The container did not respond in time.' });
      }
      return reply.code(500).send({ error: 'Internal Error', details: err.message });
    }
  });

  fastify.get<{ Params: { id: string } }>(
    '/api/stdio/session/:id',
    { websocket: true },
    async (socket, req) => {
      let container: ResolvedStdioContainer['container']

      try {
        const resolved = await resolveStdioContainer(req.params.id)
        container = resolved.container
      } catch (err) {
        socket.send(
          JSON.stringify({
            type: 'error',
            error: err instanceof Error ? err.message : 'failed to open session',
          }),
        )
        socket.close()
        return
      }

      const stream = await container.attach({
        stream: true,
        stdin: true,
        stdout: true,
        stderr: true,
        logs: false,
        hijack: true,
      })

      socket.send(JSON.stringify({ type: 'ready' }))

      const decodeChunk = createDockerMultiplexDecoder((payload) => {
        socket.send(JSON.stringify({ type: 'output', data: payload }))
      })

      stream.on('data', (chunk: Buffer) => {
        decodeChunk(chunk)
      })

      const closeSession = async () => {
        try {
          ;(stream as unknown as Readable).destroy()
        } catch {
          // ignore stream close errors
        }

        const latest = await container.inspect().catch(() => null)
        if (latest?.State?.Running) {
          await container.stop().catch(() => undefined)
        }
      }

      socket.on('message', (raw: unknown) => {
        try {
          const message = JSON.parse(String(raw)) as StdioWsMessage
          if (message.type !== 'input') return
          stream.write(message.data ?? '')
        } catch {
          // ignore malformed client frames
        }
      })

      socket.on('close', () => {
        void closeSession()
      })
    },
  )

  fastify.get<{ Params: { id: string } }>('/api/stdio/proxy/:id/sse', async (req, reply) => {
    let container: ResolvedStdioContainer['container']

    try {
      const resolved = await resolveStdioContainer(req.params.id)
      container = resolved.container
    } catch (err) {
      return reply
        .code(404)
        .send({ error: err instanceof Error ? err.message : 'container not found' })
    }

    const stream = await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      logs: false,
      hijack: true,
    })

    const sessionId = randomUUID()
    stdioProxySessions.set(sessionId, {
      sessionId,
      container,
      stream,
      closed: false,
    })

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    const sendEvent = (event: string, data: string) => {
      reply.raw.write(`event: ${event}\n`)
      reply.raw.write(`data: ${data}\n\n`)
    }

    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol
    const host = req.headers.host
    const endpointUrl = `${proto}://${host}/api/stdio/proxy/${req.params.id}/message?sessionId=${sessionId}`
    sendEvent('endpoint', endpointUrl)

    const onStdoutLine = createLineDecoder((line) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        sendEvent('message', JSON.stringify(parsed))
      } catch {
        // ignore non-JSON lines from stdout
      }
    })

    const decodeChunk = createDockerMultiplexDecoder((payload, streamType) => {
      if (streamType === 1) {
        onStdoutLine(payload)
      }
    })

    stream.on('data', (chunk: Buffer) => {
      decodeChunk(chunk)
    })

    stream.on('end', () => {
      sendEvent('close', JSON.stringify({ reason: 'stream ended' }))
      reply.raw.end()
      void closeStdioProxySession(sessionId)
    })

    stream.on('error', (err: Error) => {
      sendEvent('error', JSON.stringify({ error: err.message }))
      reply.raw.end()
      void closeStdioProxySession(sessionId)
    })

    req.raw.on('close', () => {
      reply.raw.end()
      void closeStdioProxySession(sessionId)
    })
  })

  fastify.get<{ Params: { id: string }; Querystring: StdioHealthQuery }>(
    '/api/stdio/health/:id',
    async (req, reply) => {
      let container: ResolvedStdioContainer['container']

      try {
        const resolved = await resolveStdioContainer(req.params.id)
        container = resolved.container
      } catch (err) {
        return reply
          .code(404)
          .send({ error: err instanceof Error ? err.message : 'container not found' })
      }

      return runStdioHealthCheck({
        id: req.params.id,
        probe: req.query?.probe,
        container,
        createDockerMultiplexDecoder,
        createLineDecoder,
        detectNetworkIssues,
        selectNetworkProbeTool,
      })
    },
  )

  fastify.post<{
    Params: { id: string }
    Querystring: StdioProxyMessageQuery
    Body: Record<string, unknown>
  }>('/api/stdio/proxy/:id/message', async (req, reply) => {
    const sessionId = req.query.sessionId?.trim()
    if (!sessionId) {
      return reply.code(400).send({ error: 'sessionId is required' })
    }

    const session = stdioProxySessions.get(sessionId)
    if (!session || session.closed) {
      return reply.code(404).send({ error: 'session not found' })
    }

    const payload = req.body
    if (!payload || typeof payload !== 'object') {
      return reply.code(400).send({ error: 'json body is required' })
    }

    const wire = `${JSON.stringify(payload)}\n`
    session.stream.write(wire)

    return reply.code(202).send({ ok: true })
  })
}
