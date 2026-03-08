import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import OntologyGraph, { type GraphNode, type GraphEdge, type GraphHandle, type LayoutMode, type Vulnerability } from './OntologyGraph'
import OntologyFileList from './OntologyFileList'
import OntologyProperties from './OntologyProperties'
import { analyzeOntology, listOntologyFiles, getCodePreview } from '../../api/client'
import { ZoomIn, ZoomOut, Search, Download, GitBranch, AlertTriangle, Ghost, RefreshCw, Locate, ShieldAlert, BookOpen, X, Route, Lightbulb, Network, Layers, ChevronDown, ChevronRight, Copy, Waypoints, PanelLeftClose, PanelLeftOpen, MessageSquare, Settings, FileCode } from 'lucide-react'
import ChatPanel from '../LLM/ChatPanel'
import LLMSettingsModal from '../LLM/LLMSettingsModal'
import { useLLMSettings } from '../../hooks/useLLMSettings'
import type { ChatContext } from '../../types/llm'

interface FileEntry {
  path: string
  ext: string
}

interface Suggestion {
  id: string
  category: string
  priority: string
  title: string
  description: string
  nodeIds: string[]
  file: string | null
}

export default function OntologyPanel() {
  const graphRef = useRef<GraphHandle>(null)
  const [folderPath, setFolderPath] = useState('')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [highlightFile, setHighlightFile] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [manualPath, setManualPath] = useState('')
  const [showManualInput, setShowManualInput] = useState(false)

  // Track selected files for "Add Files" support
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([])
  const [commonDir, setCommonDir] = useState('')

  // New feature state
  const [layout, setLayout] = useState<LayoutMode>('force')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [inheritanceMode, setInheritanceMode] = useState(false)
  const [hoverInfo, setHoverInfo] = useState<{ node: GraphNode; x: number; y: number; code?: string } | null>(null)
  const hoverTimerRef = useRef<number>(0)
  const [vulnerabilities, setVulnerabilities] = useState<Vulnerability[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [suggestionFilter, setSuggestionFilter] = useState<string>('all')
  const [expandedSuggestions, setExpandedSuggestions] = useState<Set<string>>(new Set())
  // Doc opens in external browser via IPC
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Mermaid export state
  const [mermaidOpen, setMermaidOpen] = useState(false)
  const [mermaidCode, setMermaidCode] = useState('')
  const [mermaidType, setMermaidType] = useState('')
  const [mermaidMenuOpen, setMermaidMenuOpen] = useState(false)
  const [mermaidZoom, setMermaidZoom] = useState(1)
  const [mermaidSearchQuery, setMermaidSearchQuery] = useState('')
  const [mermaidMatchCount, setMermaidMatchCount] = useState(0)
  const [mermaidMatchIndex, setMermaidMatchIndex] = useState(0)
  const [mermaidCopied, setMermaidCopied] = useState(false)
  const [mermaidSelectedFiles, setMermaidSelectedFiles] = useState<Set<string>>(new Set())

  // LLM Chat state
  const [chatOpen, setChatOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { settings: llmSettings, updateProvider, setActiveProvider, getActiveConfig } = useLLMSettings()

  // Method trace state
  const [traceOpen, setTraceOpen] = useState(false)
  const [traceQuery, setTraceQuery] = useState('')
  const [traceNodeIds, setTraceNodeIds] = useState<Set<string> | null>(null)
  const [traceEdgeKeys, setTraceEdgeKeys] = useState<Set<string> | null>(null)

  // Computed stats
  const cycleCount = useMemo(() => edges.filter(e => e.circular).length, [edges])
  const deadCount = useMemo(() => nodes.filter(n => n.dead).length, [nodes])
  const vulnCount = useMemo(() => vulnerabilities.length, [vulnerabilities])

  // Circular edge source nodes (unique) for badge click navigation
  const circularNodes = useMemo(() => {
    const ids = new Set<string>()
    for (const e of edges) {
      if (e.circular) { ids.add(e.source); ids.add(e.target) }
    }
    return nodes.filter(n => ids.has(n.id))
  }, [edges, nodes])

  const deadNodes = useMemo(() => nodes.filter(n => n.dead), [nodes])
  const vulnNodes = useMemo(() => {
    const ids = new Set(vulnerabilities.map(v => v.nodeId))
    return nodes.filter(n => ids.has(n.id))
  }, [vulnerabilities, nodes])

  // Chat context — auto-collected from current state
  const chatContext = useMemo<ChatContext>(() => {
    // Build vulnerability details for LLM context
    const vulnDetails = vulnerabilities.length > 0
      ? vulnerabilities.map(v => {
          const node = nodes.find(n => n.id === v.nodeId)
          return {
            rule: v.rule,
            severity: v.severity,
            message: v.message,
            line: v.line,
            file: v.file,
            nodeLabel: node?.label,
          }
        })
      : undefined

    return {
      selectedNode: selectedNode ? {
        id: selectedNode.id, label: selectedNode.label, type: selectedNode.type,
        file: selectedNode.file, line: selectedNode.line,
        fanIn: selectedNode.fanIn, fanOut: selectedNode.fanOut,
        lines: selectedNode.lines, dead: selectedNode.dead, vulnCount: selectedNode.vulnCount,
      } : undefined,
      graphSummary: nodes.length > 0 ? {
        totalNodes: nodes.length, totalEdges: edges.length,
        cycleCount, deadCount, vulnCount: vulnCount,
        fileCount: files.length,
        nodeTypes: nodes.reduce((acc, n) => { acc[n.type] = (acc[n.type] || 0) + 1; return acc }, {} as Record<string, number>),
      } : undefined,
      folderPath: folderPath || undefined,
      connectedNodes: selectedNode ? edges
        .filter(e => e.source === selectedNode.id || e.target === selectedNode.id)
        .slice(0, 20)
        .map(e => {
          const isOut = e.source === selectedNode.id
          const other = nodes.find(n => n.id === (isOut ? e.target : e.source))
          const direction: 'outgoing' | 'incoming' = isOut ? 'outgoing' : 'incoming'
          return other ? { label: other.label, type: other.type, direction, edgeType: e.type } : null
        }).filter(Boolean) as ChatContext['connectedNodes'] : undefined,
      vulnerabilities: vulnDetails,
    }
  }, [selectedNode, nodes, edges, files, folderPath, cycleCount, deadCount, vulnCount, vulnerabilities])

  const cycleIdxRef = useRef(0)
  const deadIdxRef = useRef(0)
  const vulnIdxRef = useRef(0)

  const focusOrSearchNode = useCallback((node: GraphNode) => {
    setSelectedNode(node)
    if (mermaidOpen) {
      const shortLabel = node.label.includes('.') ? node.label.split('.').pop()! : node.label
      setMermaidSearchQuery(shortLabel)
      setMermaidMatchIndex(0)
      setSearchOpen(true)
    } else {
      graphRef.current?.focusOnNode(node.id)
    }
  }, [mermaidOpen])

  const handleCycleBadgeClick = useCallback(() => {
    if (circularNodes.length === 0) return
    cycleIdxRef.current = cycleIdxRef.current % circularNodes.length
    const node = circularNodes[cycleIdxRef.current]
    focusOrSearchNode(node)
    cycleIdxRef.current = (cycleIdxRef.current + 1) % circularNodes.length
  }, [circularNodes, focusOrSearchNode])

  const handleDeadBadgeClick = useCallback(() => {
    if (deadNodes.length === 0) return
    deadIdxRef.current = deadIdxRef.current % deadNodes.length
    const node = deadNodes[deadIdxRef.current]
    focusOrSearchNode(node)
    deadIdxRef.current = (deadIdxRef.current + 1) % deadNodes.length
  }, [deadNodes, focusOrSearchNode])

  const handleVulnBadgeClick = useCallback(() => {
    // Navigate through each vulnerability one by one (not just unique nodes)
    if (vulnerabilities.length === 0) return
    vulnIdxRef.current = vulnIdxRef.current % vulnerabilities.length
    const vuln = vulnerabilities[vulnIdxRef.current]
    // Find the node: try exact id, then by file
    const node = nodes.find(n => n.id === vuln.nodeId)
      || nodes.find(n => n.file === vuln.file)
      || nodes.find(n => n.file.endsWith(vuln.file))
    if (node) {
      setSelectedNode(node)
      graphRef.current?.focusOnNode(node.id)
    }
    vulnIdxRef.current = (vulnIdxRef.current + 1) % vulnerabilities.length
  }, [vulnerabilities, nodes])

  // Impact analysis: BFS from selected node
  const impactMap = useMemo(() => {
    if (!selectedNode) return null
    const map = new Map<string, number>()
    const queue: [string, number][] = [[selectedNode.id, 0]]
    map.set(selectedNode.id, 0)

    // Build outgoing adjacency from edges
    const outAdj = new Map<string, string[]>()
    for (const e of edges) {
      if (!outAdj.has(e.source)) outAdj.set(e.source, [])
      outAdj.get(e.source)!.push(e.target)
    }

    let qi = 0
    while (qi < queue.length) {
      const [curr, depth] = queue[qi++]
      if (depth >= 3) continue
      for (const nb of outAdj.get(curr) ?? []) {
        if (!map.has(nb)) {
          map.set(nb, depth + 1)
          queue.push([nb, depth + 1])
        }
      }
    }
    return map.size > 1 ? map : null
  }, [selectedNode, edges])

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    return nodes.filter(n => n.label.toLowerCase().includes(q)).slice(0, 20)
  }, [nodes, searchQuery])

  // Trace search results
  const traceSearchResults = useMemo(() => {
    if (!traceQuery.trim()) return []
    const q = traceQuery.toLowerCase()
    return nodes.filter(n =>
      (n.type === 'method' || n.type === 'function' || n.type === 'class') &&
      n.label.toLowerCase().includes(q)
    ).slice(0, 20)
  }, [nodes, traceQuery])

  // Execute trace: bidirectional — collect both callers (incoming) and callees (outgoing)
  const executeTrace = useCallback((startNodeId: string) => {
    // Build outgoing adjacency
    const outAdj = new Map<string, GraphEdge[]>()
    // Build incoming adjacency
    const inAdj = new Map<string, GraphEdge[]>()
    for (const e of edges) {
      if (!outAdj.has(e.source)) outAdj.set(e.source, [])
      outAdj.get(e.source)!.push(e)
      if (!inAdj.has(e.target)) inAdj.set(e.target, [])
      inAdj.get(e.target)!.push(e)
    }

    const visitedNodes = new Set<string>()
    const visitedEdgeKeys = new Set<string>()

    // 1) Forward trace: start → callees (DFS outgoing)
    const fwdStack = [startNodeId]
    const fwdVisited = new Set<string>()
    while (fwdStack.length > 0) {
      const curr = fwdStack.pop()!
      if (fwdVisited.has(curr)) continue
      fwdVisited.add(curr)
      visitedNodes.add(curr)
      for (const e of outAdj.get(curr) ?? []) {
        visitedEdgeKeys.add(`${e.source}→${e.target}`)
        if (!fwdVisited.has(e.target)) {
          fwdStack.push(e.target)
        }
      }
    }

    // 2) Backward trace: callers → start (DFS incoming)
    const bwdStack = [startNodeId]
    const bwdVisited = new Set<string>()
    while (bwdStack.length > 0) {
      const curr = bwdStack.pop()!
      if (bwdVisited.has(curr)) continue
      bwdVisited.add(curr)
      visitedNodes.add(curr)
      for (const e of inAdj.get(curr) ?? []) {
        visitedEdgeKeys.add(`${e.source}→${e.target}`)
        if (!bwdVisited.has(e.source)) {
          bwdStack.push(e.source)
        }
      }
    }

    setTraceNodeIds(visitedNodes)
    setTraceEdgeKeys(visitedEdgeKeys)
    setTraceOpen(false)
    setTraceQuery('')

    // Apply dedicated trace layout and fit-to-view
    graphRef.current?.applyTraceLayout(visitedNodes, visitedEdgeKeys, startNodeId)

    const startNode = nodes.find(n => n.id === startNodeId)
    if (startNode) {
      setSelectedNode(startNode)
    }
  }, [edges, nodes])

  const clearTrace = useCallback(() => {
    setTraceNodeIds(null)
    setTraceEdgeKeys(null)
  }, [])

  // Inheritance mode filtering
  const displayEdges = useMemo(() => {
    if (!inheritanceMode) return edges
    return edges.filter(e => e.type === 'extends' || e.type === 'implements')
  }, [edges, inheritanceMode])

  const displayNodes = useMemo(() => {
    if (!inheritanceMode) return nodes
    const involved = new Set<string>()
    for (const e of displayEdges) {
      involved.add(e.source)
      involved.add(e.target)
    }
    return nodes.filter(n => involved.has(n.id))
  }, [nodes, displayEdges, inheritanceMode])

  // Ctrl+F shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setSearchOpen(prev => !prev)
      }
      if (e.key === 'Escape') {
        setSearchOpen(false)
        setSearchQuery('')
        setMermaidSearchQuery('')
        setMermaidMatchCount(0)
        setMermaidMatchIndex(0)
        setTraceOpen(false)
        setTraceQuery('')
        setSuggestionsOpen(false)
        setMermaidOpen(false)
        setMermaidMenuOpen(false)
        setMermaidSelectedFiles(new Set())
        setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const loadFolder = useCallback(async (folder: string, files?: string[]) => {
    setFolderPath(files ? `${files.length} files selected` : folder)
    setError(null)
    setLoading(true)
    setSelectedNode(null)
    setHighlightFile(null)
    setShowManualInput(false)
    setInheritanceMode(false)

    try {
      const [fileResult, graphResult] = await Promise.all([
        listOntologyFiles(folder, files),
        analyzeOntology(folder, files),
      ])

      setFiles(fileResult.files)

      const graphNodes: GraphNode[] = graphResult.nodes.map((n, i) => {
        const angle = i * 2.39996
        const r = Math.sqrt(i) * 30
        return {
          ...n,
          x: Math.cos(angle) * r,
          y: Math.sin(angle) * r,
          vx: 0,
          vy: 0,
        }
      })
      setNodes(graphNodes)
      setEdges(graphResult.edges)
      setVulnerabilities(graphResult.vulnerabilities || [])
      setSuggestions(graphResult.suggestions || [])
      setSuggestionsOpen(false)
      setSuggestionFilter('all')
      setExpandedSuggestions(new Set())
      cycleIdxRef.current = 0
      deadIdxRef.current = 0
      vulnIdxRef.current = 0
      if (graphResult.vulnError) {
        setError(graphResult.vulnError)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to analyze folder')
    } finally {
      setLoading(false)
    }
  }, [])

  const computeCommonDir = useCallback((filePaths: string[]) => {
    const normalized = filePaths.map(f => f.replace(/\\/g, '/'))
    const parts = normalized[0].split('/')
    let cp = parts.slice(0, -1)
    for (const fp of normalized.slice(1)) {
      const fpParts = fp.split('/')
      let i = 0
      while (i < cp.length && i < fpParts.length && cp[i] === fpParts[i]) i++
      cp = cp.slice(0, i)
    }
    return cp.join('/')
  }, [])

  const handleSelectFolder = useCallback(async () => {
    try {
      const folder = await window.electronAPI.selectFolder()
      if (!folder) return
      setSelectedFilePaths([])
      setCommonDir('')
      await loadFolder(folder)
    } catch (err: any) {
      setShowManualInput(true)
    }
  }, [loadFolder])

  const handleSelectFiles = useCallback(async () => {
    try {
      const files = await window.electronAPI.selectFiles()
      if (!files || files.length === 0) return
      const dir = computeCommonDir(files)
      setSelectedFilePaths(files)
      setCommonDir(dir)
      await loadFolder(dir, files)
    } catch (err: any) {
      setShowManualInput(true)
    }
  }, [loadFolder, computeCommonDir])

  const handleAddFiles = useCallback(async () => {
    try {
      const newFiles = await window.electronAPI.selectFiles()
      if (!newFiles || newFiles.length === 0) return
      // Merge with existing, deduplicate
      const merged = [...new Set([...selectedFilePaths, ...newFiles])]
      const dir = computeCommonDir(merged)
      setSelectedFilePaths(merged)
      setCommonDir(dir)
      await loadFolder(dir, merged)
    } catch (err: any) {
      setShowManualInput(true)
    }
  }, [loadFolder, selectedFilePaths, computeCommonDir])

  const handleManualSubmit = useCallback(async () => {
    const folder = manualPath.trim()
    if (!folder) return
    await loadFolder(folder)
  }, [manualPath, loadFolder])

  const handleSelectNode = useCallback((node: GraphNode | null) => {
    setSelectedNode(node)
  }, [])

  const handleNavigateToNode = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId)
    if (node) {
      setSelectedNode(node)
      if (mermaidOpen) {
        // Search for the node in the diagram
        const shortLabel = node.label.includes('.') ? node.label.split('.').pop()! : node.label
        setMermaidSearchQuery(shortLabel)
        setMermaidMatchIndex(0)
        setSearchOpen(true)
      } else {
        graphRef.current?.focusOnNode(nodeId)
      }
    }
  }, [nodes, mermaidOpen])

  // Handle diagram node click → show properties panel
  const handleMermaidNodeClick = useCallback((label: string) => {
    if (!label) return
    const q = label.toLowerCase()
    // Try exact label match first, then partial match
    let found = nodes.find(n => n.label.toLowerCase() === q)
    if (!found) {
      // Try matching just the short name (e.g. "ClassName" matches "pkg.ClassName")
      found = nodes.find(n => {
        const shortLabel = n.label.includes('.') ? n.label.split('.').pop()!.toLowerCase() : n.label.toLowerCase()
        return shortLabel === q
      })
    }
    if (!found) {
      // Partial match as fallback
      found = nodes.find(n => n.label.toLowerCase().includes(q) || q.includes(n.label.toLowerCase()))
    }
    if (found) {
      setSelectedNode(found)
    }
  }, [nodes])

  const handleHighlightFile = useCallback((file: string | null) => {
    setHighlightFile(file)
    if (file) {
      if (mermaidOpen) {
        // For class diagram, search in diagram
        const fileName = file.split('/').pop()?.replace(/\.[^.]+$/, '') || ''
        if (fileName) {
          setMermaidSearchQuery(fileName)
          setMermaidMatchIndex(0)
          setSearchOpen(true)
        }
      } else {
        graphRef.current?.focusOnFile(file)
      }
    } else {
      if (mermaidOpen) {
        setMermaidSearchQuery('')
        setMermaidMatchCount(0)
        setMermaidMatchIndex(0)
      }
    }
  }, [mermaidOpen])

  // Handle file clicks when mermaid flowchart/sequence is open — filter diagram by file(s)
  const handleMermaidFileClick = useCallback((file: string, shiftKey: boolean) => {
    if (!mermaidOpen) {
      // Not in mermaid mode — use regular highlight behavior
      setHighlightFile(file || null)
      if (file) {
        graphRef.current?.focusOnFile(file)
      }
      return
    }

    // Empty file string = clear selection
    if (!file) {
      setMermaidSelectedFiles(new Set())
      // Regenerate full diagram
      const isTracing = traceNodeIds && traceEdgeKeys
      const mNodes = isTracing ? nodes.filter(n => traceNodeIds!.has(n.id)) : nodes
      const mEdges = isTracing ? edges.filter(e => traceEdgeKeys!.has(`${e.source}→${e.target}`)) : edges
      if (mermaidType.toLowerCase().includes('flowchart') || mermaidType.toLowerCase().includes('flow')) {
        setMermaidCode(generateFlowchart(mNodes, mEdges))
      } else if (mermaidType.toLowerCase().includes('sequence')) {
        setMermaidCode(generateSequenceDiagram(mNodes, mEdges, selectedNode?.id ?? null))
      }
      setHighlightFile(null)
      return
    }

    const isFlowOrSeq = mermaidType.toLowerCase().includes('flow') || mermaidType.toLowerCase().includes('sequence')
    if (!isFlowOrSeq) {
      // Class diagram — use search
      const fileName = file.split('/').pop()?.replace(/\.[^.]+$/, '') || ''
      if (fileName) {
        setMermaidSearchQuery(fileName)
        setMermaidMatchIndex(0)
        setSearchOpen(true)
      }
      setHighlightFile(file)
      return
    }

    // Flowchart or Sequence: select file(s) and regenerate
    setMermaidSelectedFiles(prev => {
      const next = new Set(prev)
      if (shiftKey) {
        // Toggle file in multi-select
        if (next.has(file)) next.delete(file)
        else next.add(file)
      } else {
        // Single select — replace
        if (next.size === 1 && next.has(file)) {
          next.clear() // deselect if already selected
        } else {
          next.clear()
          next.add(file)
        }
      }
      return next
    })
    setHighlightFile(file)
  }, [mermaidOpen, mermaidType, nodes, edges, traceNodeIds, traceEdgeKeys, selectedNode])

  // Regenerate flowchart/sequence when selected files change
  useEffect(() => {
    if (!mermaidOpen || mermaidSelectedFiles.size === 0) return
    const isFlow = mermaidType.toLowerCase().includes('flow')
    const isSeq = mermaidType.toLowerCase().includes('sequence')
    if (!isFlow && !isSeq) return

    const isTracing = traceNodeIds && traceEdgeKeys
    const baseNodes = isTracing ? nodes.filter(n => traceNodeIds!.has(n.id)) : nodes
    const baseEdges = isTracing ? edges.filter(e => traceEdgeKeys!.has(`${e.source}→${e.target}`)) : edges

    // Filter nodes to selected files
    const filteredNodeIds = new Set<string>()
    const filteredNodes = baseNodes.filter(n => {
      if (mermaidSelectedFiles.has(n.file)) {
        filteredNodeIds.add(n.id)
        return true
      }
      return false
    })
    // Also include edges where both source and target belong to selected files' nodes
    const filteredEdges = baseEdges.filter(e =>
      filteredNodeIds.has(e.source) || filteredNodeIds.has(e.target)
    )
    // Include referenced nodes from edges (targets/sources from other files that connect to our files)
    const allReferencedIds = new Set(filteredNodeIds)
    for (const e of filteredEdges) {
      allReferencedIds.add(e.source)
      allReferencedIds.add(e.target)
    }
    const allNodes = baseNodes.filter(n => allReferencedIds.has(n.id))

    if (isFlow) {
      setMermaidCode(generateFlowchart(allNodes, filteredEdges))
    } else {
      setMermaidCode(generateSequenceDiagram(allNodes, filteredEdges, selectedNode?.id ?? null))
    }
  }, [mermaidSelectedFiles, mermaidOpen, mermaidType, nodes, edges, traceNodeIds, traceEdgeKeys, selectedNode])

  // Code preview on hover
  const handleHoverNode = useCallback((node: GraphNode | null, screenX: number, screenY: number) => {
    clearTimeout(hoverTimerRef.current)
    if (!node || !node.line || node.file === '(external)') {
      setHoverInfo(null)
      return
    }
    setHoverInfo({ node, x: screenX, y: screenY })
    hoverTimerRef.current = window.setTimeout(async () => {
      try {
        const fullPath = folderPath + '/' + node.file
        const result = await getCodePreview(fullPath, node.line!, 5)
        setHoverInfo(prev => prev?.node.id === node.id ? { ...prev, code: result.code } : prev)
      } catch { /* ignore */ }
    }, 400)
  }, [folderPath])

  // PNG export
  const handleExport = useCallback(() => {
    const canvas = graphRef.current?.getCanvas()
    if (!canvas) return
    const link = document.createElement('a')
    link.download = 'ontology-graph.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  }, [])

  return (
    <div className="flex h-full relative">
      {/* Left: File List — sliding panel */}
      <div
        className="border-r border-slate-700 bg-slate-900 shrink-0 flex flex-col overflow-hidden transition-all duration-300 ease-in-out"
        style={{ width: sidebarOpen ? 240 : 0, minWidth: 0 }}
      >
        <OntologyFileList
          folderPath={folderPath}
          files={files}
          loading={loading}
          highlightFile={highlightFile}
          hasSelectedFiles={selectedFilePaths.length > 0}
          multiSelectedFiles={mermaidOpen ? mermaidSelectedFiles : undefined}
          onSelectFolder={handleSelectFolder}
          onSelectFiles={handleSelectFiles}
          onAddFiles={handleAddFiles}
          onHighlightFile={handleHighlightFile}
          onFileClick={mermaidOpen ? handleMermaidFileClick : undefined}
        />
        {showManualInput && (
          <div className="p-2 border-t border-slate-700">
            <input
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
              placeholder="C:\path\to\folder"
              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-angel-500 mb-1"
              autoFocus
            />
            <button
              onClick={handleManualSubmit}
              className="w-full px-2 py-1 bg-angel-600 hover:bg-angel-500 text-white text-xs rounded"
            >
              Analyze
            </button>
          </div>
        )}
      </div>

      {/* Sidebar toggle button */}
      <button
        onClick={() => setSidebarOpen(prev => !prev)}
        className="absolute top-2 z-20 w-6 h-6 rounded flex items-center justify-center bg-slate-800/90 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-600 transition-all duration-300 ease-in-out"
        style={{ left: sidebarOpen ? 228 : 6 }}
        title={sidebarOpen ? 'Hide file list' : 'Show file list'}
      >
        {sidebarOpen ? <PanelLeftClose size={12} /> : <PanelLeftOpen size={12} />}
      </button>

      {/* Center: Graph Canvas */}
      <div className="flex-1 relative">
        {error && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 max-w-md bg-red-900/90 text-red-200 text-xs px-4 py-2.5 rounded-lg border border-red-700/50">
            {error.includes('Semgrep is not installed') ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 font-medium text-red-300">
                  <ShieldAlert size={12} />
                  Semgrep Not Found
                </div>
                <p>Semgrep is required for vulnerability scanning. Install it:</p>
                <code className="block bg-black/30 rounded px-2 py-1 font-mono text-[11px] text-red-100">
                  pip install semgrep
                </code>
                <p className="text-red-300/70 text-[10px]">Then restart the application and re-analyze.</p>
              </div>
            ) : error.includes('timed out') ? (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 font-medium text-red-300">
                  <ShieldAlert size={12} />
                  Scan Timeout
                </div>
                <p>{error}</p>
              </div>
            ) : (
              <span>{error}</span>
            )}
          </div>
        )}

        {/* Search overlay — unified for nodes and mermaid diagram */}
        {searchOpen && (nodes.length > 0 || mermaidOpen) && (
          <div className="absolute top-2 left-2 z-20 w-64">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={mermaidOpen ? mermaidSearchQuery : searchQuery}
                onChange={(e) => {
                  if (mermaidOpen) { setMermaidSearchQuery(e.target.value); setMermaidMatchIndex(0) }
                  else setSearchQuery(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (mermaidOpen && e.key === 'Enter') {
                    if (e.shiftKey) setMermaidMatchIndex(i => (i - 1 + mermaidMatchCount) % Math.max(1, mermaidMatchCount))
                    else setMermaidMatchIndex(i => (i + 1) % Math.max(1, mermaidMatchCount))
                  }
                }}
                placeholder={mermaidOpen ? "Search in diagram..." : "Search nodes..."}
                className="w-full bg-slate-800/95 border border-slate-600 rounded px-2 py-1.5 pl-7 text-xs text-slate-200 focus:outline-none focus:border-angel-500"
                autoFocus
              />
              {/* Match count & nav for mermaid mode */}
              {mermaidOpen && mermaidMatchCount > 0 && (
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <span className="text-[10px] text-slate-400 tabular-nums">
                    {mermaidMatchIndex + 1}/{mermaidMatchCount}
                  </span>
                  <button
                    onClick={() => setMermaidMatchIndex(i => (i - 1 + mermaidMatchCount) % Math.max(1, mermaidMatchCount))}
                    className="w-4 h-4 rounded bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white flex items-center justify-center text-[9px]"
                  >▲</button>
                  <button
                    onClick={() => setMermaidMatchIndex(i => (i + 1) % Math.max(1, mermaidMatchCount))}
                    className="w-4 h-4 rounded bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white flex items-center justify-center text-[9px]"
                  >▼</button>
                </div>
              )}
              {mermaidOpen && mermaidSearchQuery && mermaidMatchCount === 0 && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-red-400">No results</span>
              )}
            </div>
            {/* Node search results — only in graph mode */}
            {!mermaidOpen && searchResults.length > 0 && (
              <div className="mt-1 bg-slate-800/95 border border-slate-600 rounded max-h-48 overflow-y-auto">
                {searchResults.map(n => (
                  <button
                    key={n.id}
                    className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 flex justify-between"
                    onClick={() => {
                      setSelectedNode(n)
                      graphRef.current?.focusOnNode(n.id)
                      setSearchOpen(false)
                      setSearchQuery('')
                    }}
                  >
                    <span className="truncate">{n.label}</span>
                    <span className="text-slate-500 ml-2 shrink-0">{n.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Trace overlay */}
        {traceOpen && nodes.length > 0 && (
          <div className="absolute top-2 left-2 z-20 w-72">
            <div className="relative">
              <Route size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-emerald-500" />
              <input
                value={traceQuery}
                onChange={(e) => setTraceQuery(e.target.value)}
                placeholder="메소드/함수명을 입력하세요..."
                className="w-full bg-slate-800/95 border border-emerald-600/50 rounded px-2 py-1.5 pl-7 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                autoFocus
              />
              <button
                onClick={() => { setTraceOpen(false); setTraceQuery('') }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-slate-700 rounded text-slate-500 hover:text-white"
              >
                <X size={10} />
              </button>
            </div>
            {traceSearchResults.length > 0 && (
              <div className="mt-1 bg-slate-800/95 border border-slate-600 rounded max-h-48 overflow-y-auto">
                {traceSearchResults.map(n => (
                  <button
                    key={n.id}
                    className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-emerald-900/30 flex justify-between items-center gap-2"
                    onClick={() => executeTrace(n.id)}
                  >
                    <span className="truncate">{n.label}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <span className="text-slate-500">{n.type}</span>
                      <span className="text-emerald-500 text-[10px] font-medium px-1 py-0.5 bg-emerald-900/40 rounded">추적</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {traceQuery.trim() && traceSearchResults.length === 0 && (
              <div className="mt-1 bg-slate-800/95 border border-slate-600 rounded px-3 py-2 text-xs text-slate-500">
                일치하는 메소드/함수가 없습니다
              </div>
            )}
          </div>
        )}

        {/* Trace active indicator */}
        {traceNodeIds && (
          <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5">
            <div className="flex items-center gap-1 bg-emerald-900/80 text-emerald-300 text-[10px] px-2.5 py-1 rounded border border-emerald-700/50">
              <Route size={11} />
              <span>추적 모드 ({traceNodeIds.size} nodes)</span>
            </div>
            <button
              onClick={clearTrace}
              className="flex items-center gap-1 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white text-[10px] px-2 py-1 rounded"
            >
              <X size={10} />
              <span>해제</span>
            </button>
          </div>
        )}

        {/* Code preview tooltip */}
        {hoverInfo?.code && (
          <div
            className="absolute z-30 bg-slate-800 border border-slate-600 rounded shadow-lg p-2 max-w-md pointer-events-none"
            style={{ left: Math.min(hoverInfo.x + 12, window.innerWidth - 420), top: Math.max(10, hoverInfo.y - 80) }}
          >
            <div className="text-[10px] text-slate-500 mb-1">{hoverInfo.node.file}:{hoverInfo.node.line}</div>
            <pre className="text-[10px] text-slate-300 font-mono whitespace-pre overflow-hidden max-h-48 leading-relaxed">
              {hoverInfo.code}
            </pre>
          </div>
        )}

        {nodes.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-full bg-[#111111]">
            <div className="text-center text-slate-500">
              <div className="text-7xl mb-4 opacity-70">&#x1F578;</div>
              <p className="text-sm">Select a folder to visualize code relationships</p>
              <p className="text-xs mt-1 text-slate-600">
                Supports Java, Python, TypeScript, JavaScript, Go, C/C++
              </p>
            </div>
          </div>
        ) : mermaidOpen && mermaidCode ? (
          <MermaidFullView
            code={mermaidCode}
            type={mermaidType}
            zoom={mermaidZoom}
            onZoomChange={setMermaidZoom}
            searchQuery={mermaidSearchQuery}
            searchIndex={mermaidMatchIndex}
            onMatchCount={setMermaidMatchCount}
            fileFilterCount={mermaidSelectedFiles.size}
            onNodeClick={handleMermaidNodeClick}
          />
        ) : (
          <OntologyGraph
            ref={graphRef}
            nodes={displayNodes}
            edges={displayEdges}
            selectedNodeId={selectedNode?.id ?? null}
            highlightFile={highlightFile}
            layout={inheritanceMode ? 'tree' : layout}
            impactMap={impactMap}
            traceNodeIds={traceNodeIds}
            traceEdgeKeys={traceEdgeKeys}
            onSelectNode={handleSelectNode}
            onHoverNode={handleHoverNode}
          />
        )}

        {/* Doc button — visible when no overlay active */}
        <div className={`absolute top-2 left-2 z-10 flex gap-1 ${searchOpen || traceOpen || traceNodeIds ? 'hidden' : ''}`}>
          {nodes.length > 0 && (
            <button
              onClick={() => folderPath && loadFolder(folderPath)}
              disabled={loading}
              className="flex items-center gap-1 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white text-[10px] px-2 py-1 rounded transition-colors disabled:opacity-50"
              title="Refresh analysis"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
          )}
          <button
            onClick={() => {
              if (window.electronAPI?.openDoc) {
                window.electronAPI.openDoc()
              } else {
                window.open('docs/index.html', '_blank')
              }
            }}
            className="flex items-center gap-1 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white text-[10px] px-2 py-1 rounded transition-colors"
            title="Documentation"
          >
            <BookOpen size={11} />
            <span>Doc</span>
          </button>
        </div>

        {/* Toolbar overlay */}
        {nodes.length > 0 && (
          <>

            {/* Top-right: badges */}
            <div className="absolute top-2 right-2 flex gap-1.5 z-10">
              {mermaidOpen && mermaidCode && (
                <button
                  className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors ${
                    mermaidCopied
                      ? 'bg-emerald-900/80 text-emerald-300'
                      : 'bg-slate-800/60 hover:bg-slate-700/80 text-slate-400'
                  }`}
                  onClick={() => {
                    navigator.clipboard.writeText(mermaidCode)
                    setMermaidCopied(true)
                    setTimeout(() => setMermaidCopied(false), 2000)
                  }}
                  title="Copy diagram code"
                >
                  <Copy size={11} />
                  <span>{mermaidCopied ? 'Copied' : 'Copy'}</span>
                </button>
              )}
              <button
                onClick={handleCycleBadgeClick}
                className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors ${
                  cycleCount > 0
                    ? 'bg-red-900/80 hover:bg-red-800/90 text-red-300 cursor-pointer'
                    : 'bg-slate-800/60 text-slate-600 cursor-default'
                }`}
                title={cycleCount > 0 ? 'Click to navigate circular dependencies' : 'No circular dependencies detected'}
              >
                <AlertTriangle size={11} />
                <span>{cycleCount} cycle{cycleCount !== 1 ? 's' : ''}</span>
              </button>
              <button
                onClick={handleDeadBadgeClick}
                className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors ${
                  deadCount > 0
                    ? 'bg-slate-700/80 hover:bg-slate-600/90 text-slate-400 cursor-pointer'
                    : 'bg-slate-800/60 text-slate-600 cursor-default'
                }`}
                title={deadCount > 0 ? 'Click to navigate dead code' : 'No dead code detected'}
              >
                <Ghost size={11} />
                <span>{deadCount} dead</span>
              </button>
              <button
                onClick={handleVulnBadgeClick}
                className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors ${
                  vulnCount > 0
                    ? 'bg-red-900/80 hover:bg-red-800/90 text-red-300 cursor-pointer'
                    : 'bg-slate-800/60 text-slate-600 cursor-default'
                }`}
                title={vulnCount > 0 ? 'Click to navigate security issues' : 'No vulnerabilities detected'}
              >
                <ShieldAlert size={11} />
                <span>{vulnCount} vuln{vulnCount !== 1 ? 's' : ''}</span>
              </button>
              <button
                onClick={() => { setSuggestionsOpen(prev => !prev); setSearchOpen(false); setTraceOpen(false) }}
                className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors ${
                  suggestions.length > 0
                    ? 'bg-amber-900/80 hover:bg-amber-800/90 text-amber-300 cursor-pointer'
                    : 'bg-slate-800/60 text-slate-600 cursor-default'
                }`}
                title={suggestions.length > 0 ? 'Click to view improvement suggestions' : 'No suggestions'}
              >
                <Lightbulb size={11} />
                <span>{suggestions.length} tip{suggestions.length !== 1 ? 's' : ''}</span>
              </button>
            </div>

            {/* Suggestions overlay panel */}
            {suggestionsOpen && suggestions.length > 0 && (() => {
              const categories = Array.from(new Set(suggestions.map(s => s.category)))
              const filtered = suggestionFilter === 'all' ? suggestions : suggestions.filter(s => s.category === suggestionFilter)
              const categoryIcon = (cat: string, size = 12) => {
                switch (cat) {
                  case 'complexity': return <Network size={size} />
                  case 'dead_code': return <Ghost size={size} />
                  case 'circular': return <AlertTriangle size={size} />
                  case 'large_function': return <FileCode size={size} />
                  case 'hub': return <Network size={size} />
                  case 'vulnerability': return <ShieldAlert size={size} />
                  case 'inheritance': return <GitBranch size={size} />
                  case 'wide_interface': return <Layers size={size} />
                  default: return <Lightbulb size={size} />
                }
              }
              const categoryLabel = (cat: string) => {
                switch (cat) {
                  case 'complexity': return 'Complexity'
                  case 'dead_code': return 'Dead Code'
                  case 'circular': return 'Circular Deps'
                  case 'large_function': return 'Large Function'
                  case 'hub': return 'Hub Node'
                  case 'vulnerability': return 'Security'
                  case 'inheritance': return 'Inheritance'
                  case 'wide_interface': return 'Wide Interface'
                  default: return cat
                }
              }
              const priorityColor = (pri: string) => {
                switch (pri) {
                  case 'high': return 'border-red-700/50 bg-red-950/30'
                  case 'medium': return 'border-amber-700/50 bg-amber-950/30'
                  default: return 'border-slate-600/50 bg-slate-800/30'
                }
              }
              const priorityDot = (pri: string) => {
                switch (pri) {
                  case 'high': return 'bg-red-400'
                  case 'medium': return 'bg-amber-400'
                  default: return 'bg-slate-500'
                }
              }
              const priorityLabel = (pri: string) => {
                switch (pri) {
                  case 'high': return 'text-red-400'
                  case 'medium': return 'text-amber-400'
                  default: return 'text-slate-500'
                }
              }

              return (
                <div className="absolute top-10 right-2 z-20 w-96 max-h-[70vh] flex flex-col bg-slate-900/95 border border-slate-600 rounded-lg shadow-xl overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 bg-slate-800/80">
                    <span className="text-xs font-medium text-amber-300 flex items-center gap-1.5">
                      <Lightbulb size={13} />
                      Improvement Suggestions ({filtered.length})
                    </span>
                    <button
                      onClick={() => setSuggestionsOpen(false)}
                      className="p-0.5 hover:bg-slate-700 rounded text-slate-500 hover:text-white"
                    >
                      <X size={12} />
                    </button>
                  </div>

                  {/* Category filter tabs */}
                  <div className="flex gap-1 px-2 py-1.5 border-b border-slate-700/50 overflow-x-auto flex-shrink-0">
                    <button
                      onClick={() => setSuggestionFilter('all')}
                      className={`text-[9px] px-2 py-0.5 rounded whitespace-nowrap transition-colors ${
                        suggestionFilter === 'all'
                          ? 'bg-amber-800/60 text-amber-200'
                          : 'bg-slate-800/60 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      All ({suggestions.length})
                    </button>
                    {categories.map(cat => {
                      const count = suggestions.filter(s => s.category === cat).length
                      return (
                        <button
                          key={cat}
                          onClick={() => setSuggestionFilter(cat)}
                          className={`text-[9px] px-2 py-0.5 rounded whitespace-nowrap flex items-center gap-1 transition-colors ${
                            suggestionFilter === cat
                              ? 'bg-amber-800/60 text-amber-200'
                              : 'bg-slate-800/60 text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {categoryIcon(cat, 9)}
                          {categoryLabel(cat)} ({count})
                        </button>
                      )
                    })}
                  </div>

                  {/* Suggestion cards */}
                  <div className="overflow-y-auto flex-1 p-2 space-y-1.5">
                    {filtered.map(s => {
                      const isExpanded = expandedSuggestions.has(s.id)
                      return (
                        <div
                          key={s.id}
                          className={`border rounded-md p-2 transition-colors ${priorityColor(s.priority)}`}
                        >
                          {/* Title row */}
                          <button
                            onClick={() => setExpandedSuggestions(prev => {
                              const next = new Set(prev)
                              if (next.has(s.id)) next.delete(s.id)
                              else next.add(s.id)
                              return next
                            })}
                            className="w-full flex items-start gap-1.5 text-left"
                          >
                            <span className={`mt-0.5 ${priorityLabel(s.priority)}`}>
                              {categoryIcon(s.category, 11)}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${priorityDot(s.priority)}`} />
                                <span className="text-[10px] text-slate-200 font-medium truncate">{s.title}</span>
                              </div>
                              {s.file && (
                                <span className="text-[9px] text-slate-500 truncate block">{s.file}</span>
                              )}
                            </div>
                            <span className="text-slate-600 mt-0.5 flex-shrink-0">
                              {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                            </span>
                          </button>

                          {/* Expanded details */}
                          {isExpanded && (
                            <div className="mt-1.5 pl-5">
                              <p className="text-[9px] text-slate-400 leading-relaxed mb-1.5">
                                {s.description}
                              </p>
                              {/* Affected nodes */}
                              <div className="flex flex-wrap gap-1">
                                {s.nodeIds.slice(0, 8).map(nid => {
                                  const node = nodes.find(n => n.id === nid)
                                  if (!node) return null
                                  return (
                                    <button
                                      key={nid}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setSelectedNode(node)
                                        graphRef.current?.focusOnNode(nid)
                                      }}
                                      className="text-[8px] px-1.5 py-0.5 rounded bg-slate-700/60 hover:bg-slate-600/80 text-slate-300 hover:text-white truncate max-w-[140px] transition-colors"
                                      title={node.label}
                                    >
                                      {node.label}
                                    </button>
                                  )
                                })}
                                {s.nodeIds.length > 8 && (
                                  <span className="text-[8px] text-slate-600 self-center">
                                    +{s.nodeIds.length - 8} more
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* Bottom-right: controls */}
            <div className="absolute bottom-4 right-4 flex flex-col gap-1 z-10">
              {/* Layout selector */}
              <div className="flex flex-col gap-1 mb-1">
                {(['force', 'tree', 'radial'] as const).map(l => (
                  <button
                    key={l}
                    className={`w-7 h-7 text-[9px] rounded flex items-center justify-center ${
                      (inheritanceMode ? 'tree' : layout) === l
                        ? 'bg-angel-600 text-white'
                        : 'bg-slate-800/80 text-slate-400 hover:text-white'
                    }`}
                    onClick={() => { setLayout(l); setInheritanceMode(false) }}
                    title={`${l} layout`}
                  >
                    {l[0].toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Action buttons */}
              <button
                className={`w-7 h-7 rounded flex items-center justify-center ${
                  inheritanceMode
                    ? 'bg-angel-600 text-white'
                    : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
                title="Inheritance Tree"
                onClick={() => setInheritanceMode(!inheritanceMode)}
              >
                <GitBranch size={14} />
              </button>
              <button
                className={`w-7 h-7 rounded flex items-center justify-center ${
                  traceOpen || traceNodeIds
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
                title="메소드 추적 (Call Trace)"
                onClick={() => {
                  if (traceNodeIds) { clearTrace() }
                  else { setTraceOpen(!traceOpen); setSearchOpen(false) }
                }}
              >
                <Route size={14} />
              </button>
              <button
                className={`w-7 h-7 rounded flex items-center justify-center ${
                  searchOpen
                    ? 'bg-angel-600 text-white'
                    : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
                title="Search (Ctrl+F)"
                onClick={() => { setSearchOpen(!searchOpen); setTraceOpen(false); if (searchOpen) { setMermaidSearchQuery(''); setMermaidMatchCount(0); setMermaidMatchIndex(0) } }}
              >
                <Search size={14} />
              </button>
              <button
                className="w-7 h-7 bg-slate-800/80 hover:bg-slate-700 rounded flex items-center justify-center text-slate-400 hover:text-white"
                title="Export PNG"
                onClick={handleExport}
              >
                <Download size={14} />
              </button>
              {/* Mermaid export button with dropdown */}
              <div className="relative">
                <button
                  className={`w-7 h-7 rounded flex items-center justify-center ${
                    mermaidMenuOpen || mermaidOpen
                      ? 'bg-violet-600 text-white'
                      : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700'
                  }`}
                  title="Mermaid Diagram"
                  onClick={() => {
                    if (mermaidOpen) { setMermaidOpen(false); setMermaidCode(''); setMermaidType(''); setMermaidMenuOpen(false); setMermaidSelectedFiles(new Set()) }
                    else { setMermaidMenuOpen(prev => !prev) }
                  }}
                >
                  <Waypoints size={14} />
                </button>
                {mermaidMenuOpen && (() => {
                  // When trace mode is active, filter to traced nodes/edges only
                  const isTracing = traceNodeIds && traceEdgeKeys
                  const mNodes = isTracing
                    ? nodes.filter(n => traceNodeIds!.has(n.id))
                    : nodes
                  const mEdges = isTracing
                    ? edges.filter(e => traceEdgeKeys!.has(`${e.source}→${e.target}`))
                    : edges
                  const traceLabel = isTracing ? ' (Trace)' : ''

                  return (
                    <div className="absolute bottom-8 right-full mr-1 w-36 bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden z-30">
                      <div className="px-2.5 py-1.5 text-[9px] text-slate-500 uppercase tracking-wide border-b border-slate-700 flex items-center justify-between">
                        <span>Mermaid Diagram</span>
                        {isTracing && <span className="text-emerald-400 normal-case">◉ Trace</span>}
                      </div>
                      {[
                        { key: 'class', label: 'Class Diagram', desc: 'Inheritance / Interface' },
                        { key: 'flow', label: 'Flowchart', desc: 'Call relationships' },
                        { key: 'sequence', label: 'Sequence Diagram', desc: 'Call order / sequence' },
                      ].map(item => (
                        <button
                          key={item.key}
                          className="w-full text-left px-2.5 py-1.5 hover:bg-slate-700 transition-colors"
                          onClick={() => {
                            let code = ''
                            if (item.key === 'class') code = generateClassDiagram(mNodes, mEdges)
                            else if (item.key === 'flow') code = generateFlowchart(mNodes, mEdges)
                            else code = generateSequenceDiagram(mNodes, mEdges, selectedNode?.id ?? null)
                            setMermaidCode(code)
                            setMermaidType(item.label + traceLabel)
                            setMermaidOpen(true)
                            setMermaidSelectedFiles(new Set())
                          }}
                        >
                          <div className="text-[10px] text-slate-200">{item.label}</div>
                          <div className="text-[9px] text-slate-500">{item.desc}</div>
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>
              <button
                className="w-7 h-7 bg-slate-800/80 hover:bg-slate-700 rounded flex items-center justify-center text-slate-400 hover:text-white"
                title="Zoom In"
                onClick={() => {
                  if (mermaidOpen) setMermaidZoom(z => z * 1.3)
                  else graphRef.current?.zoomIn()
                }}
              >
                <ZoomIn size={14} />
              </button>
              <button
                className="w-7 h-7 bg-slate-800/80 hover:bg-slate-700 rounded flex items-center justify-center text-slate-400 hover:text-white"
                title="Zoom Out"
                onClick={() => {
                  if (mermaidOpen) setMermaidZoom(z => Math.max(z / 1.3, 0.1))
                  else graphRef.current?.zoomOut()
                }}
              >
                <ZoomOut size={14} />
              </button>
              <button
                className={`w-7 h-7 rounded flex items-center justify-center ${
                  selectedNode
                    ? 'bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer'
                    : 'bg-slate-800/40 text-slate-600 cursor-default'
                }`}
                title={selectedNode ? `Focus on ${selectedNode.label}` : 'Select a node first'}
                onClick={() => selectedNode && graphRef.current?.focusOnNode(selectedNode.id)}
              >
                <Locate size={14} />
              </button>
              {/* Chat toggle */}
              <button
                className={`w-7 h-7 rounded flex items-center justify-center ${
                  chatOpen
                    ? 'bg-angel-600 text-white'
                    : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
                title="LLM Chat"
                onClick={() => setChatOpen(prev => !prev)}
              >
                <MessageSquare size={14} />
              </button>
              {/* LLM Settings */}
              <button
                className="w-7 h-7 bg-slate-800/80 hover:bg-slate-700 rounded flex items-center justify-center text-slate-400 hover:text-white"
                title="LLM Settings"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings size={14} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Right: Properties + Chat panels */}
      {(selectedNode || chatOpen) && (
        <div className="flex shrink-0 border-l border-slate-700">
          {selectedNode && (
            <div className={`w-72 bg-slate-900 shrink-0 ${chatOpen ? 'border-r border-slate-700' : ''}`}>
              <OntologyProperties
                node={selectedNode}
                edges={edges}
                allNodes={nodes}
                impactMap={impactMap}
                vulnerabilities={vulnerabilities}
                onClose={() => setSelectedNode(null)}
                onNavigate={handleNavigateToNode}
              />
            </div>
          )}
          {chatOpen && (
            <div className="w-80 bg-slate-900 shrink-0">
              <ChatPanel
                context={chatContext}
                activeConfig={getActiveConfig()}
                getActiveConfig={getActiveConfig}
                onClose={() => setChatOpen(false)}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            </div>
          )}
        </div>
      )}

      {/* LLM Settings Modal */}
      {settingsOpen && (
        <LLMSettingsModal
          settings={llmSettings}
          onUpdateProvider={updateProvider}
          onSetActiveProvider={setActiveProvider}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Documentation opens in external browser */}
    </div>
  )
}


/* ─── Mermaid Full View Component (renders in main canvas area) ─── */

function MermaidFullView({ code, type, zoom, onZoomChange, searchQuery, searchIndex, onMatchCount, fileFilterCount, onNodeClick }: {
  code: string; type: string; zoom: number; onZoomChange: (fn: (z: number) => number) => void
  searchQuery: string; searchIndex: number; onMatchCount: (n: number) => void
  fileFilterCount?: number; onNodeClick?: (label: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  // Pan (drag) state
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef({ active: false, sx: 0, sy: 0, px: 0, py: 0 })

  // Render mermaid, then manipulate the SVG DOM element directly
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    let cancelled = false
    setReady(false)
    wrap.innerHTML = ''

    ;(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false, theme: 'dark', maxTextSize: 200000,
          themeVariables: {
            primaryColor: '#4c1d95', primaryTextColor: '#e2e8f0',
            primaryBorderColor: '#6d28d9', lineColor: '#8b5cf6',
            secondaryColor: '#1e1b4b', tertiaryColor: '#0f172a',
            background: '#0a0a1a', mainBkg: '#1e1b4b',
            nodeBorder: '#6d28d9', clusterBkg: '#0f172a', clusterBorder: '#312e81',
            titleColor: '#c4b5fd',
            actorBkg: '#1e1b4b', actorBorder: '#6d28d9',
            actorTextColor: '#e2e8f0', actorLineColor: '#4c1d95',
            signalColor: '#8b5cf6', signalTextColor: '#e2e8f0',
            labelBoxBkgColor: '#1e1b4b', labelBoxBorderColor: '#6d28d9',
            labelTextColor: '#c4b5fd', loopTextColor: '#a78bfa',
            noteBkgColor: '#1e293b', noteTextColor: '#cbd5e1', noteBorderColor: '#334155',
            fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: '14px',
          },
          flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis', padding: 20 },
          sequence: { useMaxWidth: false, actorMargin: 60, mirrorActors: false },
        })

        const uniqueId = `mermaid-${Date.now()}`
        const { svg } = await mermaid.render(uniqueId, code)
        if (cancelled) return

        // Insert SVG into DOM
        wrap.innerHTML = svg

        const svgEl = wrap.querySelector('svg')
        if (svgEl) {
          // Ensure viewBox exists
          if (!svgEl.getAttribute('viewBox')) {
            const w = svgEl.width?.baseVal?.value
              || parseFloat(svgEl.getAttribute('width') || '0')
              || svgEl.getBoundingClientRect().width || 800
            const h = svgEl.height?.baseVal?.value
              || parseFloat(svgEl.getAttribute('height') || '0')
              || svgEl.getBoundingClientRect().height || 600
            svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`)
          }
          // Remove size constraints, fill parent
          svgEl.removeAttribute('width')
          svgEl.removeAttribute('height')
          svgEl.removeAttribute('style')
          svgEl.querySelectorAll('[style]').forEach(el => {
            const s = (el as HTMLElement).style
            if (s.maxWidth) s.maxWidth = ''
          })
          svgEl.setAttribute('width', '100%')
          svgEl.setAttribute('height', '100%')
          svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet')
          svgEl.style.cssText = 'display:block;max-width:none!important;'

          // Add pointer cursor to clickable node groups
          svgEl.querySelectorAll('g.node, g.classGroup').forEach(g => {
            ;(g as SVGElement).style.cursor = 'pointer'
          })
          // Sequence diagram actors
          svgEl.querySelectorAll('text.actor').forEach(t => {
            ;(t as SVGElement).style.cursor = 'pointer'
          })
        }

        setRenderError(null)
        // Auto-zoom: depends on diagram type
        // Class diagrams pack many items small → need high zoom
        // Flowchart / Sequence diagrams render large → keep zoom low
        let autoZoom = 1
        const isClass = type.toLowerCase().includes('class')
        if (isClass) {
          const classCount = (code.match(/^\s+class\s/gm) || []).length
          const lineCount = code.split('\n').length
          const complexity = Math.max(classCount, lineCount / 5)
          autoZoom = complexity <= 3 ? 1 : Math.max(1, Math.sqrt(complexity) * 1.2)
        }
        onZoomChange(() => autoZoom)
        setPan({ x: 0, y: 0 })
        setReady(true)
      } catch (err: any) {
        if (!cancelled) setRenderError(err.message || 'Render failed')
      }
    })()
    return () => { cancelled = true }
  }, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  // Click handler for diagram nodes → select node in properties panel
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || !ready || !onNodeClick) return

    const clickHandler = (e: MouseEvent) => {
      // Don't trigger on drag end
      const d = dragRef.current
      if (d.active) return

      const target = e.target as Element
      if (!target) return

      // Walk up the DOM to find a clickable Mermaid node group
      let el: Element | null = target
      let label = ''

      while (el && el !== wrap) {
        // Class diagram: nodes are in <g> elements with class containing 'classGroup' or 'node'
        // Flowchart: nodes are <g class="node ..."> with an id like "flowchart-NodeName-NNN"
        // Sequence: actors are <g class="actor-man"> or <text class="actor">

        if (el.tagName === 'g') {
          const classList = el.getAttribute('class') || ''
          const elId = el.getAttribute('id') || ''

          // Flowchart nodes: <g class="node ..."> id="flowchart-XXX-NNN"
          if (classList.includes('node') && !classList.includes('nodes')) {
            // Extract label from the text content inside the node
            const textEl = el.querySelector('span.nodeLabel, foreignObject span, foreignObject div, text')
            if (textEl?.textContent) {
              label = textEl.textContent.trim()
              break
            }
          }

          // Class diagram: <g> with id containing the class name
          if (classList.includes('classGroup')) {
            const textEl = el.querySelector('text.classTitle, text')
            if (textEl?.textContent) {
              label = textEl.textContent.trim()
              break
            }
          }
        }

        // Sequence diagram: actor text
        if (el.tagName === 'text') {
          const classList = el.getAttribute('class') || ''
          if (classList.includes('actor')) {
            label = el.textContent?.trim() || ''
            if (label) break
          }
        }

        // Click on text/span inside a node
        if ((el.tagName === 'SPAN' || el.tagName === 'span') && el.classList.contains('nodeLabel')) {
          label = el.textContent?.trim() || ''
          if (label) break
        }

        // foreignObject content (class diagram labels, flowchart labels)
        if (el.tagName === 'foreignObject' || el.closest?.('foreignObject')) {
          const textContent = (el.textContent || '').trim()
          if (textContent) {
            // For class diagrams, get just the class title (first line / header)
            label = textContent.split('\n')[0].trim()
            if (label) break
          }
        }

        el = el.parentElement
      }

      // If we didn't find by walking up, try finding the closest node group
      if (!label) {
        const nodeGroup = target.closest?.('g.node, g.classGroup, g.actor')
        if (nodeGroup) {
          const textEl = nodeGroup.querySelector('span.nodeLabel, foreignObject span, foreignObject div, text.classTitle, text')
          if (textEl?.textContent) {
            label = textEl.textContent.trim()
          }
        }
      }

      if (label) {
        // Clean up label: remove stereotypes like <<interface>>, method signatures, etc.
        label = label.replace(/<<\w+>>/g, '').trim()
        // For class diagram, the label might contain methods; take just the class name
        if (label.includes('\n')) label = label.split('\n')[0].trim()
        // Remove leading + or - (method visibility markers)
        label = label.replace(/^[+\-#~]\s*/, '').trim()

        if (label) {
          e.stopPropagation()
          onNodeClick(label)
        }
      }
    }

    // Use mouseup instead of click to not conflict with drag
    let mouseDownPos = { x: 0, y: 0 }
    const mouseDownHandler = (e: MouseEvent) => {
      mouseDownPos = { x: e.clientX, y: e.clientY }
    }
    const mouseUpHandler = (e: MouseEvent) => {
      // Only fire click if mouse didn't move much (not a drag)
      const dx = Math.abs(e.clientX - mouseDownPos.x)
      const dy = Math.abs(e.clientY - mouseDownPos.y)
      if (dx < 5 && dy < 5) {
        clickHandler(e)
      }
    }

    wrap.addEventListener('mousedown', mouseDownHandler, true)
    wrap.addEventListener('mouseup', mouseUpHandler, true)
    return () => {
      wrap.removeEventListener('mousedown', mouseDownHandler, true)
      wrap.removeEventListener('mouseup', mouseUpHandler, true)
    }
  }, [ready, onNodeClick])

  // Wheel: zoom (Ctrl) or pan
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        onZoomChange(z => Math.max(0.2, z * (e.deltaY > 0 ? 0.9 : 1.1)))
      } else {
        setPan(p => ({ x: p.x - e.deltaX * 1.5, y: p.y - e.deltaY * 1.5 }))
      }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [onZoomChange])

  // Drag handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragRef.current = { active: true, sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }
    ;(e.currentTarget as HTMLElement).style.cursor = 'grabbing'
  }, [pan])
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current
    if (!d.active) return
    setPan({ x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) })
  }, [])
  const onMouseUp = useCallback((e: React.MouseEvent) => {
    dragRef.current.active = false
    ;(e.currentTarget as HTMLElement).style.cursor = 'grab'
  }, [])

  // Search: highlight matching text elements in SVG
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    // Clear previous highlights
    wrap.querySelectorAll('.mermaid-search-highlight').forEach(el => {
      if (el instanceof SVGElement) {
        el.style.fill = ''
        el.style.stroke = ''
      } else {
        ;(el as HTMLElement).style.color = ''
        ;(el as HTMLElement).style.backgroundColor = ''
      }
      ;(el as HTMLElement).style.fontWeight = ''
      el.classList.remove('mermaid-search-highlight', 'mermaid-search-current')
    })
    wrap.querySelectorAll('rect.mermaid-highlight-bg').forEach(el => el.remove())

    if (!searchQuery || searchQuery.length < 1) {
      onMatchCount(0)
      return
    }

    const query = searchQuery.toLowerCase()
    // Search both SVG text elements and HTML elements inside foreignObject
    const candidates = wrap.querySelectorAll('text, tspan, foreignObject span, foreignObject p, foreignObject div')
    const matches: Element[] = []
    const seen = new Set<string>()

    candidates.forEach(el => {
      // Skip parent elements whose children will also be matched (avoid duplicates)
      const text = el.textContent?.toLowerCase() || ''
      if (!text.includes(query)) return
      // For text/tspan: skip parent <text> if <tspan> children match
      if (el.tagName === 'text' && el.querySelector('tspan')) return
      // For HTML elements: only match leaf-level text containers
      if ((el.tagName === 'DIV' || el.tagName === 'P') && el.querySelector('span')) return
      // Deduplicate by text content + position
      const key = `${el.tagName}:${text}:${(el as HTMLElement).offsetTop || 0}`
      if (seen.has(key)) return
      seen.add(key)

      matches.push(el)
      el.classList.add('mermaid-search-highlight')
      if (el instanceof SVGElement) {
        ;(el as SVGElement).style.fill = '#fbbf24'
      } else {
        ;(el as HTMLElement).style.color = '#fbbf24'
        ;(el as HTMLElement).style.backgroundColor = 'rgba(251,191,36,0.15)'
      }
      ;(el as HTMLElement).style.fontWeight = 'bold'
    })

    onMatchCount(matches.length)
    if (matches.length > 0) {
      const idx = Math.min(searchIndex, matches.length - 1)
      // Highlight current match differently
      matches.forEach((el, i) => {
        if (i === idx) {
          el.classList.add('mermaid-search-current')
          if (el instanceof SVGElement) {
            ;(el as SVGElement).style.fill = '#f97316'
          } else {
            ;(el as HTMLElement).style.color = '#f97316'
            ;(el as HTMLElement).style.backgroundColor = 'rgba(249,115,22,0.25)'
          }
          // Scroll into view: calculate position and adjust pan
          const container = containerRef.current
          if (container) {
            const elRect = el.getBoundingClientRect()
            const containerRect = container.getBoundingClientRect()
            const elCenterX = elRect.left + elRect.width / 2
            const elCenterY = elRect.top + elRect.height / 2
            const containerCX = containerRect.left + containerRect.width / 2
            const containerCY = containerRect.top + containerRect.height / 2
            setPan(p => ({ x: p.x + (containerCX - elCenterX), y: p.y + (containerCY - elCenterY) }))
          }
        }
      })
    }
  }, [searchQuery, searchIndex, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full" style={{ background: 'linear-gradient(135deg, #0a0a1a 0%, #0f0f23 50%, #0a0a1a 100%)' }}>
      {/* Top bar */}
      <div className="flex items-center px-5 py-2.5 shrink-0 relative" style={{ borderBottom: '1px solid rgba(99,102,241,0.12)' }}>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
            <span className="text-[11px] font-medium tracking-wide text-violet-300/90">{type}</span>
            {fileFilterCount != null && fileFilterCount > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-600/40 text-violet-300">
                {fileFilterCount} file{fileFilterCount > 1 ? 's' : ''}
              </span>
            )}
            <span className="text-[9px] text-slate-600 font-mono">{Math.round(zoom * 100)}%</span>
          </div>
        </div>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative select-none"
        style={{ cursor: 'grab' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        {renderError ? (
          <div className="flex items-center justify-center h-full p-8">
            <div className="text-center max-w-md">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-3">
                <AlertTriangle size={18} className="text-red-400" />
              </div>
              <p className="text-[11px] font-medium text-red-300 mb-1">Diagram render failed</p>
              <p className="text-[10px] text-red-400/70 leading-relaxed">{renderError}</p>
            </div>
          </div>
        ) : !ready ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-slate-600 text-xs animate-pulse">Rendering diagram…</div>
          </div>
        ) : null}
        {/* SVG wrapper — always in DOM, sized to fill container × zoom, positioned by pan */}
        <div
          ref={wrapRef}
          style={{
            position: 'absolute',
            left: `calc(50% + ${pan.x}px)`,
            top: `calc(50% + ${pan.y}px)`,
            transform: 'translate(-50%, -50%)',
            width: `${zoom * 100}%`,
            height: `${zoom * 100}%`,
            visibility: ready ? 'visible' : 'hidden',
          }}
        />

      </div>
    </div>
  )
}

/* ─── Mermaid Diagram Generators ─── */

/** Sanitize label for Mermaid identifiers (remove special chars) */
function mermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_')
}

/** Sanitize label for display in Mermaid (escape quotes) */
function mermaidLabel(label: string): string {
  return label.replace(/"/g, '#quot;')
}

function generateClassDiagram(nodes: GraphNode[], edges: GraphEdge[]): string {
  const lines: string[] = ['classDiagram']

  // Collect class/interface nodes
  const classNodes = new Map<string, GraphNode>()
  for (const n of nodes) {
    if (n.type === 'class' || n.type === 'interface') {
      classNodes.set(n.id, n)
    }
  }
  if (classNodes.size === 0) return '%%  No class/interface nodes found\nclassDiagram\n  class Empty'

  // Collect methods per class (class→method calls edges)
  const classMethods = new Map<string, string[]>()
  for (const e of edges) {
    if (e.type === 'calls' && classNodes.has(e.source)) {
      const targetNode = nodes.find(n => n.id === e.target)
      if (targetNode && targetNode.type === 'method') {
        if (!classMethods.has(e.source)) classMethods.set(e.source, [])
        classMethods.get(e.source)!.push(targetNode.label)
      }
    }
  }

  // Inheritance/Implementation relationships
  for (const e of edges) {
    if (e.type === 'extends' || e.type === 'implements') {
      const src = classNodes.get(e.source) ?? nodes.find(n => n.id === e.source)
      const tgt = classNodes.get(e.target) ?? nodes.find(n => n.id === e.target)
      if (src && tgt) {
        const arrow = e.type === 'extends' ? '<|--' : '<|..'
        lines.push(`  ${mermaidLabel(tgt.label)} ${arrow} ${mermaidLabel(src.label)}`)
      }
    }
  }

  // Class definitions with methods
  for (const [cid, cnode] of classNodes) {
    const methods = classMethods.get(cid) || []
    if (cnode.type === 'interface') {
      lines.push(`  class ${mermaidLabel(cnode.label)} {`)
      lines.push(`    <<interface>>`)
    } else {
      lines.push(`  class ${mermaidLabel(cnode.label)} {`)
    }
    for (const m of methods) {
      // Clean method label: remove class prefix if present
      const shortName = m.includes('.') ? m.split('.').pop()! : m
      lines.push(`    +${shortName}`)
    }
    lines.push('  }')
  }

  return lines.join('\n')
}

function generateFlowchart(nodes: GraphNode[], edges: GraphEdge[]): string {
  const lines: string[] = ['graph LR']

  // Only include calls edges between method/function/class nodes
  const relevantTypes = new Set(['method', 'function', 'class'])
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const usedNodes = new Set<string>()
  const callEdges: GraphEdge[] = []

  for (const e of edges) {
    if (e.type !== 'calls') continue
    const src = nodeMap.get(e.source)
    const tgt = nodeMap.get(e.target)
    if (!src || !tgt) continue
    if (!relevantTypes.has(src.type) || !relevantTypes.has(tgt.type)) continue
    callEdges.push(e)
    usedNodes.add(e.source)
    usedNodes.add(e.target)
  }

  if (callEdges.length === 0) return '%%  No call relationships found\ngraph LR\n  Empty["No calls"]'

  // Node definitions
  for (const nid of usedNodes) {
    const n = nodeMap.get(nid)!
    const shape = n.type === 'class' ? `[["${mermaidLabel(n.label)}"]]` : `["${mermaidLabel(n.label)}"]`
    lines.push(`  ${mermaidId(nid)}${shape}`)
  }

  // Edge definitions
  for (const e of callEdges) {
    lines.push(`  ${mermaidId(e.source)} --> ${mermaidId(e.target)}`)
  }

  // Style circular edges in red
  const circularEdges = callEdges.filter(e => e.circular)
  if (circularEdges.length > 0) {
    const circularNodes = new Set<string>()
    for (const e of circularEdges) {
      circularNodes.add(e.source)
      circularNodes.add(e.target)
    }
    for (const nid of circularNodes) {
      lines.push(`  style ${mermaidId(nid)} stroke:#f44,stroke-width:2px`)
    }
  }

  return lines.join('\n')
}

function generateSequenceDiagram(nodes: GraphNode[], edges: GraphEdge[], selectedNodeId: string | null): string {
  const lines: string[] = ['sequenceDiagram']
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  // Collect calls edges with order, filtered by selected node if any
  let callEdges = edges
    .filter(e => e.type === 'calls' && e.order != null)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  if (selectedNodeId) {
    // Show calls FROM the selected node (its outgoing call sequence)
    callEdges = callEdges.filter(e => e.source === selectedNodeId)
    if (callEdges.length === 0) {
      // Fallback: show calls TO the selected node
      callEdges = edges
        .filter(e => e.type === 'calls' && e.target === selectedNodeId && e.order != null)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    }
  }

  // Limit to avoid huge diagrams
  callEdges = callEdges.slice(0, 50)

  if (callEdges.length === 0) return '%%  No ordered call sequences found\nsequenceDiagram\n  Note over App: No call sequence data'

  // Collect participants in order of first appearance
  const participants: string[] = []
  const participantSet = new Set<string>()
  for (const e of callEdges) {
    if (!participantSet.has(e.source)) {
      participantSet.add(e.source)
      participants.push(e.source)
    }
    if (!participantSet.has(e.target)) {
      participantSet.add(e.target)
      participants.push(e.target)
    }
  }

  // Declare participants
  for (const pid of participants) {
    const n = nodeMap.get(pid)
    const label = n ? n.label : pid.split(':').pop() || pid
    lines.push(`  participant ${mermaidId(pid)} as ${mermaidLabel(label)}`)
  }

  // Sequence arrows
  for (const e of callEdges) {
    const tgt = nodeMap.get(e.target)
    const callLabel = tgt ? tgt.label : e.target.split(':').pop() || 'call'
    const shortLabel = callLabel.includes('.') ? callLabel.split('.').pop()! : callLabel
    lines.push(`  ${mermaidId(e.source)} ->> ${mermaidId(e.target)}: ${(e.order ?? 0) + 1}. ${shortLabel}`)
  }

  return lines.join('\n')
}
