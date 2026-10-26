import { Worker } from 'node:worker_threads'
import type { ParseResponse } from './types.ts'

// NJA は町字の一覧などを上限なしでキャッシュし、外から上限を変えられない。
// 分割処理を worker に閉じ込め、ヒープが上限を超えたら worker ごと作り直して
// キャッシュを捨てる。作り直しの前に受けた要求は古い worker が返し終えてから止める。

// 作り直しの上限に対する、worker の古い世代の上限の倍率。作り直しの判断が
// 遅れても OOM で落ちないだけの余裕を持たせつつ、2つの worker が並ぶ間も
// プロセス全体のメモリが予算に収まるようにする
const OLD_GENERATION_RATIO = 1.25

/** worker からの返事。replace は作り直してほしいという worker の判断 */
export type Reply = { id: number; response?: ParseResponse; failed?: true; replace: boolean; heapUsedMb: number }

type Pending = { resolve: (r: ParseResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
type Slot = { worker: Worker; pending: Map<number, Pending>; retired: boolean }

export type ParsePool = {
  parse: (address: string) => Promise<ParseResponse>
  stats: () => { workers: number; replaced: number; exited: number }
  close: () => Promise<void>
}

export function createParsePool(options: {
  workerUrl: URL
  heapLimitMb: number
  requestTimeoutMs?: number
  onReplace?: (heapUsedMb: number) => void
  onExit?: () => void
}): ParsePool {
  const timeoutMs = options.requestTimeoutMs ?? 10_000
  const slots = new Set<Slot>()
  // 新しい worker は次の要求が来たときに立てる。落ちた直後に立てると、
  // 起動できない状態（住所データの破損など）で作り直しが際限なく続く
  let current: Slot | null = null
  let nextId = 0
  let replaced = 0
  let exited = 0
  let closed = false

  const stopIfIdle = (slot: Slot) => {
    if (slot.retired && slot.pending.size === 0) void slot.worker.terminate()
  }

  const retire = (slot: Slot) => {
    if (slot.retired) return
    slot.retired = true
    if (slot === current) current = null
    stopIfIdle(slot)
  }

  const spawn = (): Slot => {
    const worker = new Worker(options.workerUrl, {
      workerData: { heapLimitMb: options.heapLimitMb },
      resourceLimits: { maxOldGenerationSizeMb: Math.ceil(options.heapLimitMb * OLD_GENERATION_RATIO) },
    })
    const slot: Slot = { worker, pending: new Map(), retired: false }
    slots.add(slot)
    worker.on('message', ({ id, response, failed, replace, heapUsedMb }: Reply) => {
      const p = slot.pending.get(id)
      if (!p) return
      slot.pending.delete(id)
      clearTimeout(p.timer)
      if (failed || !response) p.reject(new Error('parse failed'))
      else p.resolve(response)
      if (replace && !slot.retired) {
        replaced++
        options.onReplace?.(heapUsedMb)
        retire(slot)
      } else {
        stopIfIdle(slot)
      }
    })
    // 終了したら抱えた要求を失敗させる。error のあとに exit も来るので2度目は何もしない。
    // 作り直しで止めた worker（retired）のほかは予定外の終了なので onExit に知らせる
    let ended = false
    const end = () => {
      if (ended) return
      ended = true
      const planned = slot.retired
      for (const p of slot.pending.values()) {
        clearTimeout(p.timer)
        p.reject(new Error('parse worker stopped'))
      }
      slot.pending.clear()
      retire(slot)
      slots.delete(slot)
      exited++
      if (!planned && !closed) options.onExit?.()
    }
    worker.on('error', end)
    worker.on('exit', end)
    return slot
  }

  return {
    parse: (address) => new Promise((resolve, reject) => {
      if (closed) return reject(new Error('parse pool closed'))
      const slot = current ?? (current = spawn())
      const id = nextId++
      // 処理が返らない worker は止める。抱えたほかの要求は exit で失敗する
      const timer = setTimeout(() => {
        if (!slot.pending.delete(id)) return
        reject(new Error('parse timed out'))
        // retired にせずに止め、予定外の終了として扱う。以降の要求は新しい worker へ
        if (slot === current) current = null
        void slot.worker.terminate()
      }, timeoutMs)
      slot.pending.set(id, { resolve, reject, timer })
      slot.worker.postMessage({ id, address })
    }),
    stats: () => ({ workers: slots.size, replaced, exited }),
    close: async () => {
      closed = true
      await Promise.all([...slots].map((s) => s.worker.terminate()))
    },
  }
}
