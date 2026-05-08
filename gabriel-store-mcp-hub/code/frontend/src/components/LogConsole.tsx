import { useState, useEffect, useRef } from 'react'
import type { ConsoleProps } from '../types/components'

export default function LogConsole({ id, name, onClose }: ConsoleProps) {
  const [lines, setLines] = useState<string[]>([])
  const [connected, setConnected] = useState(true)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setLines([])
    setConnected(true)

    const es = new EventSource(`/api/logs/${id}`)

    es.onmessage = (e) => {
      const text = String(JSON.parse(e.data))
      setLines((prev) => [...prev, text])
    }

    es.onerror = () => {
      setConnected(false)
      setLines((prev) => [...prev, '\n[Connection closed]\n'])
      es.close()
    }

    return () => es.close()
  }, [id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/80 p-4">
      <div className="mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-gray-800 bg-gray-950">
        {/* Console header */}
        <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
            />
            <span className="font-mono text-sm font-medium text-white">
              {name}
            </span>
            <span className="text-xs text-gray-500">— logs</span>
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none text-gray-400 hover:text-white"
          >
            ×
          </button>
        </div>

        {/* Log area */}
        <div className="h-80 overflow-y-auto p-4 font-mono text-xs leading-relaxed text-green-400">
          {lines.length === 0 ? (
            <span className="text-gray-600">Waiting for logs…</span>
          ) : (
            lines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {line}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}
