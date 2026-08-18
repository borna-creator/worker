import { chatCompletionJson, extractArrayField, formatMissingArrayError } from './deepinfra.js'

const VALID_YES_NO = new Set(['YES', 'NO'])
const VALID_EGP = new Set(['EXCELLENT', 'GOOD', 'POOR'])
const VALID_CONVERSATIONAL = new Set(['DISCUSSED', 'NOT_DISCUSSED', 'PARTIAL'])

function questionTypeInstructions(criterion) {
  switch (criterion.questionType) {
    case 'EXCELLENT_GOOD_POOR':
      return `Answer with EXCELLENT, GOOD, or POOR. Set passed true for EXCELLENT or GOOD.`
    case 'CONVERSATIONAL':
      return `Answer with DISCUSSED, NOT_DISCUSSED, or PARTIAL. Set passed true for DISCUSSED or PARTIAL.`
    default:
      return `Answer with YES or NO. Set passed true only for YES.`
  }
}

function buildScoringPrompt(scorecard, transcriptText) {
  const criteriaBlock = scorecard.criteria
    .map(
      (c, i) =>
        `${i + 1}. id="${c.id}" label="${c.label}" type=${c.questionType}${
          c.description ? ` guidance="${c.description}"` : ''
        } weight=${c.weight}\n   ${questionTypeInstructions(c)}`
    )
    .join('\n')

  const maxTranscriptChars = 28000
  const trimmedTranscript =
    transcriptText.length > maxTranscriptChars
      ? `${transcriptText.slice(0, maxTranscriptChars)}\n\n[Transcript truncated for scoring]`
      : transcriptText

  return `You are a QA analyst scoring a phone call against a scorecard.

Scorecard: ${scorecard.name}
Language: ${scorecard.language}

Criteria:
${criteriaBlock}

Call transcript:
"""
${trimmedTranscript}
"""

Return a JSON object with a "results" array. Include exactly one result per criterion, in the same order as listed. Each result must use the exact criterionId from the list above.

Example JSON shape:
{
  "results": [
    {
      "criterionId": "<exact id from list>",
      "value": "<allowed answer for that criterion type>",
      "passed": true,
      "reasoning": "<brief evidence from the transcript>"
    }
  ]
}`
}

const SCORING_JSON_SCHEMA = {
  name: 'qa_scores',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            criterionId: { type: 'string' },
            value: { type: 'string' },
            passed: { type: 'boolean' },
            reasoning: { type: 'string' },
          },
          required: ['criterionId', 'value', 'passed', 'reasoning'],
          additionalProperties: false,
        },
      },
    },
    required: ['results'],
    additionalProperties: false,
  },
}

function normalizeRawResult(raw, criterion) {
  return {
    criterionId: String(raw?.criterionId ?? raw?.criterion_id ?? raw?.id ?? criterion.id).trim(),
    value: raw?.value,
    passed: raw?.passed,
    reasoning: raw?.reasoning ?? raw?.reason ?? raw?.explanation,
  }
}

function normalizeResult(raw, criterion) {
  const value = String(raw?.value ?? '').trim().toUpperCase()
  let passed = Boolean(raw?.passed)
  const reasoning = String(raw?.reasoning ?? '').trim()

  switch (criterion.questionType) {
    case 'EXCELLENT_GOOD_POOR':
      if (!VALID_EGP.has(value)) {
        throw new Error(`Invalid EGP value for "${criterion.label}": ${raw?.value}`)
      }
      passed = value === 'EXCELLENT' || value === 'GOOD'
      break
    case 'CONVERSATIONAL':
      if (!VALID_CONVERSATIONAL.has(value)) {
        throw new Error(`Invalid conversational value for "${criterion.label}": ${raw?.value}`)
      }
      passed = value === 'DISCUSSED' || value === 'PARTIAL'
      break
    default:
      if (!VALID_YES_NO.has(value)) {
        throw new Error(`Invalid yes/no value for "${criterion.label}": ${raw?.value}`)
      }
      passed = value === 'YES'
  }

  return {
    criterionId: criterion.id,
    value,
    passed,
    reasoning: reasoning || `Scored "${criterion.label}" as ${value}.`,
  }
}

export async function scoreTranscript(scorecard, transcriptText) {
  const request = {
    system:
      'You score call center QA criteria from transcripts. Respond with valid JSON only, using the required schema.',
    user: buildScoringPrompt(scorecard, transcriptText),
    temperature: 0.2,
    maxTokens: 8192,
  }

  let parsed
  try {
    parsed = await chatCompletionJson({ ...request, jsonSchema: SCORING_JSON_SCHEMA })
  } catch (err) {
    if (!String(err.message).includes('400')) throw err
    console.warn('Scoring json_schema rejected, retrying with json_object:', err.message)
    parsed = await chatCompletionJson(request)
  }

  const rawResults = extractArrayField(parsed, ['results', 'criteria', 'scores', 'criteriaResults'])
  if (!rawResults) {
    throw new Error(formatMissingArrayError('results', ['results'], parsed))
  }

  const byId = new Map(
    rawResults.map((raw, index) => {
      const criterion = scorecard.criteria[index]
      const normalized = normalizeRawResult(raw, criterion)
      return [normalized.criterionId, normalized]
    })
  )

  return scorecard.criteria.map((criterion) => {
    const raw =
      byId.get(criterion.id) ??
      normalizeRawResult(rawResults[scorecard.criteria.indexOf(criterion)], criterion)
    if (!raw?.value) {
      throw new Error(`Missing score for criterion "${criterion.label}"`)
    }
    return normalizeResult(raw, criterion)
  })
}
