const MAX_CONCURRENT = Number(process.env.WORKER_CONCURRENCY || 3)

let active = 0
const pending = []

function drain() {
  while (active < MAX_CONCURRENT && pending.length > 0) {
    active += 1
    const run = pending.shift()
    run().finally(() => {
      active -= 1
      drain()
    })
  }
}

/** @param {() => Promise<void>} task */
export function enqueueJob(task) {
  pending.push(task)
  drain()
}

export function getQueueStats() {
  return { active, pending: pending.length, maxConcurrent: MAX_CONCURRENT }
}
