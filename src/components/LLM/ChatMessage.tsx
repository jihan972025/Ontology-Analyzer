import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { User, Bot } from 'lucide-react'
import type { ChatMessage } from '../../types/llm'

interface Props {
  message: ChatMessage
}

export default function ChatMessageBubble({ message }: Props) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
        isUser
          ? 'bg-angel-600/30 text-angel-400'
          : 'bg-violet-600/30 text-violet-400'
      }`}>
        {isUser ? <User size={12} /> : <Bot size={12} />}
      </div>

      {/* Bubble */}
      <div className={`flex-1 min-w-0 ${isUser ? 'text-right' : ''}`}>
        <div className={`inline-block text-left rounded-lg px-3 py-2 text-xs leading-relaxed max-w-full ${
          isUser
            ? 'bg-angel-600/15 text-slate-200 border border-angel-500/20'
            : 'bg-slate-800/60 text-slate-300 border border-slate-700/50'
        }`}>
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <div className="prose prose-invert prose-xs max-w-none
              prose-p:my-1 prose-p:text-xs prose-p:leading-relaxed
              prose-headings:text-slate-200 prose-headings:mt-2 prose-headings:mb-1
              prose-h1:text-sm prose-h2:text-xs prose-h3:text-xs
              prose-code:text-[11px] prose-code:bg-slate-700/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-violet-300
              prose-pre:bg-slate-900/80 prose-pre:border prose-pre:border-slate-700/50 prose-pre:rounded-md prose-pre:p-2 prose-pre:my-1.5
              prose-pre:overflow-x-auto
              prose-li:my-0.5 prose-li:text-xs
              prose-ul:my-1 prose-ol:my-1
              prose-strong:text-slate-200
              prose-a:text-angel-400 prose-a:no-underline hover:prose-a:underline
              prose-blockquote:border-slate-600 prose-blockquote:text-slate-400 prose-blockquote:my-1
              prose-table:text-[11px]
              prose-th:text-slate-300 prose-th:border-slate-600
              prose-td:border-slate-700
            ">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
