import { useState, type ReactNode } from 'react'
import { Code2, RotateCcw, X } from 'lucide-react'

interface Props {
  onDemo: () => void
  onReset: () => void
  children: ReactNode
}

export default function PrototypeControls({ onDemo, onReset, children }: Props) {
  const [inspect, setInspect] = useState(false)

  if (!import.meta.env.DEV) return null

  return (
    <aside className="prototype-tools" aria-label="Local prototype controls">
      {inspect && (
        <section className="prototype-inspector" aria-label="Prototype state and research">
          <button
            className="prototype-close"
            onClick={() => setInspect(false)}
            aria-label="Close inspector"
          >
            <X size={20} />
          </button>
          {children}
        </section>
      )}
      <div className="prototype-toolbar">
        <div className="prototype-current">
          <small>LOCAL PROTOTYPE / NOTHING SAVED</small>
          <strong>A / Spell lock</strong>
        </div>
        <span className="prototype-tool-divider" />
        <button
          className="prototype-demo"
          onClick={onDemo}
          aria-label="Fill demo code"
          title="Fill demo code"
        >
          Demo
        </button>
        <button onClick={onReset} aria-label="Reset prototype" title="Reset prototype">
          <RotateCcw size={18} />
        </button>
        <button
          onClick={() => setInspect(value => !value)}
          aria-expanded={inspect}
          aria-label="Show state and research"
          title="State and research"
        >
          <Code2 size={19} />
        </button>
      </div>
    </aside>
  )
}
