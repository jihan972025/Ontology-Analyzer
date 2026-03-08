// LLM Provider definition (static registry)
export interface LLMProvider {
  id: string
  name: string
  defaultEndpoint: string
  models: string[]
  apiFormat: 'openai' | 'anthropic' | 'gemini'
}

// User's configured settings for one provider
export interface LLMProviderConfig {
  providerId: string
  apiKey: string
  model: string
  endpointUrl: string
  enabled: boolean
}

// Active LLM settings
export interface LLMSettings {
  activeProviderId: string
  providers: Record<string, LLMProviderConfig>
}

// Chat message
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

// Vulnerability detail for LLM context
export interface ChatVulnerability {
  rule: string
  severity: string
  message: string
  line: number
  file: string
  nodeLabel?: string
}

// Context sent alongside chat messages
export interface ChatContext {
  selectedNode?: {
    id: string
    label: string
    type: string
    file: string
    line?: number
    fanIn?: number
    fanOut?: number
    lines?: number
    dead?: boolean
    vulnCount?: number
  }
  graphSummary?: {
    totalNodes: number
    totalEdges: number
    cycleCount: number
    deadCount: number
    vulnCount: number
    fileCount: number
    nodeTypes: Record<string, number>
  }
  folderPath?: string
  connectedNodes?: {
    label: string
    type: string
    direction: 'incoming' | 'outgoing'
    edgeType: string
  }[]
  vulnerabilities?: ChatVulnerability[]
}

// Provider registry — all supported LLM providers
export const LLM_PROVIDERS: LLMProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    defaultEndpoint: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1', 'o1-mini', 'o3-mini'],
    apiFormat: 'openai',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    defaultEndpoint: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    apiFormat: 'anthropic',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    apiFormat: 'gemini',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    defaultEndpoint: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    apiFormat: 'openai',
  },
  {
    id: 'qwen',
    name: 'Qwen',
    defaultEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long'],
    apiFormat: 'openai',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    defaultEndpoint: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest'],
    apiFormat: 'openai',
  },
  {
    id: 'glm',
    name: 'GLM (Zhipu AI)',
    defaultEndpoint: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4', 'glm-4-flash', 'glm-3-turbo'],
    apiFormat: 'openai',
  },
  {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    defaultEndpoint: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    apiFormat: 'openai',
  },
  {
    id: 'grok',
    name: 'Grok (xAI)',
    defaultEndpoint: 'https://api.x.ai/v1',
    models: ['grok-2', 'grok-2-mini', 'grok-beta'],
    apiFormat: 'openai',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    defaultEndpoint: 'http://localhost:11434/v1',
    models: ['llama3', 'codellama', 'mistral', 'deepseek-coder-v2', 'qwen2'],
    apiFormat: 'openai',
  },
  {
    id: 'custom',
    name: 'Custom / Local LLM',
    defaultEndpoint: '',
    models: [],
    apiFormat: 'openai',
  },
]

// Default settings factory
export function getDefaultSettings(): LLMSettings {
  const providers: Record<string, LLMProviderConfig> = {}
  for (const p of LLM_PROVIDERS) {
    providers[p.id] = {
      providerId: p.id,
      apiKey: '',
      model: p.models[0] || '',
      endpointUrl: p.defaultEndpoint,
      enabled: false,
    }
  }
  return { activeProviderId: 'openai', providers }
}
