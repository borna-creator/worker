import { randomBytes } from 'crypto'
import { AccessToken, AgentDispatchClient } from 'livekit-server-sdk'

function getVoiceConfig() {
  const connectUrl = process.env.LIVEKIT_URL?.trim()
  const apiKey = process.env.LIVEKIT_API_KEY?.trim()
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim()

  if (!connectUrl || !apiKey || !apiSecret) {
    const err = new Error('Voice service is not configured on the worker')
    err.status = 503
    throw err
  }

  return { connectUrl, apiKey, apiSecret }
}

export function isVoiceConfigured() {
  try {
    getVoiceConfig()
    return true
  } catch {
    return false
  }
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
