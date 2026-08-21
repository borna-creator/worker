import { randomBytes } from 'crypto'
import { AccessToken, AgentDispatchClient } from 'livekit-server-sdk'

const URL_KEYS = ['LIVEKIT_URL', 'LIVEKIT_WS_URL']
const API_KEY_KEYS = ['LIVEKIT_API_KEY', 'LIVEKIT_API_KEY_ID']
const API_SECRET_KEYS = ['LIVEKIT_API_SECRET', 'LIVEKIT_API_KEY_SECRET']

function readFirstEnv(keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return { key, value }
  }
  return null
}

export function getVoiceConfigStatus() {
  const url = readFirstEnv(URL_KEYS)
  const apiKey = readFirstEnv(API_KEY_KEYS)
  const apiSecret = readFirstEnv(API_SECRET_KEYS)

  const missing = []
  if (!url) missing.push('LIVEKIT_URL')
  if (!apiKey) missing.push('LIVEKIT_API_KEY')
  if (!apiSecret) missing.push('LIVEKIT_API_SECRET')

  return {
    configured: missing.length === 0,
    missing,
    connectUrl: url?.value ?? null,
  }
}

function getVoiceConfig() {
  const status = getVoiceConfigStatus()
  if (!status.configured) {
    const err = new Error(`Voice service is not configured on the worker (missing: ${status.missing.join(', ')})`)
    err.status = 503
    err.missing = status.missing
    throw err
  }

  return {
    connectUrl: readFirstEnv(URL_KEYS).value,
    apiKey: readFirstEnv(API_KEY_KEYS).value,
    apiSecret: readFirstEnv(API_SECRET_KEYS).value,
  }
}

export function isVoiceConfigured() {
  return getVoiceConfigStatus().configured
}

export async function createVoiceSession({ participantId, participantName }) {
  const { connectUrl, apiKey, apiSecret } = getVoiceConfig()

  if (!participantId?.trim()) {
    const err = new Error('Participant id is required')
    err.status = 400
    throw err
  }

  const sessionId = `numa-${randomBytes(8).toString('hex')}`
  const identity = String(participantId).trim()
  const name = participantName?.trim() || 'Super Admin'

  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl: '30m',
  })

  token.addGrant({
    room: sessionId,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  })

  const agentName = process.env.LIVEKIT_AGENT_NAME?.trim()
  if (agentName) {
    try {
      const dispatch = new AgentDispatchClient(connectUrl, apiKey, apiSecret)
      await dispatch.createDispatch(sessionId, agentName)
    } catch (err) {
      console.warn('Voice agent dispatch failed:', err.message)
    }
  }

  return {
    sessionId,
    connectUrl,
    accessToken: await token.toJwt(),
  }
}

export function logVoiceConfigOnStartup() {
  const status = getVoiceConfigStatus()
  if (status.configured) {
    console.log(`  Voice: configured (${status.connectUrl})`)
    return
  }
  console.log(`  Voice: not configured (missing ${status.missing.join(', ')})`)
}
