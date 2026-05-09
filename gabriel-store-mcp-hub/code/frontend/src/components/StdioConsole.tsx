import { useEffect, useRef, useState } from 'react'
import type { ConsoleProps } from '../types/components'

type SessionPayload = {
  type?: string
  data?: string
  error?: string
}

export default function StdioConsole({ id, name, onClose }: ConsoleProps) {
  const [connected, setConnected] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [input, setInput] = useState('')
  const wsRef = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setLines([])

    const protocol = globalThis.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(
      `${protocol}://${globalThis.location.host}/api/stdio/session/${id}`,
    )
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => {
      setConnected(false)
      setLines((prev) => [...prev, '\n[session closed]\n'])
    }

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as SessionPayload
        if (payload.type === 'output') {
          setLines((prev) => [...prev, payload.data ?? ''])
          return
        }
        if (payload.type === 'error') {
          setLines((prev) => [...prev, `\n[error] ${payload.error}\n`])
          return
        }
      } catch {
        setLines((prev) => [...prev, String(event.data)])
      }
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  const sendInput = () => {
    const text = input
    const ws = wsRef.current
    if (!text.trim() || ws?.readyState !== WebSocket.OPEN) {
      return
    }

    ws.send(JSON.stringify({ type: 'input', data: `${text}\n` }))
    setLines((prev) => [...prev, `> ${text}\n`])
    setInput('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="mx-auto flex h-[78vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-950 sm:h-[74vh]">
        <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
            />
            <span className="font-mono text-sm font-medium text-white">{name}</span>
            <span className="text-xs text-gray-500">— stdio session</span>
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none text-gray-400 hover:text-white"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed text-green-400">
          {lines.length === 0 ? (
            <span className="text-gray-600">Waiting for stdio output…</span>
          ) : (
            lines.map((line) => (
              <div key={line} className="whitespace-pre-wrap break-all">
                {line}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <div className="flex gap-2 border-t border-gray-800 bg-gray-900 p-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                sendInput()
              }
            }}
            placeholder="Type input and press Enter"
            className="input flex-1"
          />
          <button
            onClick={sendInput}
            disabled={!connected || !input.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
