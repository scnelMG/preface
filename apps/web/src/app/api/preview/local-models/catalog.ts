import { readFile, stat, open, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'

export function isLocalDevelopment(request: Request) {
  return (
    process.env.NODE_ENV === 'development' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)
  )
}
export async function localModelCatalog() {
  const root = join(tmpdir(), 'preface-415')
  let catalog: { models: { file: string }[] }
  try {
    catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'))
  } catch {
    return []
  }
  const models: {
    id: string
    title: string
    date: string
    meshUrl: string
    file: string
    size: number
  }[] = []
  for (const entry of catalog.models ?? []) {
    if (typeof entry.file !== 'string' || !entry.file.endsWith('.glb')) continue
    const file = resolve(root, entry.file)
    if (!file.toLowerCase().startsWith((resolve(root) + sep).toLowerCase())) continue
    try {
      const physical = await realpath(file)
      if (!physical.toLowerCase().startsWith((resolve(root) + sep).toLowerCase())) continue
      const info = await stat(file)
      const handle = await open(file, 'r')
      let created = ''
      try {
        const header = Buffer.alloc(20)
        await handle.read(header, 0, 20, 0)
        if (header.toString('ascii', 0, 4) !== 'glTF') continue
        const length = header.readUInt32LE(12)
        if (length > 8 * 1024 * 1024) continue
        const json = Buffer.alloc(length)
        await handle.read(json, 0, length, 20)
        const asset = JSON.parse(json.toString('utf8')).asset
        const value = asset?.extras?.['live-mirror']?.created
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))
          created = value.slice(0, 10)
      } finally {
        await handle.close()
      }
      const id = 'local-' + createHash('sha256').update(entry.file).digest('hex').slice(0, 12)
      models.push({
        id,
        title: '로컬 모델 ' + (models.length + 1),
        date:
          created ||
          new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(info.mtime),
        meshUrl: '/api/preview/local-models/' + id,
        file,
        size: info.size,
      })
    } catch {
      continue
    }
  }
  return models
}
