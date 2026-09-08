import { randomBytes } from 'crypto'
import { AccessToken, AgentDispatchClient } from 'livekit-server-sdk'

const URL_KEYS = ['LIVEKIT_URL', 'LIVEKIT_WS_URL']
const PUBLIC_URL_KEYS = ['LIVEKIT_PUBLIC_URL', 'LIVEKIT_CLIENT_URL']
const API_KEY_KEYS = ['LIVEKIT_API_KEY', 'LIVEKIT_API_KEY_ID']
const API_SECRET_KEYS = ['LIVEKIT_API_SECRET', 'LIVEKIT_API_KEY_SECRET']

const AGENT_ENV_BY_LANGUAGE = {
  ENGLISH: ['LIVEKIT_AGENT_ENGLISH', 'LIVEKIT_AGENT_NAME'],
  FRENCH: ['LIVEKIT_AGENT_FRENCH'],
  ARABIC: ['LIVEKIT_AGENT_ARABIC'],
}

const VOICE_LANGUAGES = ['ENGLISH', 'FRENCH', 'ARABIC']

function readFirstEnv(keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return { key, value }
  }
  return null
}

/** Server SDK calls need https:// — convert wss:// from dashboard or local server. */
export function toLiveKitHttpUrl(url) {
  const trimmed = url?.trim()
  if (!trimmed) return trimmed
  if (trimmed.startsWith('wss://')) return `https://${trimmed.slice('wss://'.length)}`
  if (trimmed.startsWith('ws://')) return `http://${trimmed.slice('ws://'.length)}`
  return trimmed
}

export function resolveAgentNameForLanguage(language) {
  const lang = VOICE_LANGUAGES.includes(language) ? language : 'ENGLISH'
  const envKeys = AGENT_ENV_BY_LANGUAGE[lang] ?? AGENT_ENV_BY_LANGUAGE.ENGLISH
  for (const envKey of envKeys) {
    const name = process.env[envKey]?.trim()
    if (name) return name
  }
  return null
}

function getAgentsByLanguage() {
  const agents = {}
  for (const lang of VOICE_LANGUAGES) {
    agents[lang] = Boolean(resolveAgentNameForLanguage(lang))
  }
  return agents
}

/** Browser WebSocket URL — may differ from internal LIVEKIT_URL when proxied later. */
function getClientConnectUrl() {
  return readFirstEnv(PUBLIC_URL_KEYS)?.value ?? readFirstEnv(URL_KEYS)?.value ?? null
}

export function getVoiceConfigStatus() {
  const url = readFirstEnv(URL_KEYS)
  const apiKey = readFirstEnv(API_KEY_KEYS)
  const apiSecret = readFirstEnv(API_SECRET_KEYS)
  const agents = getAgentsByLanguage()

  const missing = []
  if (!url) missing.push('LIVEKIT_URL')
  if (!apiKey) missing.push('LIVEKIT_API_KEY')
  if (!apiSecret) missing.push('LIVEKIT_API_SECRET')

  return {
    configured: missing.length === 0,
    missing,
    connectUrl: getClientConnectUrl(),
    agents,
    agentConfigured: Object.values(agents).some(Boolean),
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
    clientConnectUrl: getClientConnectUrl(),
    apiKey: readFirstEnv(API_KEY_KEYS).value,
    apiSecret: readFirstEnv(API_SECRET_KEYS).value,
  }
}

export function isVoiceConfigured() {
  return getVoiceConfigStatus().configured
}

async function dispatchVoiceAgent(sessionId, connectUrl, apiKey, apiSecret, agentName) {
  const httpUrl = toLiveKitHttpUrl(connectUrl)
  const dispatch = new AgentDispatchClient(httpUrl, apiKey, apiSecret)
  await dispatch.createDispatch(sessionId, agentName)
}

export async function createVoiceSession({ participantId, participantName, language = 'ENGLISH' }) {
  const { connectUrl, clientConnectUrl, apiKey, apiSecret } = getVoiceConfig()
  const resolvedLanguage = VOICE_LANGUAGES.includes(language) ? language : 'ENGLISH'

  if (!participantId?.trim()) {
    const err = new Error('Participant id is required')
    err.status = 400
    throw err
  }

  const agentName = resolveAgentNameForLanguage(resolvedLanguage)
  const sessionId = `numa-${resolvedLanguage.toLowerCase()}-${randomBytes(8).toString('hex')}`
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

  const agent = {
    language: resolvedLanguage,
    configured: Boolean(agentName),
    dispatched: false,
  }

  if (agentName) {
    try {
      await dispatchVoiceAgent(sessionId, connectUrl, apiKey, apiSecret, agentName)
      agent.dispatched = true
    } catch (err) {
      console.error(`Voice agent dispatch failed (${resolvedLanguage}):`, err.message)
      agent.error = err.message
    }
  }

  return {
    sessionId,
    connectUrl: clientConnectUrl,
    accessToken: await token.toJwt(),
    agent,
  }
}

export function logVoiceConfigOnStartup() {
  const status = getVoiceConfigStatus()
  if (!status.configured) {
    console.log(`  Voice: not configured (missing ${status.missing.join(', ')})`)
    return
  }
  console.log(`  Voice: configured (${status.connectUrl})`)
  for (const lang of VOICE_LANGUAGES) {
    const name = resolveAgentNameForLanguage(lang)
    console.log(`  Voice agent ${lang}: ${name ?? 'not configured'}`)
  }
}
