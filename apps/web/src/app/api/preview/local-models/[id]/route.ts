import { readFile } from 'node:fs/promises'
import { isLocalDevelopment, localModelCatalog } from '../catalog'
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isLocalDevelopment(request)) return new Response(null, { status: 404 })
  const { id } = await params
  const model = (await localModelCatalog()).find((item) => item.id === id)
  if (!model) return new Response(null, { status: 404 })
  return new Response(await readFile(model.file), {
    headers: {
      'Content-Type': 'model/gltf-binary',
      'Cache-Control': 'private, no-store',
      'Content-Length': String(model.size),
    },
  })
}
