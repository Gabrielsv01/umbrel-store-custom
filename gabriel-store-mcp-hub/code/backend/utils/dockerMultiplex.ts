export function createDockerMultiplexDecoder(
  onPayload: (payload: string, streamType: number) => void,
): (chunk: Buffer) => void {
  let pending = Buffer.alloc(0)

  return (chunk: Buffer) => {
    const data = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk
    let offset = 0

    while (data.length - offset >= 8) {
      // Docker multiplexed stream header: [stream, 0, 0, 0, size(4 bytes)]
      const b1 = data[offset + 1]
      const b2 = data[offset + 2]
      const b3 = data[offset + 3]
      if (b1 !== 0 || b2 !== 0 || b3 !== 0) {
        onPayload(data.subarray(offset).toString('utf8'), 1)
        pending = Buffer.alloc(0)
        return
      }

      const streamType = data[offset]
      const size = data.readUInt32BE(offset + 4)
      if (data.length - offset < 8 + size) {
        break
      }

      const payload = data.subarray(offset + 8, offset + 8 + size).toString('utf8')
      onPayload(payload, streamType)
      offset += 8 + size
    }

    pending = offset < data.length ? Buffer.from(data.subarray(offset)) : Buffer.alloc(0)
  }
}
