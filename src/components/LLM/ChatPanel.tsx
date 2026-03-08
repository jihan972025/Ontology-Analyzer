import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageSquare, Settings, Trash2, X, Send, Square, AlertCircle, Info } from 'lucide-react'
import type { ChatContext, LLMProviderConfig } from '../../types/llm'
import { LLM_PROVIDERS } from '../../types/llm'
import { useChatHistory } from '../../hooks/useChatHistory'
import ChatMessageBubble from './ChatMessage'

interface Props {
  context: ChatContext
  activeConfig: LLMProviderConfig | null
  getActiveConfig: () => LLMProviderConfig | null
  onClose: () => void
  onOpenSettings: () => void
}

export default function ChatPanel({ context, activeConfig, getActiveConfig, onClose, onOpenSettings }: Props) {
  const { messages, isStreaming, streamingContent, error, sendMessage, abort, clearHistory } = useChatHistory(getActiveConfig)
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const providerName = activeConfig
    ? LLM_PROVIDERS.find(p => p.id === activeConfig.providerId)?.name || activeConfig.providerId
    : null

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streamingContent])

  // Auto-resize textarea
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
    await sendMessage(text, context)
  }, [input, isStreaming, sendMessage, context])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-700 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare size={13} className="text-angel-400 shrink-0" />
          <span className="text-[11px] font-medium text-white">Chat</span>
          {providerName && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-angel-600/20 text-angel-400 truncate max-w-[80px]" title={`${providerName} — ${activeConfig?.model}`}>
              {activeConfig?.model || providerName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={onOpenSettings}
            className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
            title="LLM Settings"
          >
            <Settings size={12} />
          </button>
          <button
            onClick={clearHistory}
            className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
            title="Clear chat"
          >
            <Trash2 size={12} />
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
            title="Close chat"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Context indicator */}
      {context.selectedNode && (
        <div className="px-3 py-1 border-b border-slate-700/50 flex items-center gap-1.5 text-[10px] text-slate-500 bg-slate-800/30">
          <Info size={9} className="shrink-0" />
          <span className="truncate">
            {context.selectedNode.label} ({context.selectedNode.type})
          </span>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center text-slate-500 text-[11px] mt-8 px-4 space-y-2">
            <MessageSquare size={24} className="mx-auto opacity-30" />
            <p>Ask questions about code structure, dependencies, and analysis results.</p>
            {!activeConfig?.apiKey && activeConfig?.providerId !== 'ollama' && (
              <button
                onClick={onOpenSettings}
                className="text-angel-400 hover:text-angel-300 underline"
              >
                Configure LLM settings first
              </button>
            )}
          </div>
        )}
        {messages.map(msg => (
          <ChatMessageBubble key={msg.id} message={msg} />
        ))}
        {/* Streaming message */}
        {isStreaming && streamingContent && (
          <ChatMessageBubble
            message={{
              id: '_streaming',
              role: 'assistant',
              content: streamingContent,
              timestamp: Date.now(),
            }}
          />
        )}
        {isStreaming && !streamingContent && (
          <div className="flex items-center gap-2 text-slate-500 text-[11px]">
            <div className="flex gap-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span>Thinking...</span>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-1.5 border-t border-red-700/30 bg-red-900/20 flex items-start gap-1.5">
          <AlertCircle size={11} className="shrink-0 text-red-400 mt-0.5" />
          <span className="text-[10px] text-red-400 break-all">{error}</span>
        </div>
      )}

      {/* Input */}
      <div className="px-2 py-2 border-t border-slate-700 shrink-0">
        <div className="flex gap-1.5 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your code..."
            className="flex-1 bg-slate-800 border border-slate-600 rounded px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-angel-500 resize-none leading-relaxed"
            rows={1}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <button
              onClick={abort}
              className="w-7 h-7 rounded flex items-center justify-center bg-red-600/80 hover:bg-red-500 text-white shrink-0"
              title="Stop"
            >
              <Square size={10} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="w-7 h-7 rounded flex items-center justify-center bg-angel-600 hover:bg-angel-500 text-white shrink-0 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Send"
            >
              <Send size={11} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
