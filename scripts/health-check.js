const port = process.env.WORKER_PORT || 4000
const url = `http://127.0.0.1:${port}/health`

const res = await fetch(url)
const body = await res.json()

if (!res.ok) {
  console.error(`Health check failed (${res.status}):`, body)
  process.exit(1)
}

console.log('Worker is healthy:', body)
