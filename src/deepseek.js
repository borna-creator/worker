import { chatCompletionJson } from './deepinfra.js'

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

  return `You are a QA analyst scoring a phone call against a scorecard.

Scorecard: ${scorecard.name}
Language: ${scorecard.language}

Criteria:
${criteriaBlock}

Call transcript:
"""
${transcriptText}
"""

Return JSON only:
{
  "results": [
    {
      "criterionId": "<exact id from list>",
      "value": "<allowed answer for that criterion type>",
      "passed": true or false,
      "reasoning": "<brief evidence from the transcript>"
    }
  ]
}

Include exactly one result per criterion, in the same order as listed.`
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
  const parsed = await chatCompletionJson({
    system: 'You score call center QA criteria from transcripts. Respond with valid JSON only.',
    user: buildScoringPrompt(scorecard, transcriptText),
    temperature: 0.2,
  })

  const rawResults = parsed?.results
  if (!Array.isArray(rawResults) || rawResults.length === 0) {
    throw new Error('DeepInfra response missing results array')
  }

  const byId = new Map(rawResults.map((r) => [r.criterionId, r]))

  return scorecard.criteria.map((criterion) => {
    const raw = byId.get(criterion.id) ?? rawResults[scorecard.criteria.indexOf(criterion)]
    if (!raw) {
      throw new Error(`Missing score for criterion "${criterion.label}"`)
    }
    return normalizeResult(raw, criterion)
  })
}
