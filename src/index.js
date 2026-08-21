import 'dotenv/config'
import express from 'express'
import { WORKER_CALLBACK_HEADER } from './contract.js'
import { getWorkerMode, getWorkerModeReasons, processJob } from './pipeline.js'
import { enqueueJob, getQueueStats } from './jobQueue.js'
import { createVoiceSession, getVoiceConfigStatus, logVoiceConfigOnStartup } from './voiceSession.js'

const app = express()
const PORT = Number(process.env.WORKER_PORT || 4000)
const workerMode = getWorkerMode()

app.use(express.json({ limit: '1mb' }))

function requireWorkerSecret(req, res, next) {
  const secret = req.get(WORKER_CALLBACK_HEADER)
  if (!secret || secret !== process.env.WORKER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

app.get('/health', (_req, res) => {
  const mode = getWorkerMode()
  const voice = getVoiceConfigStatus()
  res.json({
    status: 'ok',
    mode,
    version: '0.2.0',
    queue: getQueueStats(),
    voice: { configured: voice.configured },
    ...(mode === 'mock' ? { modeReasons: getWorkerModeReasons() } : {}),
  })
})

app.post('/jobs', requireWorkerSecret, async (req, res) => {
  const job = req.body

  if (!job?.jobId || !job?.audioUrl || !job?.callbackUrl || !job?.scorecard) {
    return res.status(400).json({ error: 'Invalid job payload' })
  }

  res.status(202).json({ accepted: true, jobId: job.jobId })

  enqueueJob(async () => {
    try {
      await processJob(job)
      console.log(`✓ Job ${job.jobId} completed (${workerMode})`)
    } catch (err) {
      console.error(`✗ Job ${job.jobId} failed:`, err.message)
      try {
        await fetch(job.callbackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [WORKER_CALLBACK_HEADER]: process.env.WORKER_SECRET,
          },
          body: JSON.stringify({
            status: 'FAILED',
            errorMessage: err.message,
          }),
        })
      } catch (callbackErr) {
        console.error(`✗ Callback for ${job.jobId} failed:`, callbackErr.message)
      }
    }
  })
})

app.get('/voice/status', requireWorkerSecret, (_req, res) => {
  const voice = getVoiceConfigStatus()
    res.json({
      available: voice.configured,
      missing: voice.configured ? undefined : voice.missing,
      agentConfigured: voice.agentConfigured,
    })
})

app.post('/voice/session', requireWorkerSecret, async (req, res) => {
  try {
    const session = await createVoiceSession(req.body ?? {})
    res.json({ session })
  } catch (err) {
    console.error('Voice session error:', err.message)
    res.status(err.status || 503).json({ error: 'Voice service unavailable' })
  }
})

if (!process.env.WORKER_SECRET) {
  console.error('WORKER_SECRET is required — copy .env.example to .env')
  process.exit(1)
}

app.listen(PORT, '0.0.0.0', () => {
  const { maxConcurrent } = getQueueStats()
  console.log(`✓ NumaIQ worker listening on http://0.0.0.0:${PORT}`)
  console.log(`  Concurrency: ${maxConcurrent} jobs at a time`)
  console.log(`  Mode: ${workerMode}`)
  logVoiceConfigOnStartup()
  if (workerMode === 'mock') {
    for (const reason of getWorkerModeReasons()) {
      console.log(`  Mock reason: ${reason}`)
    }
    console.log('  Set DEEPGRAM_API_KEY + DEEPINFRA_API_KEY (or unset WORKER_MODE=mock) for live scoring')
  }
})
