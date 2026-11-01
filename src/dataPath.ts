import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 住所データは releases/<日付> に置き、current のリンクで切り替える。
// 住所のファイルは要求のたびに読むので、リンクを付け替えてから再起動するまでの間、
// 起動時に読んだ索引と新しい版のファイルが混ざる。起動時にリンクの行き先を決めて、それを読み続ける。
// http の URL と無いパスはそのまま返す（無いパスは applyApiBase が起動時に断る）
export function pinDataPath(raw: string): string {
  if (/^https?:\/\//.test(raw)) return raw
  try {
    return realpathSync(raw.startsWith('file://') ? fileURLToPath(raw) : raw)
  } catch {
    return raw
  }
}
