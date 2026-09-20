import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crcBuf])
}

export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

export interface Color {
  r: number
  g: number
  b: number
  a: number
}

interface Canvas {
  size: number
  data: Buffer
}

function createCanvas(size: number): Canvas {
  return { size, data: Buffer.alloc(size * size * 4, 0) }
}

function blendPixel(canvas: Canvas, x: number, y: number, color: Color, coverage: number): void {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return
  const alpha = Math.max(0, Math.min(1, coverage)) * (color.a / 255)
  if (alpha <= 0) return
  const offset = (y * canvas.size + x) * 4
  const dstA = canvas.data[offset + 3] / 255
  const outA = alpha + dstA * (1 - alpha)
  if (outA <= 0) return
  const mix = (src: number, dst: number): number => (src * alpha + dst * dstA * (1 - alpha)) / outA
  canvas.data[offset] = Math.round(mix(color.r, canvas.data[offset]))
  canvas.data[offset + 1] = Math.round(mix(color.g, canvas.data[offset + 1]))
  canvas.data[offset + 2] = Math.round(mix(color.b, canvas.data[offset + 2]))
  canvas.data[offset + 3] = Math.round(outA * 255)
}

function distanceToRoundedRect(
  px: number,
  py: number,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): number {
  const cx = Math.min(Math.max(px, x + radius), x + w - radius)
  const cy = Math.min(Math.max(py, y + radius), y + h - radius)
  const dx = px - cx
  const dy = py - cy
  return Math.sqrt(dx * dx + dy * dy) - radius
}

function fillRoundedRect(
  canvas: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  color: Color
): void {
  const startX = Math.max(0, Math.floor(x - 1))
  const endX = Math.min(canvas.size, Math.ceil(x + w + 1))
  const startY = Math.max(0, Math.floor(y - 1))
  const endY = Math.min(canvas.size, Math.ceil(y + h + 1))

  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      const signed = distanceToRoundedRect(px + 0.5, py + 0.5, x, y, w, h, radius)
      const coverage = Math.max(0, Math.min(1, 0.5 - signed))
      if (coverage > 0) blendPixel(canvas, px, py, color, coverage)
    }
  }
}

export interface IslandIconOptions {
  size: number
  background: Color | null
  capsule: Color
  glow: Color | null
}

export function renderIslandIcon(options: IslandIconOptions): Buffer {
  const canvas = createCanvas(options.size)
  const s = options.size

  if (options.background) {
    fillRoundedRect(canvas, 0, 0, s, s, s * 0.235, options.background)
  }

  if (options.glow) {
    fillRoundedRect(canvas, s * 0.2, s * 0.33, s * 0.6, s * 0.34, s * 0.17, options.glow)
  }

  const capsuleWidth = s * 0.5
  const capsuleHeight = s * 0.214
  const capsuleX = (s - capsuleWidth) / 2
  const capsuleY = (s - capsuleHeight) / 2
  fillRoundedRect(canvas, capsuleX, capsuleY, capsuleWidth, capsuleHeight, capsuleHeight / 2, options.capsule)

  const dotRadius = capsuleHeight * 0.2
  fillRoundedRect(
    canvas,
    capsuleX + capsuleHeight * 0.32,
    capsuleY + capsuleHeight / 2 - dotRadius,
    dotRadius * 2,
    dotRadius * 2,
    dotRadius,
    { r: 10, g: 10, b: 12, a: 230 }
  )

  const barX = capsuleX + capsuleWidth * 0.42
  const barY = capsuleY + capsuleHeight / 2 - dotRadius * 0.85
  fillRoundedRect(
    canvas,
    barX,
    barY,
    capsuleWidth * 0.42,
    dotRadius * 1.7,
    dotRadius * 0.85,
    { r: 10, g: 10, b: 12, a: 150 }
  )

  return encodePng(s, s, canvas.data)
}

export function renderTrayIcon(size: number, dark: boolean): Buffer {
  const canvas = createCanvas(size)
  const s = size
  const ink: Color = dark
    ? { r: 255, g: 255, b: 255, a: 255 }
    : { r: 20, g: 20, b: 24, a: 255 }

  const bodyWidth = s * 0.86
  const bodyHeight = s * 0.42
  fillRoundedRect(
    canvas,
    (s - bodyWidth) / 2,
    (s - bodyHeight) / 2,
    bodyWidth,
    bodyHeight,
    bodyHeight / 2,
    ink
  )

  const dot = bodyHeight * 0.22
  fillRoundedRect(
    canvas,
    (s - bodyWidth) / 2 + bodyHeight * 0.3,
    s / 2 - dot,
    dot * 2,
    dot * 2,
    dot,
    { r: 0, g: 0, b: 0, a: dark ? 255 : 255 }
  )

  return encodePng(s, s, canvas.data)
}
