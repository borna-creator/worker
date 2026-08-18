/** HTTP header VPS 1 expects on callbacks. Must match server/routes/internal.js */
export const WORKER_CALLBACK_HEADER = 'x-worker-secret'

/**
 * @typedef {{ speaker: string, startSec: number, endSec: number, text: string }} TranscriptSegment
 */

/**
 * @typedef {{
 *   criterionId: string
 *   value: string
 *   passed?: boolean
 *   reasoning?: string
 * }} CriterionResultPayload
 */

/**
 * @typedef {{
 *   jobId: string
 *   callId: string
 *   organizationId: string
 *   audioUrl: string
 *   callbackUrl: string
 *   scorecard: {
 *     id: string
 *     name: string
 *     language: string
 *     criteria: Array<{
 *       id: string
 *       label: string
 *       description: string | null
 *       questionType: string
 *       weight: number
 *     }>
 *   }
 * }} WorkerJobPayload
 */

/**
 * @typedef {{
 *   status: 'COMPLETED' | 'FAILED'
 *   transcript?: { fullText: string, segments?: TranscriptSegment[] }
 *   results?: CriterionResultPayload[]
 *   errorMessage?: string
 * }} WorkerCallbackPayload
 */
