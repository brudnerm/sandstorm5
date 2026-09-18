/**
 * An engraved plaque: the Trophy Room's unit of praise, and with
 * `tone="shame"` its unit of disgrace.
 *
 * Same structure either way — season, title, subtitle, body, footnote — so
 * a champion and a last-place finish are laid out identically and only the
 * metal changes. The shame variant is tarnished grey-green rather than
 * brass, and colder than anything else in the app.
 */
import type { ReactNode } from 'react'
import type { Tone } from '../../lib/trophy'

interface Props {
  /** Usually a season, sometimes a season and week. */
  season?: string
  title: string
  subtitle?: ReactNode
  children?: ReactNode
  /** The traceable detail: where the number came from. */
  footnote?: ReactNode
  tone?: Tone
}

export default function Plaque({
  season, title, subtitle, children, footnote, tone = 'praise',
}: Props) {
  return (
    <article className={`trophy-plaque${tone === 'shame' ? ' shame' : ''}`}>
      {season && <p className="trophy-plaque-season">{season}</p>}
      <h3 className="trophy-plaque-title">{title}</h3>
      {subtitle && <p className="trophy-plaque-sub">{subtitle}</p>}
      {children && <div className="trophy-plaque-body">{children}</div>}
      {footnote && <p className="trophy-plaque-foot">{footnote}</p>}
    </article>
  )
}
