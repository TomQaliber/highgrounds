import { proxyGet } from './_shared'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  return proxyGet(`https://api.opentopodata.org/v1/eudem25m${url.search}`)
}
