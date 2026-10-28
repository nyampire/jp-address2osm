// 分けられなかった住所の記録（FAILURE_LOG）を、期間を指定して集計し、JSON で出す。
// 使い方: node bin/failure-report.ts --since <ISO 8601> [--until <ISO 8601>] <file>...
import { parseArgs } from 'node:util'
import { readFailureRecords, summarizeFailures } from '../src/failureReport.ts'

const { values, positionals } = parseArgs({
  options: { since: { type: 'string' }, until: { type: 'string' } },
  allowPositionals: true,
})

const since = new Date(values.since ?? '')
const until = values.until ? new Date(values.until) : new Date()
if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) || positionals.length === 0) {
  process.stderr.write('使い方: node bin/failure-report.ts --since <ISO 8601> [--until <ISO 8601>] <file>...\n')
  process.exit(2)
}

const { records, skipped } = readFailureRecords(positionals, since, until)
const summary = summarizeFailures(records, skipped)
process.stdout.write(JSON.stringify({ since: since.toISOString(), until: until.toISOString(), ...summary }, null, 2) + '\n')
