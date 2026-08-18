import 'dotenv/config'
import express from 'express'
import { WORKER_CALLBACK_HEADER } from './contract.js'
import { processMockJob } from './mockPipeline.js'

const app = express()
const PORT = Number(process.env.WORKER_PORT || 4000)

app.use(express.json({ limit: '1mb' }))

function requireWorkerSecret(req, res, next) {
  const secret = req.get(WORKER_CALLBACK_HEADER)
  if (!secret || secret !== process.env.WORKER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', mode: 'mock', version: '0.1.0' })
})

app.post('/jobs', requireWorkerSecret, async (req, res) => {
  const job = req.body

  if (!job?.jobId || !job?.audioUrl || !job?.callbackUrl || !job?.scorecard) {
    return res.status(400).json({ error: 'Invalid job payload' })
  }

  res.status(202).json({ accepted: true, jobId: job.jobId })

  setImmediate(async () => {
    try {
      await processMockJob(job)
      console.log(`✓ Job ${job.jobId} completed (mock)`)
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

if (!process.env.WORKER_SECRET) {
  console.error('WORKER_SECRET is required — copy .env.example to .env')
  process.exit(1)
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ NumaIQ worker listening on http://0.0.0.0:${PORT}`)
  console.log('  Mode: mock (Phase 2) — replace mockPipeline.js with Nova + DeepSeek in Phase 3')
})
