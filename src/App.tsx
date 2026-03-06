import { useState, useEffect } from 'react'
import OntologyPanel from './components/Ontology/OntologyPanel'
import { Circle } from 'lucide-react'

export default function App() {
  const [backendReady, setBackendReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch('http://127.0.0.1:8766/api/health')
          if (res.ok) {
            setBackendReady(true)
            return
          }
        } catch { /* backend not ready yet */ }
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
    poll()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-white">
      {/* Header */}
      <header className="h-10 bg-slate-900 border-b border-slate-800 flex items-center px-4 justify-between shrink-0">
        <h1 className="text-sm font-semibold text-slate-200">Ontology Analyzer</h1>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Circle
            size={8}
            className={backendReady ? 'fill-green-500 text-green-500' : 'fill-red-500 text-red-500'}
          />
          {backendReady ? 'Connected' : 'Connecting...'}
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        <OntologyPanel />
      </div>
    </div>
  )
}
