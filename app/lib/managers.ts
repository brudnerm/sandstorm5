/**
 * Yahoo manager nicknames → what the league actually calls people.
 *
 * Yahoo carries whatever nickname each manager set years ago, so the
 * standings read "angel escobar" and "Rich Garcis". Anyone not listed here
 * already goes by their Yahoo nickname (KC, Mark, Nick, Galen, Jamison,
 * mike, joey), so they fall through unchanged.
 */
const DISPLAY_NAMES: Record<string, string> = {
  'angel escobar': 'Brudner',
  'Swan': 'Hingston',
  'Rich Garcis': 'Dan',
  'Brian Bennett': 'Bennett',
  'Will Youmans': 'Will',
}

export function managerName(yahooNickname: string): string {
  return DISPLAY_NAMES[yahooNickname] ?? yahooNickname
}
