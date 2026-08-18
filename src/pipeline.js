import { WORKER_CALLBACK_HEADER } from './contract.js'
import { transcribeAudio } from './deepgram.js'
import { scoreTranscript } from './deepseek.js'
import { assignSpeakerRoles, enrichTranscriptWithRoles } from './speakerRoles.js'
import { compactTranscriptForCallback } from './transcriptCompact.js'
import { processMockJob } from './mockPipeline.js'

function llmApiKey() {
  return (process.env.DEEPINFRA_API_KEY || process.env.DEEPSEEK_API_KEY || '').trim()
}

export function getWorkerModeReasons() {
  if (process.env.WORKER_MODE === 'mock') {
    return ['WORKER_MODE is set to mock']
  }

  const reasons = []
  if (!process.env.DEEPGRAM_API_KEY?.trim()) {
    reasons.push('DEEPGRAM_API_KEY is missing or empty')
  }
  if (!llmApiKey()) {
    reasons.push('DEEPINFRA_API_KEY is missing or empty (DEEPSEEK_API_KEY also accepted)')
  }
  return reasons
}

export function getWorkerMode() {
  if (getWorkerModeReasons().length === 0) return 'live'
  return 'mock'
}

async function postCallback(job, body) {
  const callbackResponse = await fetch(job.callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [WORKER_CALLBACK_HEADER]: process.env.WORKER_SECRET,
    },
    body: JSON.stringify(body),
  })

  if (!callbackResponse.ok) {
    const text = await callbackResponse.text()
    throw new Error(`Callback failed (${callbackResponse.status}): ${text}`)
  }

  return callbackResponse.json()
}

export async function processJob(job) {
  if (getWorkerMode() === 'mock') {
    return processMockJob(job)
  }

  const audioResponse = await fetch(job.audioUrl)
  if (!audioResponse.ok) {
    throw new Error(`Failed to download audio (${audioResponse.status})`)
  }

  const mimeType = audioResponse.headers.get('content-type') || 'audio/mpeg'
  const buffer = Buffer.from(await audioResponse.arrayBuffer())

  const transcript = await transcribeAudio(buffer, mimeType, job.scorecard)

  const [results, enrichedTranscript] = await Promise.all([
    scoreTranscript(job.scorecard, transcript.fullText),
    assignSpeakerRoles(transcript)
      .then((roleMap) => enrichTranscriptWithRoles(transcript, roleMap))
      .catch((err) => {
        console.warn(`Speaker role assignment failed for job ${job.jobId}:`, err.message)
        return transcript
      }),
  ])

  return postCallback(job, {
    status: 'COMPLETED',
    transcript: compactTranscriptForCallback(enrichedTranscript),
    results,
  })
}
