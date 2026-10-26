import http from 'node:http'
import type { createRateLimiter } from './rateLimit.ts'
import type { ParseResponse } from './types.ts'

const MAX_BODY_BYTES = 8 * 1024
const PARSE_PATH = '/api/v1/parse'

export type ServerOptions = {
  parse: (address: string) => Promise<ParseResponse>
  limiter: ReturnType<typeof createRateLimiter>
  trustProxy: boolean
  renderPage: (path: string) => Promise<string | null>
  maxAddressLength: number
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    ...headers,
  })
  res.end(JSON.stringify(body))
}

function sendError(res: http.ServerResponse, status: number, code: string, message: string, headers: Record<string, string> = {}) {
  sendJson(res, status, { error: { code, message } }, headers)
}

// 上限を超えたら読むのをやめる。住所を含みうる本文は保持も出力もしない
function readBody(req: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    req.on('data', (chunk: Buffer) => {
      if (over) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        over = true
        chunks.length = 0
        resolve(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

function clientKey(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for']
    // 右端は信頼するプロキシが足した値。左側は送り元が好きに書けるので使わない。
    const parts = (Array.isArray(xff) ? xff.join(',') : xff)?.split(',').map((v) => v.trim()).filter(Boolean)
    const last = parts?.[parts.length - 1]
    if (last) return last
  }
  return req.socket.remoteAddress ?? 'unknown'
}

async function handleParse(req: http.IncomingMessage, res: http.ServerResponse, options: ServerOptions) {
  const limited = options.limiter(clientKey(req, options.trustProxy))
  if (!limited.ok) {
    sendError(res, 429, 'rate_limited', 'リクエストが多すぎます。しばらく待ってから試してください。', {
      'Retry-After': String(limited.retryAfterSec),
    })
    return
  }

  const raw = await readBody(req)
  if (raw === null) {
    // 残りの本文は読み捨て、接続を閉じて応答する
    res.setHeader('Connection', 'close')
    sendError(res, 413, 'too_long', 'リクエストが大きすぎます。')
    return
  }

  let address: unknown
  try {
    address = (JSON.parse(raw) as { address?: unknown } | null)?.address
  } catch {
    address = undefined
  }
  if (typeof address !== 'string' || address.trim() === '') {
    sendError(res, 400, 'bad_request', '住所を文字列で指定してください。')
    return
  }
  if (address.length > options.maxAddressLength) {
    sendError(res, 413, 'too_long', `住所は${options.maxAddressLength}文字以内にしてください。`)
    return
  }
  sendJson(res, 200, await options.parse(address))
}

export function createServer(options: ServerOptions): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const path = (req.url ?? '').split('?')[0] ?? ''
      if (path === PARSE_PATH) {
        if (req.method === 'POST') return await handleParse(req, res, options)
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          })
          res.end()
          return
        }
        return sendError(res, 405, 'method_not_allowed', 'POST で呼び出してください。', { Allow: 'POST, OPTIONS' })
      }
      if (req.method === 'GET') {
        // 要求ごとに読む。起動時に public/ が無くても動かせるようにするため
        const html = await options.renderPage(path)
        if (html !== null) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(html)
          return
        }
      }
      sendError(res, 404, 'not_found', '見つかりません。')
    } catch {
      // 例外の文面に住所が含まれうるので、記録も応答もしない
      if (!res.headersSent) sendError(res, 500, 'internal', 'サーバ内部でエラーが起きました。')
      else res.end()
    }
  })
}
