/**
 * The label above every unit in the Trophy Room: a small brass eyebrow, a
 * serif title, and an optional note for the thing a reader needs to know
 * before they trust the numbers underneath (a qualifier, a season span, a
 * gap in the data).
 */
import type { Tone } from '../../lib/trophy'

interface Props {
  eyebrow?: string
  title: string
  note?: string
  tone?: Tone
  /** Heading level, so a page keeps one h1 and a sane outline. */
  as?: 'h1' | 'h2' | 'h3'
}

export default function SectionHeader({ eyebrow, title, note, tone = 'praise', as = 'h2' }: Props) {
  const Heading = as
  return (
    <header className={`trophy-section-head${tone === 'shame' ? ' shame' : ''}`}>
      {eyebrow && <p className="trophy-eyebrow">{eyebrow}</p>}
      <Heading className="trophy-section-title">{title}</Heading>
      {note && <p className="trophy-section-note">{note}</p>}
    </header>
  )
}
