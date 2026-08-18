/** Standalone copy of shared/sttSettings.js for VPS 2 deploys. Keep in sync. */

export const DEFAULT_STT_SETTINGS = Object.freeze({
  summarize: true,
  detectEntities: true,
  sentiment: true,
  smartFormat: true,
  diarize: true,
  punctuate: true,
  paragraphs: true,
  utterances: true,
  profanityFilter: true,
  fillerWords: true,
  numerals: true,
  redactPci: true,
  redactPii: true,
  redactPhi: true,
  redactNumbers: true,
})

export function normalizeSttSettings(input) {
  const base = { ...DEFAULT_STT_SETTINGS }
  if (input == null || typeof input !== 'object') return base

  for (const key of Object.keys(DEFAULT_STT_SETTINGS)) {
    if (key in input) base[key] = Boolean(input[key])
  }
  if (base.paragraphs) base.punctuate = true
  return base
}

export function scorecardLanguageToDeepgram(language) {
  switch (language) {
    case 'ARABIC':
      return 'ar'
    case 'FRENCH':
      return 'fr'
    default:
      return 'en'
  }
}

export function buildDeepgramListenOptions(sttSettings, languageCode) {
  const settings = normalizeSttSettings(sttSettings)
  const redact = []
  if (settings.redactPci) redact.push('pci')
  if (settings.redactPii) redact.push('pii')
  if (settings.redactPhi) redact.push('phi')
  if (settings.redactNumbers) redact.push('numbers')

  const options = {
    model: 'nova-3',
    language: languageCode,
    smart_format: settings.smartFormat,
    diarize: settings.diarize,
    punctuate: settings.punctuate,
    paragraphs: settings.paragraphs,
    utterances: settings.utterances,
    profanity_filter: settings.profanityFilter,
    filler_words: settings.fillerWords,
    numerals: settings.numerals,
  }

  if (settings.summarize) options.summarize = 'v2'
  if (settings.detectEntities) options.detect_entities = true
  if (settings.sentiment) options.sentiment = true
  if (redact.length > 0) options.redact = redact

  return options
}
