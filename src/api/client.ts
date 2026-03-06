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
export function analyzeOntology(folderPath: string, files?: string[]) {
  const body: Record<string, unknown> = { path: folderPath }
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
    vulnError?: string
  }>('/api/ontology/analyze', {
    method: 'POST',
    body: JSON.stringify(body),
  })
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
