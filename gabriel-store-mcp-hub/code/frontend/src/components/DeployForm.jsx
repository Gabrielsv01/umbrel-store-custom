import { useState } from 'react'

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs text-gray-400">{label}</label>
      {children}
    </div>
  )
}

export default function DeployForm({
  onDeploy,
  onClose,
  initialValues,
  title = 'Deploy MCP',
  submitLabel = 'Deploy',
  submittingLabel = 'Deploying…',
}) {
  const initialEnvPairs =
    initialValues?.env && Object.keys(initialValues.env).length > 0
      ? Object.entries(initialValues.env).map(([key, value]) => ({ key, value }))
      : [{ key: '', value: '' }]

  const [name, setName] = useState(initialValues?.name ?? '')
  const [image, setImage] = useState(initialValues?.image ?? '')
  const [command, setCommand] = useState(initialValues?.command ?? '')
  const [port, setPort] = useState(initialValues?.port ? String(initialValues.port) : '')
  const [envPairs, setEnvPairs] = useState(initialEnvPairs)
  const [deploying, setDeploying] = useState(false)
  const [error, setError] = useState(null)

  const addEnv = () => setEnvPairs((p) => [...p, { key: '', value: '' }])
  const removeEnv = (i) => setEnvPairs((p) => p.filter((_, idx) => idx !== i))
  const updateEnv = (i, field, val) =>
    setEnvPairs((p) =>
      p.map((pair, idx) => (idx === i ? { ...pair, [field]: val } : pair)),
    )

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setDeploying(true)
    try {
      const env = Object.fromEntries(
        envPairs
          .filter((p) => p.key.trim())
          .map((p) => [p.key.trim(), p.value]),
      )
      await onDeploy({
        name: name.trim(),
        image: image.trim(),
        command: command.trim() || undefined,
        port: port ? Number(port) : undefined,
        env,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setDeploying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-900">
        {/* Modal header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h2 className="font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="text-xl leading-none text-gray-400 hover:text-white"
          >
            ×
          </button>
        </div>

        {/* Form body */}
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 overflow-y-auto p-6"
        >
          <Field label="Container Name *">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-mcp-server"
              className="input"
            />
          </Field>

          <Field label="Docker Image *">
            <input
              required
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="mcr.microsoft.com/playwright:latest"
              className="input"
            />
          </Field>

          <Field label="Start Command">
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx @modelcontextprotocol/server-github"
              className="input"
            />
          </Field>

          <Field label="Host Port (host:container mapped to same number)">
            <input
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="3001"
              className="input"
            />
          </Field>

          {/* Dynamic env vars */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs text-gray-400">
                Environment Variables
              </span>
              <button
                type="button"
                onClick={addEnv}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                + Add
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {envPairs.map((pair, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={pair.key}
                    onChange={(e) => updateEnv(i, 'key', e.target.value)}
                    placeholder="KEY"
                    className="input flex-1 font-mono text-xs"
                  />
                  <input
                    value={pair.value}
                    onChange={(e) => updateEnv(i, 'value', e.target.value)}
                    placeholder="value"
                    className="input flex-1 font-mono text-xs"
                  />
                  {envPairs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeEnv(i)}
                      className="px-2 text-red-400 hover:text-red-300"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-red-900/20 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg bg-gray-800 py-2 text-sm transition-colors hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={deploying}
              className="flex-1 rounded-lg bg-blue-600 py-2 text-sm transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              {deploying ? submittingLabel : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
