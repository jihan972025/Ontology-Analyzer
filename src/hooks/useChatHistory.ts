import { useState, useCallback, useRef } from 'react'
import type { ChatMessage, ChatContext, LLMProviderConfig } from '../types/llm'
import { LLM_PROVIDERS } from '../types/llm'

const BASE_URL = 'http://127.0.0.1:8766'

export function useChatHistory(getActiveConfig: () => LLMProviderConfig | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(async (content: string, context?: ChatContext) => {
    const config = getActiveConfig()
    if (!config) {
      setError('No LLM provider configured. Open Settings to configure.')
      return
    }

    setError(null)

    // Add user message
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    const prevMessages = [...messages, userMsg]
    setMessages(prevMessages)

    // Start streaming
    setIsStreaming(true)
    setStreamingContent('')
    abortRef.current = new AbortController()

    const provider = LLM_PROVIDERS.find(p => p.id === config.providerId)

    try {
      const apiMessages = prevMessages.map(m => ({
        role: m.role,
        content: m.content,
      }))

      const response = await fetch(`${BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          provider: {
            provider_id: config.providerId,
            api_key: config.apiKey,
            model: config.model,
            endpoint_url: config.endpointUrl,
            api_format: provider?.apiFormat || 'openai',
          },
          context,
          stream: true,
        }),
        signal: abortRef.current.signal,
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(errText || `HTTP ${response.status}`)
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        const lines = text.split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            if (parsed.error) {
              setError(parsed.error)
              break
            }
            if (parsed.content) {
              accumulated += parsed.content
              setStreamingContent(accumulated)
            }
          } catch { /* skip unparseable */ }
        }
      }

      // Finalize assistant message
      if (accumulated) {
        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: accumulated,
          timestamp: Date.now(),
        }
        setMessages(prev => [...prev, assistantMsg])
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Failed to send message')
      }
    } finally {
      setIsStreaming(false)
      setStreamingContent('')
      abortRef.current = null
    }
  }, [messages, getActiveConfig])

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clearHistory = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return { messages, isStreaming, streamingContent, error, sendMessage, abort, clearHistory }
}
