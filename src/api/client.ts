const BASE_URL = 'http://127.0.0.1:8766'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json()
}

// Ontology API
export function analyzeOntology(folderPath: string, files?: string[], scanVuln = false) {
  const body: Record<string, unknown> = { path: folderPath, scanVuln }
  if (files) body.files = files
  return request<{
    nodes: {
      id: string
      label: string
      type: string
      file: string
      line?: number
      cluster: number
      size: number
      fanIn?: number
      fanOut?: number
      lines?: number
      dead?: boolean
      vulnCount?: number
    }[]
    edges: {
      source: string
      target: string
      type: string
      order?: number
      circular?: boolean
    }[]
    vulnerabilities: {
      rule: string
      severity: string
      message: string
      line: number
      file: string
      nodeId: string
    }[]
    suggestions: {
      id: string
      category: string
      priority: string
      title: string
      description: string
      nodeIds: string[]
      file: string | null
    }[]
    vulnError?: string
  }>('/api/ontology/analyze', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export type AnalyzeResult = Awaited<ReturnType<typeof analyzeOntology>>

function _parseNdjsonLines(
  text: string,
  onProgress: (percent: number, message: string) => void,
): AnalyzeResult | null {
  let result: AnalyzeResult | null = null
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)
      if (event.type === 'progress') onProgress(event.percent, event.message)
      else if (event.type === 'result') result = event.data
    } catch { /* skip */ }
  }
  return result
}

/** Streaming version — calls onProgress while the backend works. */
export async function analyzeOntologyStream(
  folderPath: string,
  files: string[] | undefined,
  scanVuln: boolean,
  onProgress: (percent: number, message: string) => void,
  signal?: AbortSignal,
): Promise<AnalyzeResult> {
  const body: Record<string, unknown> = { path: folderPath, scanVuln }
  if (files) body.files = files

  const res = await fetch(`${BASE_URL}/api/ontology/analyze-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }

  let result: AnalyzeResult | null = null

  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const ev = JSON.parse(line)
          if (ev.type === 'progress') onProgress(ev.percent, ev.message)
          else if (ev.type === 'result') result = ev.data
        } catch { /* skip */ }
      }
    }
    if (buffer.trim()) {
      const p = _parseNdjsonLines(buffer, onProgress)
      if (p) result = p
    }
  } else {
    const text = await res.text()
    result = _parseNdjsonLines(text, onProgress)
  }

  if (!result) throw new Error('No result received from analysis stream')
  return result
}

export function listOntologyFiles(folderPath: string, files?: string[]) {
  const body: Record<string, unknown> = { path: folderPath }
  if (files) body.files = files
  return request<{ files: { path: string; ext: string }[] }>('/api/ontology/list-files', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getCodePreview(file: string, line: number, context = 5) {
  return request<{ code: string; startLine: number; endLine: number }>('/api/ontology/code-preview', {
    method: 'POST',
    body: JSON.stringify({ file, line, context }),
  })
}
