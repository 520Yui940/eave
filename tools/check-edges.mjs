// 像素级黑边检查：解码 PNG，量四角「圆角外」区域是否残留深色像素。
// 透明窗口 + box-shadow 时，阴影会画在 border-box 上，圆角外的方块区域
// 就会留下半透明黑边 —— 这个脚本就是用来抓这个问题的。
import { readFileSync } from 'node:fs'
import zlib from 'node:zlib'

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png')
  let pos = 8
  let width = 0
  let height = 0
  let colorType = 0
  let bitDepth = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!channels) throw new Error(`unsupported color type ${colorType}`)

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  let prev = Buffer.alloc(stride)
  let p = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]
    const line = Buffer.from(raw.subarray(p, p + stride))
    p += stride
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      if (filter === 1) line[x] = (line[x] + a) & 0xff
      else if (filter === 2) line[x] = (line[x] + b) & 0xff
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 0xff
      else if (filter === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a)
        const pb = Math.abs(pp - b)
        const pc = Math.abs(pp - c)
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        line[x] = (line[x] + pr) & 0xff
      }
    }
    line.copy(out, y * stride)
    prev = line
  }
  return { width, height, channels, data: out }
}

function alphaAt(img, x, y) {
  if (img.channels === 3) return 255
  return img.data[y * img.width * img.channels + x * img.channels + 3]
}
function rgbAt(img, x, y) {
  const i = y * img.width * img.channels + x * img.channels
  return [img.data[i], img.data[i + 1], img.data[i + 2]]
}

const files = process.argv.slice(2)
for (const file of files) {
  const img = decodePng(readFileSync(file))
  const { width, height } = img

  // 找出内容的实际包围盒
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alphaAt(img, x, y) > 4) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) {
    console.log(`${file}: EMPTY (fully transparent)`)
    continue
  }

  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const radius = Math.min(w, h) < 80 ? w / 2 : 26
  const corner = Math.max(5, Math.min(14, Math.round(radius - 2)))

  // 圆角外的方块区域：如果这里是「实心深色」，说明有黑边
  const corners = [
    ['TL', minX, minY],
    ['TR', maxX - corner + 1, minY],
    ['BL', minX, maxY - corner + 1],
    ['BR', maxX - corner + 1, maxY - corner + 1]
  ]

  let worstCorner = { name: '', maxAlphaInOuterZone: 0, darkOpaque: 0 }
  const details = []
  for (const [name, cx, cy] of corners) {
    let darkOpaque = 0
    let maxAlpha = 0
    for (let y = cy; y < cy + corner; y++) {
      for (let x = cx; x < cx + corner; x++) {
        const a = alphaAt(img, x, y)
        if (a > maxAlpha) maxAlpha = a
        if (a > 40) {
          const [r, g, b] = rgbAt(img, x, y)
          if (r < 70 && g < 70 && b < 70) darkOpaque++
        }
      }
    }
    details.push(`${name} maxAlpha=${maxAlpha} darkOpaquePx=${darkOpaque}`)
    if (maxAlpha > worstCorner.maxAlphaInOuterZone) {
      worstCorner = { name, maxAlphaInOuterZone: maxAlpha, darkOpaque }
    }
  }

  // 极端角点必须完全透明（真正的圆角）
  const extreme = [
    [minX, minY],
    [maxX, minY],
    [minX, maxY],
    [maxX, maxY]
  ].map(([x, y]) => alphaAt(img, x, y))

  console.log(`--- ${file} ---`)
  console.log(`  bbox=${w}x${h} at (${minX},${minY})  corner=${corner}px`)

  // 粗粒度 alpha 热力图，用来看「淡雾」铺在哪
  const cols = 44
  const rows = 16
  const cw = width / cols
  const ch = height / rows
  let map = ''
  for (let ry = 0; ry < rows; ry++) {
    let line = ''
    for (let rx = 0; rx < cols; rx++) {
      let maxA = 0
      for (let y = Math.floor(ry * ch); y < Math.floor((ry + 1) * ch); y++) {
        for (let x = Math.floor(rx * cw); x < Math.floor((rx + 1) * cw); x++) {
          const a = alphaAt(img, x, y)
          if (a > maxA) maxA = a
        }
      }
      line += maxA === 0 ? '.' : maxA < 16 ? '-' : maxA < 64 ? '+' : maxA < 200 ? '*' : '#'
    }
    map += '  ' + line + '\n'
  }
  console.log(map)

  let faint = 0
  let strong = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = alphaAt(img, x, y)
      if (a > 4 && a < 40) faint++
      else if (a >= 40) strong++
    }
  }
  console.log(`  faint(alpha 5-39)=${faint}  strong(alpha>=40)=${strong}`)
  console.log(`  ${details.join('\n  ')}`)
  console.log(`  extremeCornerAlpha=${extreme.join(',')}`)
  // 判定标准：圆角外的方块区域不允许出现「深色且明显不透明」的像素。
  // 淡淡的阴影渐变（alpha 很低）是正常的，黑边才是问题。
  const maxCornerAlpha = Math.max(...corners.map((_, i) => details[i].match(/maxAlpha=(\d+)/)[1] | 0))
  const verdict = worstCorner.darkOpaque === 0 && maxCornerAlpha < 40 && Math.max(...extreme) < 16 ? 'PASS' : 'FAIL'
  console.log(`  VERDICT ${verdict}  (darkOpaque=${worstCorner.darkOpaque}, maxCornerAlpha=${maxCornerAlpha})`)
}
