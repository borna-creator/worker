import { WORKER_CALLBACK_HEADER } from './contract.js'
import { compactTranscriptForCallback } from './transcriptCompact.js'

const QUESTION_TYPE_LABELS = {
  YES_NO: 'Yes / No',
  EXCELLENT_GOOD_POOR: 'Excellent / Good / Poor',
  CONVERSATIONAL: 'Conversational',
}

const YES_NO = ['YES', 'NO']
const EGP = ['EXCELLENT', 'GOOD', 'POOR']

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function questionTypeLabel(value) {
  return QUESTION_TYPE_LABELS[value] ?? value
}

function scoreYesNo() {
  const value = pick(YES_NO)
  return { value, passed: value === 'YES' }
}

function scoreEgp() {
  const value = pick(EGP)
  const passed = value === 'EXCELLENT' || value === 'GOOD'
  return { value, passed }
}

function scoreConversational(criterion) {
  const reasoning = `Mock analysis for "${criterion.label}": the agent addressed this topic in the conversation.`
  return { value: 'DISCUSSED', passed: true, reasoning }
}

export function buildMockResults(scorecard) {
  return scorecard.criteria.map((criterion) => {
    let scored
    switch (criterion.questionType) {
      case 'EXCELLENT_GOOD_POOR':
        scored = scoreEgp()
        break
      case 'CONVERSATIONAL':
        scored = scoreConversational(criterion)
        break
      default:
        scored = scoreYesNo()
    }

    const typeLabel = questionTypeLabel(criterion.questionType)
    return {
      criterionId: criterion.id,
      value: scored.value,
      passed: scored.passed,
      reasoning:
        scored.reasoning ??
        `[Mock ${typeLabel}] Evaluated "${criterion.label}" — result: ${scored.value}.`,
    }
  })
}

export function buildMockTranscript(scorecard) {
  const lang =
    scorecard.language === 'ARABIC'
      ? 'Arabic'
      : scorecard.language === 'FRENCH'
        ? 'French'
        : 'English'
  const fullText = `[Mock transcript — ${lang}]\n\nAgent: Thank you for calling, how can I help you today?\nCaller: I have a question about my account.\nAgent: Of course, I'd be happy to help.\n\n(This is placeholder text from the mock worker. Phase 3 will use Nova STT.)`

  return {
    fullText,
    segments: {
      speakers: [
        { speaker: 'speaker_0', role: 'Agent', startSec: 0, endSec: 4, text: 'Thank you for calling, how can I help you today?' },
        { speaker: 'speaker_1', role: 'Customer', startSec: 4, endSec: 9, text: 'I have a question about my account.' },
        { speaker: 'speaker_0', role: 'Agent', startSec: 9, endSec: 13, text: "Of course, I'd be happy to help." },
      ],
      speakerRoles: {
        speaker_0: 'Agent',
        speaker_1: 'Customer',
      },
    },
  }
}

export async function processMockJob(job) {
  const audioResponse = await fetch(job.audioUrl)
  if (!audioResponse.ok) {
    throw new Error(`Failed to download audio (${audioResponse.status})`)
  }

  await audioResponse.arrayBuffer()

  const transcript = buildMockTranscript(job.scorecard)
  const results = buildMockResults(job.scorecard)

  const callbackResponse = await fetch(job.callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [WORKER_CALLBACK_HEADER]: process.env.WORKER_SECRET,
    },
    body: JSON.stringify({
      status: 'COMPLETED',
      transcript: compactTranscriptForCallback(transcript),
      results,
    }),
  })

  if (!callbackResponse.ok) {
    const body = await callbackResponse.text()
    throw new Error(`Callback failed (${callbackResponse.status}): ${body}`)
  }

  return callbackResponse.json()
}
