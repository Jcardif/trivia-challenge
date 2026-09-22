export default function AdventurerCode({ code }: { code: string }) {
  return (
    <section
      data-telemetry-private
      aria-label="Private adventurer code"
      className="rounded-2xl border border-amber-200/30 bg-black/30 px-6 py-5 text-center"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-amber-200">
        Your adventurer code
      </p>
      <p className="mt-2 font-mono text-3xl font-bold tracking-[0.2em] text-white">{code}</p>
      <p className="mt-3 text-sm text-white/65">
        Keep this code and your three-rune spell private. You need both to return as the same
        adventurer.
      </p>
    </section>
  )
}
