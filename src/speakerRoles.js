import { chatCompletionJson, extractArrayField, formatMissingArrayError } from './deepinfra.js'

const MAX_SAMPLES_PER_SPEAKER = 8
const MAX_SAMPLE_CHARS = 220

function speakerId(raw) {
  if (raw == null) return 'unknown'
  return String(raw.speaker ?? raw).trim() || 'unknown'
}

function turnText(raw) {
  return (raw.text ?? raw.transcript ?? '').trim()
}

/** Collect diarized turns from a transcript payload. */
export function getDiarizedTurns(transcript) {
  if (!transcript) return []

  const segments = transcript.segments
  let raw = []

  if (segments && typeof segments === 'object' && !Array.isArray(segments)) {
    if (Array.isArray(segments.speakers) && segments.speakers.length > 0) {
      raw = segments.speakers
    } else if (Array.isArray(segments.utterances) && segments.utterances.length > 0) {
      raw = segments.utterances.map((u) => ({
        speaker: u.speaker,
        text: u.transcript,
      }))
    }
  } else if (Array.isArray(segments) && segments.length > 0) {
    raw = segments
  }

  return raw
    .map((item) => ({ speaker: speakerId(item), text: turnText(item) }))
    .filter((item) => item.text)
}

function truncate(text) {
  if (text.length <= MAX_SAMPLE_CHARS) return text
  return `${text.slice(0, MAX_SAMPLE_CHARS - 1)}…`
}

function buildRolePrompt(turns) {
  const bySpeaker = new Map()
  for (const turn of turns) {
    if (!bySpeaker.has(turn.speaker)) bySpeaker.set(turn.speaker, [])
    const lines = bySpeaker.get(turn.speaker)
    if (lines.length < MAX_SAMPLES_PER_SPEAKER) {
      lines.push(truncate(turn.text))
    }
  }

  const speakerBlocks = [...bySpeaker.entries()]
    .map(([id, lines]) => `${id}:\n${lines.map((line) => `- "${line}"`).join('\n')}`)
    .join('\n\n')

  return `You analyze phone call transcripts with diarized speaker IDs (speaker_0, speaker_1, etc.).

Assign each speaker a short role label (1–3 words) based on what they say. Common call-center roles:
Agent, Customer, Supervisor, Third Party, IVR, Unknown

Rules:
- The person representing the company / answering the call is usually "Agent".
- The person calling for help is usually "Customer".
- Use "Unknown" only when the role is genuinely unclear.
- Return every speaker ID listed below exactly once.

Speakers and sample lines:
${speakerBlocks}

Return JSON only:
{
  "roles": [
    { "speakerId": "speaker_0", "role": "Agent" },
    { "speakerId": "speaker_1", "role": "Customer" }
  ]
}`
}

function normalizeRole(value) {
  const role = String(value ?? '').trim()
  if (!role) return null
  return role
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

const ROLES_JSON_SCHEMA = {
  name: 'speaker_roles',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      roles: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            speakerId: { type: 'string' },
            role: { type: 'string' },
          },
          required: ['speakerId', 'role'],
          additionalProperties: false,
        },
      },
    },
    required: ['roles'],
    additionalProperties: false,
  },
}

function parseRoleMap(parsed, expectedSpeakerIds) {
  const roles = extractArrayField(parsed, ['roles', 'speakers', 'speakerRoles'])
  if (!roles) {
    throw new Error(formatMissingArrayError('roles', ['roles'], parsed))
  }

  const map = {}
  for (const entry of roles) {
    const id = String(entry?.speakerId ?? '').trim()
    const role = normalizeRole(entry?.role)
    if (id && role) map[id] = role
  }

  for (const id of expectedSpeakerIds) {
    if (!map[id]) {
      throw new Error(`Missing role assignment for ${id}`)
    }
  }

  return map
}

export async function assignSpeakerRoles(transcript) {
  const turns = getDiarizedTurns(transcript)
  const speakerIds = [...new Set(turns.map((t) => t.speaker))]

  if (speakerIds.length === 0) {
    return {}
  }

  if (speakerIds.length === 1) {
    return { [speakerIds[0]]: 'Speaker' }
  }

  const parsed = await chatCompletionJson({
    system: 'You assign speaker roles in call center transcripts. Respond with valid JSON only.',
    user: buildRolePrompt(turns),
    temperature: 0.1,
    maxTokens: 1024,
    jsonSchema: ROLES_JSON_SCHEMA,
  })

  return parseRoleMap(parsed, speakerIds)
}

export function enrichTranscriptWithRoles(transcript, roleMap) {
  if (!transcript || !roleMap || Object.keys(roleMap).length === 0) {
    return transcript
  }

  const segments = transcript.segments

  if (Array.isArray(segments)) {
    return {
      ...transcript,
      segments: segments.map((item) => ({
        ...item,
        role: roleMap[speakerId(item)] ?? item.role ?? null,
      })),
    }
  }

  if (!segments || typeof segments !== 'object') {
    return transcript
  }

  const next = {
    ...segments,
    speakerRoles: roleMap,
  }

  if (Array.isArray(next.speakers)) {
    next.speakers = next.speakers.map((item) => ({
      ...item,
      role: roleMap[speakerId(item)] ?? item.role ?? null,
    }))
  }

  return { ...transcript, segments: next }
}
