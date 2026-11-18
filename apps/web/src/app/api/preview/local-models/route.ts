import { isLocalDevelopment, localModelCatalog } from './catalog'
export async function GET(request: Request) {
  if (!isLocalDevelopment(request)) return new Response(null, { status: 404 })
  const models = await localModelCatalog()
  return Response.json(
    { models: models.map(({ id, title, date, meshUrl }) => ({ id, title, date, meshUrl })) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
