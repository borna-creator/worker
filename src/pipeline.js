import { WORKER_CALLBACK_HEADER } from './contract.js'
import { transcribeAudio } from './deepgram.js'
import { scoreTranscript } from './deepseek.js'
import { processMockJob } from './mockPipeline.js'

export function getWorkerMode() {
  if (process.env.WORKER_MODE === 'mock') return 'mock'
  if (process.env.DEEPGRAM_API_KEY && process.env.DEEPSEEK_API_KEY) return 'live'
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
  const results = await scoreTranscript(job.scorecard, transcript.fullText)

  return postCallback(job, {
    status: 'COMPLETED',
    transcript,
    results,
  })
}
