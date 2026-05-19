import { useEffect, useRef } from 'react';
import type { BuildLogEntry } from '../../types/dockerBuilder';

interface BuildLogProps {
  entries: BuildLogEntry[];
  building: boolean;
}

export default function BuildLog({ entries, building }: BuildLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-950 p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-300">
        {building && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />}
        Build Log
      </h3>

      <div
        ref={scrollRef}
        className="max-h-96 space-y-1 overflow-y-auto rounded border border-gray-800 bg-gray-900 p-3 font-mono text-xs"
      >
        {entries.length === 0 ? (
          <div className="text-gray-500">Build log will appear here...</div>
        ) : (
          <>
            {entries.length >= 1000 && (
              <div className="text-yellow-600 pb-2 border-b border-yellow-900">
                ⚠️ Showing last 1000 events (earlier logs discarded)
              </div>
            )}
            {entries.map((entry, idx) => (
              <div
                key={idx}
                className={`${
                  entry.type === 'error'
                    ? 'text-red-400'
                    : entry.type === 'success'
                      ? 'text-green-400'
                      : entry.type === 'progress'
                        ? 'text-blue-400'
                        : 'text-gray-400'
                }`}
              >
                <span className="text-gray-600">[{entry.timestamp.toLocaleTimeString()}]</span>{' '}
                {entry.message}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
