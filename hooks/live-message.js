/** Size a bounded live-message area in the Mod surface's character-cell units. */
export function liveMessageHeight(text, columns, maxLines = 8) {
  const width = Math.max(1, Math.floor(Number(columns) || 80))
  const limit = Math.max(1, Math.min(10, Math.floor(Number(maxLines) || 8)))
  let rows = 0
  for (const paragraph of String(text).split('\n')) {
    let used = 0
    rows++
    for (const token of paragraph.match(/\S+\s*/gu) ?? []) {
      const size = Array.from(token).length
      if (used && used + size > width) { rows++; used = 0 }
      rows += Math.max(0, Math.ceil(size / width) - 1)
      used = size > width ? size % width || width : used + size
    }
    if (rows >= limit) return limit
  }
  return Math.min(limit, Math.max(1, rows))
}
