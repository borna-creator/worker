/** Shrink transcript payload before worker callback — keeps UI fields, drops Deepgram bulk. */
export function compactTranscriptForCallback(transcript) {
  if (!transcript?.fullText) return transcript

  const segments = transcript.segments

  if (!segments) {
    return { fullText: transcript.fullText.trim() }
  }

  if (Array.isArray(segments)) {
    return {
      fullText: transcript.fullText.trim(),
      segments: segments.map((item) => ({
        speaker: item.speaker ?? null,
        role: item.role ?? null,
        startSec: item.startSec ?? item.start ?? null,
        endSec: item.endSec ?? item.end ?? null,
        text: item.text ?? item.transcript ?? '',
      })),
    }
  }

  const compact = {}

  if (segments.summary) compact.summary = segments.summary
  if (segments.sentiment) compact.sentiment = segments.sentiment
  if (segments.speakerRoles) compact.speakerRoles = segments.speakerRoles

  if (Array.isArray(segments.speakers) && segments.speakers.length > 0) {
    compact.speakers = segments.speakers.map((item) => ({
      speaker: item.speaker ?? null,
      role: item.role ?? null,
      startSec: item.startSec ?? null,
      endSec: item.endSec ?? null,
      text: item.text ?? '',
    }))
  }

  return {
    fullText: transcript.fullText.trim(),
    segments: Object.keys(compact).length > 0 ? compact : null,
  }
}
