import { A11Y_CATEGORIES, toggleA11yCategory } from '@/utils/constants'

interface Props {
  /** Selected categories; `[]` means all categories. */
  value: string[]
  onChange: (next: string[]) => void
  legend: string
  legendClassName?: string
}

/**
 * Category checkboxes with an explicit "All categories" option (A-64).
 *
 * `[]` means all categories, so the last explicitly selected category cannot be unchecked (that
 * would silently switch back to "all"), and selecting every category collapses back to `[]`.
 */
export function A11yCategoryPicker({ value, onChange, legend, legendClassName }: Props) {
  const allSelected = value.length === 0
  return (
    <fieldset>
      <legend className={legendClassName ?? 'text-sm text-muted-foreground mb-1'}>{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <label className="flex items-center gap-1.5 text-xs font-medium">
          <input
            type="checkbox"
            checked={allSelected}
            // Unchecking "All" keeps every category selected explicitly, so the user can then
            // narrow the list down.
            onChange={(e) => onChange(e.target.checked ? [] : A11Y_CATEGORIES.map((c) => c.value))}
          />
          All categories
        </label>
        {A11Y_CATEGORIES.map((cat) => {
          const checked = allSelected || value.includes(cat.value)
          const isLastSelected = !allSelected && checked && value.length === 1
          return (
            <label key={cat.value} className={`flex items-center gap-1.5 text-xs ${isLastSelected ? 'opacity-70' : ''}`}>
              <input
                type="checkbox"
                checked={checked}
                disabled={isLastSelected}
                title={isLastSelected ? 'At least one category must stay selected' : undefined}
                onChange={(e) => {
                  const next = toggleA11yCategory(value, cat.value, e.target.checked)
                  if (next) onChange(next)
                }}
              />
              {cat.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
