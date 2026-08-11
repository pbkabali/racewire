#!/usr/bin/env node
/*
 * Make the white background of a PNG transparent.
 *
 *   node scripts/make-logo-transparent.mjs in.png out.png
 *
 * Exists because a logo supplied on a solid white square shows as a white block
 * in dark mode, and this machine has neither ImageMagick nor Pillow. Node's
 * built-in zlib is enough to decode and re-encode a PNG, so this needs no
 * dependencies.
 *
 * The important part is the FLOOD FILL. A naive "make every white pixel
 * transparent" also erases white *inside* the artwork -- the UMC badge has a
 * white ring carrying its lettering, which would be punched straight through.
 * So only near-white pixels reachable from the border are treated as
 * background.
 *
 * Edges get a soft alpha ramp rather than a hard cut, or anti-aliased artwork
 * keeps a visible white fringe once the background behind it is dark.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'

const [inPath, outPath] = process.argv.slice(2)
if (!inPath || !outPath) {
  console.error('Usage: node scripts/make-logo-transparent.mjs <in.png> <out.png>')
  process.exit(1)
}

/** Fully transparent at or above this luminance. */
const CLEAR_ABOVE = 248
/** Fully opaque at or below it; between the two, alpha ramps linearly. */
const KEEP_BELOW = 200

const png = readFileSync(inPath)
if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
  console.error(`${inPath} is not a PNG.`)
  process.exit(1)
}

const width = png.readUInt32BE(16)
const height = png.readUInt32BE(20)
const bitDepth = png[24]
const colourType = png[25]
const interlace = png[28]

if (bitDepth !== 8 || colourType !== 6 || interlace !== 0) {
  console.error(
    `Only 8-bit non-interlaced RGBA is supported (got depth ${bitDepth}, ` +
      `colour type ${colourType}, interlace ${interlace}).`,
  )
  process.exit(1)
}

// ---- read the pixel data ------------------------------------------------
const idat = []
for (let offset = 8; offset < png.length; ) {
  const length = png.readUInt32BE(offset)
  const type = png.subarray(offset + 4, offset + 8).toString('ascii')
  if (type === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + length))
  offset += 12 + length
}

const raw = inflateSync(Buffer.concat(idat))

// ---- undo per-row filtering --------------------------------------------
const BPP = 4
const stride = width * BPP
const pixels = Buffer.alloc(height * stride)

for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)]
  const rowIn = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)

  for (let x = 0; x < stride; x++) {
    const a = x >= BPP ? pixels[y * stride + x - BPP] : 0 // left
    const b = y > 0 ? pixels[(y - 1) * stride + x] : 0 // above
    const c = x >= BPP && y > 0 ? pixels[(y - 1) * stride + x - BPP] : 0 // upper-left

    let value
    switch (filter) {
      case 0:
        value = rowIn[x]
        break
      case 1:
        value = rowIn[x] + a
        break
      case 2:
        value = rowIn[x] + b
        break
      case 3:
        value = rowIn[x] + ((a + b) >> 1)
        break
      case 4: {
        // Paeth: pick whichever neighbour predicts best.
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value = rowIn[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
        break
      }
      default:
        console.error(`Unsupported row filter ${filter} on row ${y}.`)
        process.exit(1)
    }
    pixels[y * stride + x] = value & 0xff
  }
}

const luminance = (i) =>
  0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]

// ---- flood fill the background from the border -------------------------
const background = new Uint8Array(width * height)
const queue = []

const consider = (x, y) => {
  if (x < 0 || y < 0 || x >= width || y >= height) return
  const index = y * width + x
  if (background[index]) return
  const i = index * BPP
  // Already-transparent pixels count as background so a partly-cut-out logo
  // still lets the fill through.
  if (pixels[i + 3] === 0 || luminance(i) >= KEEP_BELOW) {
    background[index] = 1
    queue.push(index)
  }
}

for (let x = 0; x < width; x++) {
  consider(x, 0)
  consider(x, height - 1)
}
for (let y = 0; y < height; y++) {
  consider(0, y)
  consider(width - 1, y)
}

while (queue.length) {
  const index = queue.pop()
  const x = index % width
  const y = (index - x) / width
  consider(x - 1, y)
  consider(x + 1, y)
  consider(x, y - 1)
  consider(x, y + 1)
}

// ---- apply alpha only where the fill reached ---------------------------
let cleared = 0
let feathered = 0

for (let index = 0; index < width * height; index++) {
  if (!background[index]) continue
  const i = index * BPP
  const lum = luminance(i)

  if (lum >= CLEAR_ABOVE) {
    pixels[i + 3] = 0
    cleared++
  } else if (lum > KEEP_BELOW) {
    const ratio = (CLEAR_ABOVE - lum) / (CLEAR_ABOVE - KEEP_BELOW)
    pixels[i + 3] = Math.min(pixels[i + 3], Math.round(ratio * 255))
    feathered++
  }
}

// ---- re-encode ---------------------------------------------------------
const out = Buffer.alloc(height * (stride + 1))
for (let y = 0; y < height; y++) {
  out[y * (stride + 1)] = 0 // filter: none. Costs a little size, avoids bugs.
  pixels.copy(out, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(width, 0)
ihdr.writeUInt32BE(height, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
// 10-12: compression, filter, interlace — all zero

writeFileSync(
  outPath,
  Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(out, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]),
)

const total = width * height
console.log(`${inPath} -> ${outPath}`)
console.log(`${width}x${height}`)
console.log(`cleared   ${cleared} px (${((cleared / total) * 100).toFixed(1)}%)`)
console.log(`feathered ${feathered} px at the edges`)
console.log(`interior white preserved: ${total - cleared - feathered} px untouched`)
