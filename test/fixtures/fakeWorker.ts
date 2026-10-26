// parsePool のテスト用の worker。住所の文字列で振る舞いを変える
//   'heavy'    : 作り直してほしいと返す
//   'crash'    : 応答せずに終了する
//   'uncaught' : 捕まえない例外で落ちる
//   'hang'     : 応答しない
//   'throw'    : 処理に失敗したと返す
//   'slow:N'   : N ミリ秒待ってから応答する
import { parentPort, threadId } from 'node:worker_threads'

parentPort!.on('message', async ({ id, address }: { id: number; address: string }) => {
  if (address === 'crash') process.exit(1)
  if (address === 'uncaught') setTimeout(() => { throw new Error('boom') })
  if (address === 'hang' || address === 'uncaught') return
  if (address === 'throw') return parentPort!.postMessage({ id, failed: true, replace: false, heapUsedMb: 1 })
  const wait = address.startsWith('slow:') ? Number(address.slice(5)) : 0
  if (wait) await new Promise((r) => setTimeout(r, wait))
  parentPort!.postMessage({
    id,
    response: { apiVersion: '1', result: 'jukyo', message: `${threadId}`, segments: [], candidates: [] },
    replace: address === 'heavy',
    heapUsedMb: address === 'heavy' ? 10_000 : 1,
  })
})
