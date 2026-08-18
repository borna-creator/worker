const DEFAULT_DEEPINFRA_URL = 'https://api.deepinfra.com/v1/openai/chat/completions'
const DEFAULT_DEEPINFRA_MODEL = 'deepseek-ai/DeepSeek-V4-Flash'
const DEFAULT_MAX_TOKENS = 8192

export function getDeepInfraConfig() {
  const apiKey = (process.env.DEEPINFRA_API_KEY || process.env.DEEPSEEK_API_KEY || '').trim()
  if (!apiKey) {
    throw new Error('DEEPINFRA_API_KEY is not configured on the worker')
  }

  return {
    apiKey,
    model: process.env.DEEPINFRA_MODEL || DEFAULT_DEEPINFRA_MODEL,
    apiUrl: process.env.DEEPINFRA_API_URL || DEFAULT_DEEPINFRA_URL,
  }
}

function extractMessageContent(message) {
  if (!message || typeof message !== 'object') return ''

  const content = message.content
  if (typeof content === 'string' && content.trim()) {
    return content.trim()
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part.text === 'string') return part.text
        return ''
      })
      .join('')
      .trim()
    if (text) return text
  }

  if (typeof message.reasoning_content === 'string' && message.reasoning_content.trim()) {
    return message.reasoning_content.trim()
  }

  return ''
}

export function parseJsonContent(content) {
  const text = String(content ?? '').trim()
  if (!text) {
    throw new Error('DeepInfra returned empty content')
  }

  try {
    return JSON.parse(text)
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenced) {
      return JSON.parse(fenced[1].trim())
    }

    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1))
    }

    throw new Error(`DeepInfra returned invalid JSON: ${text.slice(0, 240)}`)
  }
}

function previewPayload(parsed) {
  if (parsed == null) return 'null'
  if (Array.isArray(parsed)) return `array(${parsed.length})`
  if (typeof parsed === 'object') return `keys: ${Object.keys(parsed).join(', ') || '(none)'}`
  return String(parsed)
}

export async function chatCompletionJson({
  system,
  user,
  temperature = 0.2,
  maxTokens = DEFAULT_MAX_TOKENS,
  jsonSchema = null,
}) {
  const { apiKey, model, apiUrl } = getDeepInfraConfig()

  const body = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }

  if (jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: jsonSchema,
    }
  } else {
    body.response_format = { type: 'json_object' }
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`DeepInfra API error (${response.status}): ${errorBody}`)
  }

  const payload = await response.json()
  const choice = payload?.choices?.[0]
  const content = extractMessageContent(choice?.message)

  if (!content) {
    const finishReason = choice?.finish_reason ?? 'unknown'
    throw new Error(`DeepInfra returned empty content (finish_reason=${finishReason})`)
  }

  try {
    return parseJsonContent(content)
  } catch (err) {
    throw new Error(`${err.message} (raw: ${content.slice(0, 240)})`)
  }
}

export function extractArrayField(parsed, fieldNames) {
  if (Array.isArray(parsed)) return parsed

  for (const field of fieldNames) {
    if (Array.isArray(parsed?.[field]) && parsed[field].length > 0) {
      return parsed[field]
    }
  }

  return null
}

export function formatMissingArrayError(label, fieldNames, parsed) {
  return `DeepInfra response missing ${label} array (expected one of: ${fieldNames.join(', ')}; got ${previewPayload(parsed)})`
}
