const BASE_URL = 'http://127.0.0.1:8766'

export async function testLLMConnection(provider: {
  provider_id: string
  api_key: string
  model: string
  endpoint_url: string
  api_format: string
}): Promise<{ status: string; response?: string; error?: string }> {
  const res = await fetch(`${BASE_URL}/api/chat/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json()
}
