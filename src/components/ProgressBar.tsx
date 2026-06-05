interface Props {
  checked: number
  total: number
}

export function ProgressBar({ checked, total }: Props) {
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm text-muted-foreground">
        <span>{checked} / {total} URLs checked</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
