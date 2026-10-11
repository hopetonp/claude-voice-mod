// Keep the compact clock, but use the selected language's numeral script.
// Intl defaults to Latin digits for several of these locales, even when their
// settings labels use another script.
const numberingSystems = {
  bho: 'deva', bn: 'beng', gu: 'gujr', hi: 'deva', kn: 'knda',
  ml: 'mlym', mr: 'deva', ta: 'tamldec', te: 'telu', th: 'thai',
  zh: 'hanidec', ja: 'hanidec',
}

export function voiceDuration(seconds, locale = 'en') {
  const value = Math.max(0, Math.floor(Number(seconds) || 0))
  const language = String(locale).replace(/_/g, '-').split('-')[0].toLowerCase()
  const numberingSystem = numberingSystems[language]
  const options = { useGrouping: false, ...(numberingSystem ? { numberingSystem } : {}) }
  try {
    const minutes = new Intl.NumberFormat(locale, options)
    const remainingSeconds = new Intl.NumberFormat(locale, { ...options, minimumIntegerDigits: 2 })
    return `${minutes.format(Math.floor(value / 60))}:${remainingSeconds.format(value % 60)}`
  } catch {
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
  }
}
