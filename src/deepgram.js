import { DeepgramClient } from '@deepgram/sdk'
import {
  buildDeepgramListenOptions,
  normalizeSttSettings,
  scorecardLanguageToDeepgram,
} from './sttSettings.js'

function getDeepgramClient() {
  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) {
    throw new Error('DEEPGRAM_API_KEY is not configured on the worker')
  }
  return new DeepgramClient({ apiKey })
}

function speakerLabel(speaker) {
  if (speaker == null) return 'unknown'
  return `speaker_${speaker}`
}

function buildSpeakerSegments(utterances) {
  if (!Array.isArray(utterances)) return []

  return utterances.map((u) => ({
    speaker: speakerLabel(u.speaker),
    startSec: u.start,
    endSec: u.end,
    text: u.transcript,
    sentiment: u.sentiment ?? null,
    sentimentScore: u.sentiment_score ?? null,
  }))
}

function normalizeOverallSentiment(sentiments) {
  if (!sentiments) return null

  const average = sentiments.average
  if (average && typeof average === 'object') {
    return {
      average: average.sentiment ?? null,
      sentiment_score: average.sentiment_score ?? null,
    }
  }

  if (typeof sentiments.sentiment === 'string') {
    return {
      average: sentiments.sentiment,
      sentiment_score: sentiments.sentiment_score ?? null,
    }
  }

  return sentiments
}

export function parseDeepgramResponse(result, sttSettings) {
  const settings = normalizeSttSettings(sttSettings)
  const alt = result?.results?.channels?.[0]?.alternatives?.[0]
  const fullText = alt?.transcript?.trim() ?? ''

  if (!fullText) {
    throw new Error('Deepgram returned an empty transcript')
  }

  const segments = {
    summary:
      result?.results?.summary?.short ??
      result?.results?.summary?.result ??
      null,
    sentiment: normalizeOverallSentiment(result?.results?.sentiments),
    entities: settings.detectEntities ? (alt?.entities ?? null) : null,
    paragraphs: settings.paragraphs ? (alt?.paragraphs?.transcript ?? null) : null,
    utterances: settings.utterances ? (result?.results?.utterances ?? null) : null,
    speakers: buildSpeakerSegments(result?.results?.utterances),
    metadata: {
      duration: result?.metadata?.duration ?? null,
      model: result?.metadata?.model_info ?? null,
    },
  }

  return { fullText, segments }
}

export async function transcribeAudio(buffer, mimeType, scorecard) {
  const languageCode = scorecardLanguageToDeepgram(scorecard.language)
  const options = buildDeepgramListenOptions(scorecard.sttSettings, languageCode)
  const deepgram = getDeepgramClient()

  const response = await deepgram.listen.v1.media.transcribeFile(buffer, options)

  const result = response?.data ?? response
  return parseDeepgramResponse(result, scorecard.sttSettings)
}
