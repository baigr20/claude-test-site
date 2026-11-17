import http from 'node:http'
import worker from './backend/subscription-worker.mjs'

const PORT = Number(process.env.PORT || 8788)
const HOST = process.env.HOST || '0.0.0.0'

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || 'api.aideal.vip'
    const url = `https://${host}${req.url}`
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null || key === 'host') continue
      headers.set(key, Array.isArray(value) ? value.join(', ') : String(value))
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = chunks.length ? Buffer.concat(chunks) : undefined
    const init = { method: req.method, headers }
    if (body && req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = body
      init.duplex = 'half'
    }
    const response = await worker.fetch(new Request(url, init), {
      ACTION_TOKEN_SECRET: process.env.ACTION_TOKEN_SECRET || ''
    })
    res.statusCode = response.status
    for (const [key, value] of response.headers) res.setHeader(key, value)
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ ok: false, message: '查询服务异常' }))
  }
})

server.listen(PORT, HOST, () => {
  process.stdout.write(`subscription-query listening on ${HOST}:${PORT}\n`)
})
