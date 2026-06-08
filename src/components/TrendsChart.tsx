import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from 'recharts'
import { listAuditRuns } from '@/lib/tauri'
import type { AuditRun } from '@/types'

interface DayBucket {
  date: string
  passed: number
  failed: number
  errored: number
  avgResponseMs: number
  total: number
}

function bucketRuns(runs: AuditRun[]): DayBucket[] {
  const buckets = new Map<string, DayBucket>()
  for (const run of runs) {
    if (run.status !== 'completed' || !run.completedAt) continue
    const day = run.completedAt.slice(0, 10)
    if (!buckets.has(day)) buckets.set(day, { date: day, passed: 0, failed: 0, errored: 0, avgResponseMs: 0, total: 0 })
    const b = buckets.get(day)!
    b.total++
    b.passed += run.summary.passed
    b.failed += run.summary.failed
    b.errored += run.summary.errored
    b.avgResponseMs += run.summary.avgResponseTimeMs * (run.summary.total || 1)
  }
  const totalCounts = new Map<string, number>()
  for (const run of runs) {
    if (run.status !== 'completed' || !run.completedAt) continue
    const day = run.completedAt.slice(0, 10)
    totalCounts.set(day, (totalCounts.get(day) || 0) + (run.summary.total || 1))
  }
  for (const [day, b] of buckets) {
    const tc = totalCounts.get(day) || 1
    b.avgResponseMs = Math.round(b.avgResponseMs / tc)
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function TrendsChart({ auditId }: { auditId: string }) {
  const [runs, setRuns] = useState<AuditRun[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listAuditRuns(auditId)
      .then(setRuns)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [auditId])

  if (loading) return <p className="text-sm text-muted-foreground">Loading trends...</p>
  if (runs.length < 2) return <p className="text-sm text-muted-foreground">Need at least 2 completed runs to show trends.</p>

  const data = bucketRuns(runs)

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-medium mb-2">Pass / Fail Rate Over Time</h4>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data}>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="passed" stackId="a" fill="hsl(var(--success))" name="Passed" />
            <Bar dataKey="failed" stackId="a" fill="hsl(var(--destructive))" name="Failed" />
            <Bar dataKey="errored" stackId="a" fill="hsl(var(--warning))" name="Errored" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div>
        <h4 className="text-sm font-medium mb-2">Avg Response Time (ms)</h4>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data}>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="avgResponseMs" stroke="hsl(var(--primary))" name="Avg Response (ms)" dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
