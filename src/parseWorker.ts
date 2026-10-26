import { getHeapStatistics, setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { parentPort, workerData } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { createFailureLog } from './failureLog.ts'
import type { Reply } from './parsePool.ts'

// 分割処理を動かす worker。parsePool から1件ずつ住所を受け取り、応答と、
// 作り直してほしいかどうかを返す。NJA_API_BASE は main.ts が確かめてある
const njaOsmTags = await import('../vendor/nja-osm-tags/src/index.ts')
const { parseAddress } = await import('./parse.ts')

const base = njaOsmTags.resolveApiBase(process.env.NJA_API_BASE)!
const deps = {
  normalize: njaOsmTags.normalize,
  judge: njaOsmTags.makeNumberJudge(fileURLToPath(base)),
  logFailure: createFailureLog(process.env.FAILURE_LOG),
}

// ヒープの使用量には回収前のゴミも含まれる。上限を超えたときだけ回収してから
// 測り直し、残ったキャッシュが上限の8割を超えていれば作り直しを頼む。
// 8割で切るのは、上限のすぐ下で止まったキャッシュが毎回の全体回収を招かないため。
// 起動後に gc を出す手段は公式には保証されないので、取れなければ回収せずに判断する
const RETAIN_RATIO = 0.8
const limitMb: number = workerData?.heapLimitMb ?? Infinity
const gc = (() => {
  try {
    setFlagsFromString('--expose-gc')
    const g = runInNewContext('gc')
    return typeof g === 'function' ? (g as () => void) : null
  } catch {
    return null
  }
})()
const measure = () => getHeapStatistics().used_heap_size / 1e6

function checkHeap(): { replace: boolean; heapUsedMb: number } {
  const used = measure()
  if (used <= limitMb) return { replace: false, heapUsedMb: used }
  if (!gc) return { replace: true, heapUsedMb: used }
  gc()
  const after = measure()
  return { replace: after > limitMb * RETAIN_RATIO, heapUsedMb: after }
}

parentPort!.on('message', async ({ id, address }: { id: number; address: string }) => {
  let reply: Omit<Reply, 'replace' | 'heapUsedMb'>
  try {
    reply = { id, response: await parseAddress(address, deps) }
  } catch {
    // 例外の中身に住所が含まれうるので、失敗したことだけを返す
    reply = { id, failed: true }
  }
  parentPort!.postMessage({ ...reply, ...checkHeap() })
})
