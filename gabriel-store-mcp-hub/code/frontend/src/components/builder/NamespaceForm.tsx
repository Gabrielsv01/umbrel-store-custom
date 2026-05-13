import { useState } from 'react';
import type { McpTransport } from '../../types/mcp';

interface NamespaceFormProps {
  onSubmit: (
    name: string,
    description: string | undefined,
    transport: McpTransport,
    port: number
  ) => void;
  onCancel: () => void;
  initialName?: string;
  initialDescription?: string;
  initialTransport?: McpTransport;
  initialPort?: number;
}

export default function NamespaceForm({
  onSubmit,
  onCancel,
  initialName = '',
  initialDescription = '',
  initialTransport = 'http',
  initialPort = 8000,
}: NamespaceFormProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [transport, setTransport] = useState<McpTransport>(initialTransport);
  const [port, setPort] = useState(initialPort);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && port > 0) {
      const trimmedDescription = typeof description === 'string' ? description.trim() : '';
      onSubmit(name.trim(), trimmedDescription || undefined, transport, port);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-300">
          Namespace Name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., research-tools, production-api"
          className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          autoFocus
        />
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-300">
          Description (optional)
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the purpose of this namespace..."
          className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          rows={2}
        />
      </div>

      <div>
        <label htmlFor="transport" className="block text-sm font-medium text-gray-300">
          Transport Type
        </label>
        <select
          id="transport"
          value={transport}
          onChange={(e) => setTransport(e.target.value as McpTransport)}
          className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 focus:border-blue-500 focus:outline-none"
        >
          <option value="http">HTTP (Default)</option>
          <option value="stdio">STDIO (CLI/Scripts)</option>
          <option value="streamable-http">Streamable HTTP (Streaming)</option>
        </select>
        <p className="mt-1 text-xs text-gray-500">
          {transport === 'http' && 'Standard HTTP server - works with Claude, VS Code, etc.'}
          {transport === 'stdio' && 'Standard input/output - for CLI tools and scripts'}
          {transport === 'streamable-http' && 'HTTP with streaming support for long operations'}
        </p>
      </div>

      <div>
        <label htmlFor="port" className="block text-sm font-medium text-gray-300">
          Port {transport === 'stdio' && '(N/A for STDIO)'}
        </label>
        <input
          id="port"
          type="number"
          value={port}
          onChange={(e) => setPort(Math.max(1, Number.parseInt(e.target.value, 10) || 0))}
          placeholder="e.g., 8000"
          disabled={transport === 'stdio'}
          className="mt-1 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none disabled:bg-gray-900 disabled:text-gray-500"
          min="1"
          max="65535"
        />
        <p className="mt-1 text-xs text-gray-500">
          Port number for the MCP server (1-65535). STDIO transport doesn't use ports.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded bg-blue-600 px-4 py-2 font-medium hover:bg-blue-700"
        >
          Create
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded bg-gray-700 px-4 py-2 hover:bg-gray-600"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
