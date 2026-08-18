const DEFAULT_DEEPINFRA_URL = 'https://api.deepinfra.com/v1/openai/chat/completions'
const DEFAULT_DEEPINFRA_MODEL = 'deepseek-ai/DeepSeek-V4-Flash'

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

export async function chatCompletionJson({ system, user, temperature = 0.2 }) {
  const { apiKey, model, apiUrl } = getDeepInfraConfig()

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`DeepInfra API error (${response.status}): ${body}`)
  }

  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('DeepInfra returned an empty response')
  }

  try {
    return JSON.parse(content)
  } catch {
    throw new Error('DeepInfra returned invalid JSON')
  }
}
