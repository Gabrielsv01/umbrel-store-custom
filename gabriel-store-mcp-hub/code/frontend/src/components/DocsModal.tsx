import type { DocsModalProps } from '../types/components';

type Endpoint = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  description: string;
  example?: string;
};

type EndpointSection = {
  title: string;
  endpoints: Endpoint[];
};

const METHOD_STYLES: Record<Endpoint['method'], string> = {
  GET: 'bg-blue-500/15 text-blue-300',
  POST: 'bg-green-500/15 text-green-300',
  PUT: 'bg-yellow-500/15 text-yellow-300',
  DELETE: 'bg-red-500/15 text-red-300',
};

const ENDPOINT_SECTIONS: EndpointSection[] = [
  {
    title: 'MCPs',
    endpoints: [
      {
        method: 'GET',
        path: '/api/mcps',
        description: 'Lista todos os MCPs gerenciados pelo Hub.',
        example: 'curl -sS http://localhost:5146/api/mcps',
      },
      {
        method: 'POST',
        path: '/api/deploy',
        description: 'Cria um novo MCP (com pull automatico se necessario).',
        example:
          'curl -sS -X POST http://localhost:5146/api/deploy -H \'Content-Type: application/json\' -d \'{"name":"context7","image":"node:22-bookworm-slim","transport":"stdio","command":"npx -y @upstash/context7-mcp@latest"}\'',
      },
      {
        method: 'PUT',
        path: '/api/mcps/:id',
        description: 'Atualiza um MCP recriando o container.',
        example:
          'curl -sS -X PUT http://localhost:5146/api/mcps/SEU_ID -H \'Content-Type: application/json\' -d \'{"image":"nova-imagem"}\'',
      },
      {
        method: 'POST',
        path: '/api/action/:id',
        description: 'Executa acao start, stop ou remove.',
        example:
          'curl -sS -X POST http://localhost:5146/api/action/SEU_ID -H \'Content-Type: application/json\' -d \'{"action":"start"}\'',
      },
      {
        method: 'GET',
        path: '/api/logs/:id',
        description: 'Stream SSE de logs do container.',
        example: 'curl -N http://localhost:5146/api/logs/SEU_ID',
      },
    ],
  },
  {
    title: 'Catalogo',
    endpoints: [
      {
        method: 'GET',
        path: '/api/catalog',
        description: 'Lista templates prontos para deploy.',
        example: 'curl -sS http://localhost:5146/api/catalog',
      },
    ],
  },
  {
    title: 'Stdio',
    endpoints: [
      {
        method: 'GET',
        path: '/api/stdio/session/:id (WebSocket)',
        description: 'Sessao interativa para MCP stdio.',
        example: 'wscat -c ws://localhost:5146/api/stdio/session/SEU_ID',
      },
      {
        method: 'GET',
        path: '/api/stdio/proxy/:id/sse',
        description: 'Proxy SSE para clientes externos.',
        example: 'curl -N http://localhost:5146/api/stdio/proxy/SEU_ID/sse',
      },
      {
        method: 'POST',
        path: '/api/stdio/proxy/:id/message?sessionId=<uuid>',
        description: 'Envia mensagens JSON-RPC para o proxy stdio.',
        example:
          'curl -sS -X POST \'http://localhost:5146/api/stdio/proxy/SEU_ID/message?sessionId=SEU_UUID\' -H \'Content-Type: application/json\' -d \'{"jsonrpc":"2.0","method":"echo","params":{}}\'',
      },
      {
        method: 'GET',
        path: '/api/stdio/health/:id',
        description: 'Health check de MCP stdio.',
        example: 'curl -sS http://localhost:5146/api/stdio/health/SEU_ID',
      },
      {
        method: 'GET',
        path: '/api/stdio/health/:id?probe=network',
        description: 'Health check stdio com probe de rede.',
        example:
          'curl -sS "http://localhost:5146/api/stdio/health/SEU_ID?probe=network"',
      },
    ],
  },
  {
    title: 'Health HTTP/Streamable',
    endpoints: [
      {
        method: 'GET',
        path: '/api/health/http/:id',
        description: 'Health check para transports http e streamable-http.',
        example: 'curl -sS http://localhost:5146/api/health/http/SEU_ID',
      },
    ],
  },
  {
    title: 'Imagens e Volumes',
    endpoints: [
      {
        method: 'GET',
        path: '/api/images',
        description: 'Lista imagens locais.',
        example: 'curl -sS http://localhost:5146/api/images',
      },
      {
        method: 'POST',
        path: '/api/images/pull',
        description: 'Pull simples de imagem.',
        example:
          'curl -sS -X POST http://localhost:5146/api/images/pull -H \'Content-Type: application/json\' -d \'{"image":"nginx:latest"}\'',
      },
      {
        method: 'GET',
        path: '/api/images/pull/stream?image=<ref>',
        description: 'SSE de progresso de pull.',
        example:
          'curl -N "http://localhost:5146/api/images/pull/stream?image=nginx:latest"',
      },
      {
        method: 'DELETE',
        path: '/api/images/:id',
        description: 'Remove imagem (bloqueia se estiver em uso).',
        example: 'curl -sS -X DELETE http://localhost:5146/api/images/SEU_ID',
      },
      {
        method: 'GET',
        path: '/api/volumes',
        description: 'Lista volumes.',
        example: 'curl -sS http://localhost:5146/api/volumes',
      },
      {
        method: 'DELETE',
        path: '/api/volumes/:name',
        description: 'Remove volume (bloqueia se estiver em uso).',
        example:
          'curl -sS -X DELETE http://localhost:5146/api/volumes/SEU_NOME',
      },
    ],
  },
];

export default function DocsModal({ onClose }: DocsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="font-semibold text-white">API Docs</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              Referencia rapida dos endpoints do MCP Hub.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none text-gray-400 hover:text-white"
          >
            x
          </button>
        </div>

        <div className="overflow-y-auto p-6">
          <div className="mb-4 rounded-lg border border-blue-900/40 bg-blue-950/20 px-4 py-3 text-xs text-blue-200">
            Base URL: <span className="font-mono">http://localhost:5146</span>
          </div>

          <div className="space-y-6">
            {ENDPOINT_SECTIONS.map((section) => (
              <section
                key={section.title}
                className="rounded-xl border border-gray-800 bg-gray-950/40 p-4"
              >
                <h3 className="mb-3 text-sm font-semibold text-white">
                  {section.title}
                </h3>

                <div className="space-y-3">
                  {section.endpoints.map((endpoint) => (
                    <div
                      key={`${endpoint.method}:${endpoint.path}`}
                      className="rounded-lg border border-gray-800 bg-gray-900/60 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] font-semibold ${METHOD_STYLES[endpoint.method]}`}
                        >
                          {endpoint.method}
                        </span>
                        <span className="font-mono text-xs text-gray-200">
                          {endpoint.path}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-400">
                        {endpoint.description}
                      </p>
                      {endpoint.example ? (
                        <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-2 font-mono text-[11px] text-gray-300">
                          {endpoint.example}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
