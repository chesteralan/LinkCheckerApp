interface Props {
  checked: number
  total: number
}

export function ProgressBar({ checked, total }: Props) {
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm text-muted-foreground">
        <span>
          {checked} / {total} URLs checked
        </span>
        <span>{pct}%</span>
      </div>
      <div
        className="h-2 bg-muted rounded-full overflow-hidden"
        role="progressbar"
        aria-label="URLs checked"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.min(checked, total)}
        aria-valuetext={`${checked} of ${total} URLs checked`}
      >
        <div className="h-full bg-primary transition-all duration-300 rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
