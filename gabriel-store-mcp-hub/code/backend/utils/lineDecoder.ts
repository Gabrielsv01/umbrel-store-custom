export function createLineDecoder(onLine: (line: string) => void): (chunk: string) => void {
  let pending = ''

  return (chunk: string) => {
    pending += chunk

    while (true) {
      const idx = pending.indexOf('\n')
      if (idx === -1) break

      const line = pending.slice(0, idx).replace(/\r$/, '')
      pending = pending.slice(idx + 1)
      if (line.trim().length === 0) continue
      onLine(line)
    }
  }
}
