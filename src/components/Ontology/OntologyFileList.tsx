import { FolderOpen, FileCode, ChevronRight, ChevronDown, Search, ChevronUp, Files, FilePlus2, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'

interface FileEntry {
  path: string
  ext: string
}

interface Props {
  folderPath: string
  files: FileEntry[]
  loading: boolean
  highlightFile: string | null
  hasSelectedFiles: boolean
  multiSelectedFiles?: Set<string>
  onSelectFolder: () => void
  onSelectFiles: () => void
  onAddFiles: () => void
  onHighlightFile: (file: string | null) => void
  onFileClick?: (file: string, shiftKey: boolean) => void
}

// Build a simple tree from flat file paths
interface TreeNode {
  name: string
  path: string
  isDir: boolean
  children: TreeNode[]
  ext?: string
}

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] }

  for (const f of files) {
    const parts = f.path.split('/')
    let current = root
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]
      const isLast = i === parts.length - 1
      let child = current.children.find((c) => c.name === name)
      if (!child) {
        child = {
          name,
          path: isLast ? f.path : parts.slice(0, i + 1).join('/'),
          isDir: !isLast,
          children: [],
          ext: isLast ? f.ext : undefined,
        }
        current.children.push(child)
      }
      current = child
    }
  }

  // Sort: dirs first, then alphabetical
  const sortTree = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((n) => sortTree(n.children))
  }
  sortTree(root.children)
  return root.children
}

/** Collect all directory paths from a tree */
function collectDirPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = []
  for (const n of nodes) {
    if (n.isDir) {
      paths.push(n.path)
      paths.push(...collectDirPaths(n.children))
    }
  }
  return paths
}

const EXT_COLORS: Record<string, string> = {
  '.java': 'text-orange-400',
  '.py': 'text-yellow-400',
  '.ts': 'text-blue-400',
  '.tsx': 'text-blue-400',
  '.js': 'text-yellow-300',
  '.jsx': 'text-yellow-300',
  '.go': 'text-cyan-400',
  '.c': 'text-gray-400',
  '.cpp': 'text-gray-400',
  '.h': 'text-gray-400',
}

