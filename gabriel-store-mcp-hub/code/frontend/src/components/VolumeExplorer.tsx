import React, { useState, useEffect } from 'react'
import { Folder, File, Download, Trash2, ChevronRight, ChevronDown } from 'lucide-react'

interface FileInfo {
  name: string
  isDirectory: boolean
  size?: number
  modified?: string
}

interface VolumeExplorerProps {
  volumeName: string
  onClose: () => void
}

export const VolumeExplorer: React.FC<VolumeExplorerProps> = ({ volumeName, onClose }) => {
  const [currentPath, setCurrentPath] = useState('/')
  const [files, setFiles] = useState<FileInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

  const loadFiles = async (dirPath: string) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(
        `/api/volumes/${volumeName}/browse?dirPath=${encodeURIComponent(dirPath)}`
      )
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to load files')
      }
      const data = await response.json()
      setFiles(data.files)
      setCurrentPath(data.currentPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFiles('/')
  }, [volumeName])

  const handleNavigate = (filename: string) => {
    const newPath = currentPath === '/' ? `/${filename}` : `${currentPath}/${filename}`
    loadFiles(newPath)
  }

  const handleDownload = async (filename: string) => {
    const filePath = currentPath === '/' ? `/${filename}` : `${currentPath}/${filename}`
    try {
      const response = await fetch(
        `/api/volumes/${volumeName}/download?filePath=${encodeURIComponent(filePath)}`
      )
      if (!response.ok) throw new Error('Download failed')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      alert('Download failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  const handleDelete = async (filename: string) => {
    if (!confirm(`Delete ${filename}?`)) return

    const filePath = currentPath === '/' ? `/${filename}` : `${currentPath}/${filename}`
    try {
      const response = await fetch(
        `/api/volumes/${volumeName}/file?filePath=${encodeURIComponent(filePath)}`,
        { method: 'DELETE' }
      )
      if (!response.ok) throw new Error('Delete failed')
      await loadFiles(currentPath)
    } catch (err) {
      alert('Delete failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  const handleGoBack = () => {
    if (currentPath === '/') return
    const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/'
    loadFiles(parentPath)
  }

  const formatSize = (bytes?: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="font-semibold text-white">Volume Explorer: {volumeName}</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              Browse and manage files in this volume
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none text-gray-400 hover:text-white"
          >
            ×
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-gray-800 bg-gray-950/40 px-6 py-3">
          <button
            onClick={handleGoBack}
            disabled={currentPath === '/'}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs transition-colors hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ← Back
          </button>
          <span className="font-mono text-xs text-gray-400">{currentPath}</span>
        </div>

        {error && (
          <div className="border-b border-gray-800 bg-red-900/20 px-6 py-3 text-sm text-red-400">
            Error: {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="py-16 text-center text-sm text-gray-400">Loading...</div>
          ) : files.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-400">Empty folder</div>
          ) : (
            <div className="divide-y divide-gray-800">
              {files.map(file => (
                <div
                  key={file.name}
                  className="flex items-center justify-between py-3 px-3 hover:bg-gray-800/50 transition-colors group"
                >
                  <div
                    className="flex items-center gap-3 flex-1 cursor-pointer"
                    onClick={() => file.isDirectory && handleNavigate(file.name)}
                  >
                    {file.isDirectory ? (
                      <Folder size={18} className="text-blue-400 flex-shrink-0" />
                    ) : (
                      <File size={18} className="text-gray-500 flex-shrink-0" />
                    )}
                    <span className="text-sm text-gray-200 truncate">{file.name}</span>
                    {file.size && (
                      <span className="text-xs text-gray-500 ml-auto mr-2">
                        {formatSize(file.size)}
                      </span>
                    )}
                  </div>

                  {!file.isDirectory && (
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleDownload(file.name)}
                        className="rounded-lg bg-blue-600/20 px-2 py-1.5 text-blue-300 transition-colors hover:bg-blue-600/30"
                        title="Download"
                      >
                        <Download size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(file.name)}
                        className="rounded-lg bg-red-600/20 px-2 py-1.5 text-red-300 transition-colors hover:bg-red-600/30"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}

                  {file.isDirectory && (
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleDelete(file.name)}
                        className="rounded-lg bg-red-600/20 px-2 py-1.5 text-red-300 transition-colors hover:bg-red-600/30"
                        title="Delete folder"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
