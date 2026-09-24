import type { ComponentType, SVGProps } from 'react'
import { Plus, X } from 'lucide-react'
import {
  DataWarehouse32Item,
  DataflowGen232Item,
  EventHouse32Item,
  Eventstream32Item,
  Lakehouse32Item,
  Notebook32Item,
  Pipeline32Item,
  Reflex32Item,
  SqlDatabase32Item,
} from '@fabric-msft/svg-icons'
import { ITEM_RUNES, RUNE_COUNT, type RuneId } from '../../rayfin/functions/src/playerIdentity'

const icons: Record<RuneId, ComponentType<SVGProps<SVGSVGElement>>> = {
  lakehouse: Lakehouse32Item,
  warehouse: DataWarehouse32Item,
  notebook: Notebook32Item,
  'data-pipeline': Pipeline32Item,
  'dataflow-gen2': DataflowGen232Item,
  'sql-database': SqlDatabase32Item,
  eventhouse: EventHouse32Item,
  eventstream: Eventstream32Item,
  activator: Reflex32Item,
}

interface RunePickerProps {
  value: readonly RuneId[]
  onChange: (value: RuneId[]) => void
  disabled?: boolean
}

function RuneGlyph({ id }: { id: RuneId }) {
  const Icon = icons[id]
  return (
    <span className="rune-glyph">
      <Icon viewBox="0 0 32 32" width={32} height={32} aria-hidden="true" focusable="false" />
    </span>
  )
}

export function SelectedRuneSlots({ value, onChange, disabled = false }: RunePickerProps) {
  return (
    <ol className="spell-slots" aria-label="Your spell in order" data-telemetry-private>
      {Array.from({ length: RUNE_COUNT }, (_, index) => {
        const rune = ITEM_RUNES.find(item => item.id === value[index])
        return (
          <li
            key={`${index}:${rune?.id ?? 'empty'}`}
            data-filled={Boolean(rune)}
            aria-label={`Rune ${index + 1}: ${rune?.label ?? 'empty'}`}
          >
            <span className="spell-socket">
              {rune ? (
                <RuneGlyph id={rune.id} />
              ) : (
                <Plus size={22} strokeWidth={1.5} aria-hidden="true" />
              )}
              {rune && (
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove rune ${index + 1}: ${rune.label}`}
                  onClick={() => onChange(value.filter(id => id !== rune.id))}
                >
                  <X size={12} />
                </button>
              )}
            </span>
            <span className="slot-number">{index + 1}</span>
          </li>
        )
      })}
    </ol>
  )
}

export default function ItemRunePicker({ value, onChange, disabled = false }: RunePickerProps) {
  return (
    <div className="arcade-grid" role="group" aria-label="Item runes" data-telemetry-private>
      <span className="sr-only" role="status" aria-live="polite">
        {value.length} of {RUNE_COUNT} runes chosen.
      </span>
      {ITEM_RUNES.map(rune => {
        const slot = value.indexOf(rune.id)
        return (
          <button
            key={rune.id}
            type="button"
            className="arcade-rune"
            aria-label={rune.label}
            aria-pressed={slot !== -1}
            disabled={disabled || (value.length === RUNE_COUNT && slot === -1)}
            onClick={() =>
              onChange(slot !== -1 ? value.filter(id => id !== rune.id) : [...value, rune.id])
            }
          >
            <span className="rune-token">
              <RuneGlyph id={rune.id} />
              {slot !== -1 && (
                <b className="picked-number" aria-hidden="true">
                  {slot + 1}
                </b>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
