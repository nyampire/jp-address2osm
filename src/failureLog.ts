import fs from 'node:fs'

export type FailureReason = 'machiaza-unresolved' | 'normalize-error' | 'empty'
export type FailureEntry = { address: string; reason: FailureReason }

// 要求の数が少なく順序も保ちたいので、同期の追記で足りる
export function createFailureLog(path: string | undefined): (entry: FailureEntry) => void {
  if (!path) return () => {}
  return (entry) => {
    // 記録の失敗で要求まで失敗させない。例外の文面に住所を含みうるので、固定の文だけ出す
    try {
      fs.appendFileSync(path, JSON.stringify({ time: new Date().toISOString(), address: entry.address, reason: entry.reason }) + '\n')
    } catch {
      process.stderr.write('failure log: write failed\n')
    }
  }
}