function TreeItem({
  node,
  depth,
  highlightFile,
  multiSelectedFiles,
  expandedDirs,
  onToggleDir,
  onHighlightFile,
  onFileClick,
}: {
  node: TreeNode
  depth: number
  highlightFile: string | null
  multiSelectedFiles?: Set<string>
  expandedDirs: Set<string>
  onToggleDir: (path: string) => void
  onHighlightFile: (file: string | null) => void
  onFileClick?: (file: string, shiftKey: boolean) => void
}) {
  const isHighlighted = highlightFile === node.path
  const isMultiSelected = multiSelectedFiles?.has(node.path) ?? false

  if (node.isDir) {
    const expanded = expandedDirs.has(node.path)
    return (
      <div>
        <button
          className="flex items-center gap-1 w-full text-left px-2 py-0.5 hover:bg-slate-700/50 text-xs text-slate-300"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => onToggleDir(node.path)}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <FolderOpen size={12} className="text-amber-400" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            highlightFile={highlightFile}
            multiSelectedFiles={multiSelectedFiles}
            expandedDirs={expandedDirs}
            onToggleDir={onToggleDir}
            onHighlightFile={onHighlightFile}
            onFileClick={onFileClick}
          />
        ))}
      </div>
    )
  }

  return (
    <button
      className={`flex items-center gap-1 w-full text-left px-2 py-0.5 text-xs truncate ${
        isMultiSelected
          ? 'bg-violet-600/30 text-violet-200'
          : isHighlighted
            ? 'bg-angel-600/30 text-white'
            : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={(e) => {
        if (onFileClick) {
          onFileClick(node.path, e.shiftKey)
        } else {
          onHighlightFile(isHighlighted ? null : node.path)
        }
      }}
    >
      <FileCode size={12} className={EXT_COLORS[node.ext || ''] || 'text-slate-500'} />
      <span className="truncate">{node.name}</span>
    </button>
  )
}

export default function OntologyFileList({
  folderPath,
  files,
  loading,
  highlightFile,
  hasSelectedFiles,
  multiSelectedFiles,
  onSelectFolder,
  onSelectFiles,
  onAddFiles,
  onHighlightFile,
  onFileClick,
}: Props) {
  const [filter, setFilter] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const menuRef = useRef<HTMLDivElement>(null)
  const tree = useMemo(() => {
    const filtered = filter
      ? files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()))
      : files
    return buildTree(filtered)
  }, [files, filter])

  // Auto-expand top 2 levels when tree changes
  useEffect(() => {
    const auto = new Set<string>()
    for (const n of tree) {
      if (n.isDir) {
        auto.add(n.path)
        for (const c of n.children) {
          if (c.isDir) auto.add(c.path)
        }
      }
    }
    setExpandedDirs(auto)
  }, [tree])

  const onToggleDir = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const expandAll = useCallback(() => {
    setExpandedDirs(new Set(collectDirPaths(tree)))
  }, [tree])

  const collapseAll = useCallback(() => {
    setExpandedDirs(new Set())
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const allDirPaths = useMemo(() => collectDirPaths(tree), [tree])
  const hasDirs = allDirPaths.length > 0
  const allExpanded = hasDirs && allDirPaths.every(p => expandedDirs.has(p))

  return (
    <div className="flex flex-col h-full">
      {/* Folder / File selector */}
      <div className="p-2 border-b border-slate-700">
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 w-full px-3 py-2 bg-slate-700/50 hover:bg-slate-600/50 rounded text-xs text-slate-200 transition-colors"
          >
            <FolderOpen size={14} className="text-angel-400 shrink-0" />
            <span className="truncate flex-1 text-left">{folderPath || 'Select folder or files...'}</span>
            {menuOpen ? <ChevronUp size={12} className="shrink-0 text-slate-400" /> : <ChevronDown size={12} className="shrink-0 text-slate-400" />}
          </button>
          {menuOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded shadow-lg z-20 overflow-hidden">
              <button
                onClick={() => { setMenuOpen(false); onSelectFolder() }}
                className="flex items-center gap-2 w-full px-3 py-2 hover:bg-slate-700 text-xs text-slate-200 transition-colors"
              >
                <FolderOpen size={13} className="text-amber-400 shrink-0" />
                <span>Open Folder</span>
              </button>
              <button
                onClick={() => { setMenuOpen(false); onSelectFiles() }}
                className="flex items-center gap-2 w-full px-3 py-2 hover:bg-slate-700 text-xs text-slate-200 transition-colors border-t border-slate-700"
              >
                <Files size={13} className="text-blue-400 shrink-0" />
                <span>Open Files</span>
              </button>
              {hasSelectedFiles && (
                <button
                  onClick={() => { setMenuOpen(false); onAddFiles() }}
                  className="flex items-center gap-2 w-full px-3 py-2 hover:bg-slate-700 text-xs text-slate-200 transition-colors border-t border-slate-700"
                >
                  <FilePlus2 size={13} className="text-green-400 shrink-0" />
                  <span>Add Files</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Search + Expand/Collapse */}
      {files.length > 0 && (
        <div className="p-2 border-b border-slate-700 flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter files..."
              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 pl-7 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-angel-500"
            />
          </div>
          {hasDirs && (
            <button
              onClick={allExpanded ? collapseAll : expandAll}
              className="w-6 h-6 rounded flex items-center justify-center bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-600 transition-colors shrink-0"
              title={allExpanded ? 'Collapse all' : 'Expand all'}
            >
              {allExpanded ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
            </button>
          )}
        </div>
      )}

      {/* File tree */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-xs text-slate-500">
            <div className="animate-spin w-4 h-4 border-2 border-angel-500 border-t-transparent rounded-full mr-2" />
            Analyzing...
          </div>
        ) : files.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-slate-500">
            {folderPath ? 'No source files found' : 'Select a folder to analyze'}
          </div>
        ) : (
          <div className="py-1">
            {(highlightFile || (multiSelectedFiles && multiSelectedFiles.size > 0)) && (
              <button
                onClick={() => {
                  onHighlightFile(null)
                  if (onFileClick) onFileClick('', false) // signal clear
                }}
                className="w-full text-left px-3 py-1 text-xs text-angel-400 hover:text-angel-300 border-b border-slate-700/50"
              >
                {multiSelectedFiles && multiSelectedFiles.size > 0
                  ? `Clear selection (${multiSelectedFiles.size} files)`
                  : 'Clear filter'}
              </button>
            )}
            {tree.map((node) => (
              <TreeItem
                key={node.path}
                node={node}
                depth={0}
                highlightFile={highlightFile}
                multiSelectedFiles={multiSelectedFiles}
                expandedDirs={expandedDirs}
                onToggleDir={onToggleDir}
                onHighlightFile={onHighlightFile}
                onFileClick={onFileClick}
              />
            ))}
            <div className="px-3 py-2 text-xs text-slate-600">
              {files.length} files
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
