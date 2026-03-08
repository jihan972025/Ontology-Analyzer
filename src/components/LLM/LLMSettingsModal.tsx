import { useState } from 'react'
import { X, Eye, EyeOff, CheckCircle, AlertCircle, Loader2, Zap } from 'lucide-react'
import { LLM_PROVIDERS } from '../../types/llm'
import type { LLMSettings, LLMProviderConfig } from '../../types/llm'
import { testLLMConnection } from '../../api/llmClient'

interface Props {
  settings: LLMSettings
  onUpdateProvider: (providerId: string, config: Partial<LLMProviderConfig>) => void
  onSetActiveProvider: (providerId: string) => void
  onClose: () => void
}

export default function LLMSettingsModal({ settings, onUpdateProvider, onSetActiveProvider, onClose }: Props) {
  const [selectedId, setSelectedId] = useState(settings.activeProviderId)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ status: string; message: string } | null>(null)
  const provider = LLM_PROVIDERS.find(p => p.id === selectedId)!
  const config = settings.providers[selectedId]

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testLLMConnection({
        provider_id: selectedId,
        api_key: config.apiKey,
        model: config.model,
        endpoint_url: config.endpointUrl,
        api_format: provider.apiFormat,
      })
      if (result.status === 'ok') {
        setTestResult({ status: 'ok', message: `Connected! Response: "${result.response}"` })
      } else {
        setTestResult({ status: 'error', message: result.error || 'Connection failed' })
      }
    } catch (err: any) {
      setTestResult({ status: 'error', message: err.message || 'Connection failed' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-[640px] max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-angel-400" />
            <h2 className="text-sm font-semibold text-white">LLM Settings</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Body: two columns */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Provider list */}
          <div className="w-44 border-r border-slate-700 overflow-y-auto shrink-0">
            {LLM_PROVIDERS.map(p => (
              <button
                key={p.id}
                className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between ${
                  selectedId === p.id
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                }`}
                onClick={() => { setSelectedId(p.id); setTestResult(null); setShowKey(false) }}
              >
                <span className="truncate">{p.name}</span>
                {settings.activeProviderId === p.id && (
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0 ml-1" />
                )}
              </button>
            ))}
          </div>

          {/* Right: Configuration form */}
          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-white">{provider.name}</h3>
              {settings.activeProviderId === selectedId ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
                  Active
                </span>
              ) : (
                <button
                  onClick={() => onSetActiveProvider(selectedId)}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-angel-600/20 text-angel-400 border border-angel-500/30 hover:bg-angel-600/30 transition-colors"
                >
                  Set Active
                </button>
              )}
            </div>

            {/* API Key */}
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                API Key {selectedId === 'ollama' && <span className="text-slate-600">(not required for Ollama)</span>}
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={config.apiKey}
                  onChange={e => onUpdateProvider(selectedId, { apiKey: e.target.value })}
                  placeholder={selectedId === 'ollama' ? 'Optional' : 'Enter API key...'}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-2.5 py-1.5 pr-8 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-angel-500"
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            </div>

            {/* Model */}
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Model</label>
              <input
                value={config.model}
                onChange={e => onUpdateProvider(selectedId, { model: e.target.value })}
                placeholder={provider.models[0] || 'Enter model name...'}
                className="w-full bg-slate-800 border border-slate-600 rounded px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-angel-500"
              />
              {provider.models.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {provider.models.slice(0, 5).map(m => (
                    <button
                      key={m}
                      onClick={() => onUpdateProvider(selectedId, { model: m })}
                      className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                        config.model === m
                          ? 'bg-angel-600/20 text-angel-400 border-angel-500/30'
                          : 'bg-slate-800/50 text-slate-500 border-slate-700 hover:text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Endpoint URL */}
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Endpoint URL</label>
              <input
                value={config.endpointUrl}
                onChange={e => onUpdateProvider(selectedId, { endpointUrl: e.target.value })}
                placeholder="https://..."
                className="w-full bg-slate-800 border border-slate-600 rounded px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-angel-500 font-mono"
              />
              {provider.defaultEndpoint && config.endpointUrl !== provider.defaultEndpoint && (
                <button
                  onClick={() => onUpdateProvider(selectedId, { endpointUrl: provider.defaultEndpoint })}
                  className="text-[10px] text-slate-500 hover:text-slate-300 mt-0.5"
                >
                  Reset to default
                </button>
              )}
            </div>

            {/* Test Connection */}
            <div className="pt-2 border-t border-slate-700/50">
              <button
                onClick={handleTest}
                disabled={testing || (!config.apiKey && selectedId !== 'ollama')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded border border-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {testing ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Zap size={12} />
                )}
                <span>Test Connection</span>
              </button>
              {testResult && (
                <div className={`mt-2 flex items-start gap-1.5 text-[11px] ${
                  testResult.status === 'ok' ? 'text-green-400' : 'text-red-400'
                }`}>
                  {testResult.status === 'ok'
                    ? <CheckCircle size={12} className="shrink-0 mt-0.5" />
                    : <AlertCircle size={12} className="shrink-0 mt-0.5" />
                  }
                  <span className="break-all">{testResult.message}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
