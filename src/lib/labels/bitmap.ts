/** A black-and-white image in printer dots. bits[y * width + x] is 1 for black. */
export interface MonoBitmap {
  width: number
  height: number
  bits: Uint8Array
}

export function createBitmap(width: number, height: number): MonoBitmap {
  return { width, height, bits: new Uint8Array(width * height) }
}

/** Rotates 90° clockwise: how a label fed sideways through the printer comes out. */
export function rotateCW(bm: MonoBitmap): MonoBitmap {
  const out = createBitmap(bm.height, bm.width)
  for (let y = 0; y < bm.height; y++) {
    for (let x = 0; x < bm.width; x++) {
      out.bits[x * out.width + (bm.height - 1 - y)] = bm.bits[y * bm.width + x]!
    }
  }
  return out
}

/** QR modules (quiet zone included) drawn with square modules of `moduleDots` dots. */
export function qrBitmap(modules: boolean[][], moduleDots: number): MonoBitmap {
  const n = modules.length
  const bm = createBitmap(n * moduleDots, n * moduleDots)
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!modules[r]![c]) continue
      for (let dy = 0; dy < moduleDots; dy++) {
        bm.bits.fill(1, (r * moduleDots + dy) * bm.width + c * moduleDots, (r * moduleDots + dy) * bm.width + (c + 1) * moduleDots)
      }
    }
  }
  return bm
}

/**
 * RGBA pixels (e.g. from a canvas) to black and white. Transparent areas count as white paper;
 * anything darker than the threshold prints black. 225 keeps the logo's light grey swirl.
 */
export function rgbaToMono(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, threshold = 225): MonoBitmap {
  const bm = createBitmap(width, height)
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3]! / 255
    const lum = 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!
    bm.bits[i] = lum * a + 255 * (1 - a) < threshold ? 1 : 0
  }
  return bm
}

/** Rows as hex, 8 dots per byte, leftmost dot in the high bit (Zebra GRF layout). */
function hexRows(bm: MonoBitmap): string[] {
  const bytesPerRow = Math.ceil(bm.width / 8)
  const rows: string[] = []
  for (let y = 0; y < bm.height; y++) {
    let row = ''
    for (let b = 0; b < bytesPerRow; b++) {
      let byte = 0
      for (let bit = 0; bit < 8; bit++) {
        const x = b * 8 + bit
        if (x < bm.width && bm.bits[y * bm.width + x]) byte |= 0x80 >> bit
      }
      row += byte.toString(16).toUpperCase().padStart(2, '0')
    }
    rows.push(row)
  }
  return rows
}

const SMALL = 'GHIJKLMNOPQRSTUVWXY' // repeat counts 1..19
const LARGE = 'ghijklmnopqrstuvwxyz' // repeat counts 20, 40 ... 400

function repeatCode(count: number): string {
  let out = ''
  while (count >= 400) {
    out += 'z'
    count -= 400
  }
  if (count >= 20) {
    out += LARGE[Math.floor(count / 20) - 1]
    count %= 20
  }
  if (count > 0) out += SMALL[count - 1]
  return out
}

/** Zebra ASCII compression of one hex row: runs, "," for trailing white, "!" for trailing black. */
function compressRow(row: string): string {
  const trailing = /([0F])\1*$/.exec(row)
  let body = row
  let tail = ''
  if (trailing && trailing[0].length >= 2) {
    body = row.slice(0, row.length - trailing[0].length)
    tail = trailing[1] === '0' ? ',' : '!'
  }
  let out = ''
  for (let i = 0; i < body.length; ) {
    let j = i
    while (j < body.length && body[j] === body[i]) j++
    const run = j - i
    out += run > 1 ? repeatCode(run) + body[i] : body[i]
    i = j
  }
  return out + tail
}

/** Graphic data for ^GFA / ~DG, compressed with Zebra's ASCII scheme (":" repeats the previous row). */
export function toZplGraphic(bm: MonoBitmap) {
  const bytesPerRow = Math.ceil(bm.width / 8)
  const rows = hexRows(bm)
  let data = ''
  rows.forEach((row, i) => {
    data += i > 0 && row === rows[i - 1] ? ':' : compressRow(row)
  })
  return { bytesPerRow, totalBytes: bytesPerRow * bm.height, data }
}
