import fs from 'node:fs'

// Pull one font out of a TrueType Collection as a standalone file.
//
// A .ttc is several fonts sharing one pool of tables: each font has its own
// directory of (tag, checksum, offset, length) records pointing into the file.
// A standalone font is the same thing with the tables copied out and the
// offsets rewritten to match their new positions.
export function extractFromCollection(buffer, index) {
  if (buffer.toString('ascii', 0, 4) !== 'ttcf') throw new Error('not a collection')

  const fontStart = buffer.readUInt32BE(12 + index * 4)
  const numTables = buffer.readUInt16BE(fontStart + 4)

  const tables = []
  for (let i = 0; i < numTables; i++) {
    const record = fontStart + 12 + i * 16
    tables.push({
      tag: buffer.toString('ascii', record, record + 4),
      checksum: buffer.readUInt32BE(record + 4),
      offset: buffer.readUInt32BE(record + 8),
      length: buffer.readUInt32BE(record + 12),
    })
  }

  const header = 12 + numTables * 16
  const align = (n) => (n + 3) & ~3

  let cursor = header
  for (const t of tables) {
    t.newOffset = cursor
    cursor = align(cursor + t.length)
  }

  const out = Buffer.alloc(cursor)
  buffer.copy(out, 0, fontStart, fontStart + header)   // header + directory

  tables.forEach((t, i) => {
    const record = 12 + i * 16
    out.writeUInt32BE(t.newOffset, record + 8)
    buffer.copy(out, t.newOffset, t.offset, t.offset + t.length)
  })

  return out
}

const src = fs.readFileSync(process.argv[2])
const count = src.readUInt32BE(8)
console.log(`${count} fonts in the collection`)

const opentype = (await import('opentype.js')).default
for (let i = 0; i < count; i++) {
  const one = extractFromCollection(src, i)
  const font = opentype.parse(one.buffer.slice(one.byteOffset, one.byteOffset + one.length))
  console.log(`  ${i}: ${font.names.fullName?.en ?? font.names.postScriptName?.en}`)
  fs.writeFileSync(`/tmp/snell-${i}.ttf`, one)
}
