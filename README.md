# Ontology Analyzer

**AST-based code structure visualization & security scanning desktop application**

Ontology Analyzer parses source code using regex-based AST analysis, builds a dependency graph, and renders it as an interactive force-directed visualization. It detects circular dependencies, dead code, and security vulnerabilities — all in a native Electron desktop app.

![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)

<p align="center">
  <img src="assets/screenshot.png" alt="Ontology Analyzer Screenshot" width="900" />
</p>

---

## Features

### Code Structure Visualization
- **Force-directed graph** with real-time physics simulation (spring-damper model)
- **3 layout algorithms**: Force, Tree (hierarchical), Radial
- **Interactive canvas**: Pan, zoom, drag nodes, click to inspect
- **Minimap** (bottom-right) for navigation in large graphs
- **Cluster coloring** via label propagation community detection
- **Code preview on hover**: Shows source code snippet around the hovered node

### Analysis Capabilities
- **Circular dependency detection** — DFS back-edge algorithm, highlighted with red dashed edges
- **Dead code detection** — Methods/functions with zero incoming call edges, shown as gray dashed nodes
- **Security vulnerability scanning** — Semgrep-based SAST with bundled custom rules
- **Impact analysis** — BFS-based scope highlighting (3 levels deep) from any selected node
- **Complexity metrics** — Fan-in, Fan-out, Lines of code per node

### Supported Languages
| Language | Extensions | Parsing |
|----------|-----------|---------|
| Java | `.java` | Classes, interfaces, methods, inheritance, call graph |
| Python | `.py` | Modules, classes, functions, imports |
| TypeScript / JavaScript | `.ts` `.tsx` `.js` `.jsx` `.mjs` | Modules, classes, functions, imports |
| Go | `.go` | Functions, imports |
| C / C++ | `.c` `.cpp` `.cc` `.h` `.hpp` | Functions, includes |

### File Selection
- **Open Folder**: Recursively scan an entire directory
- **Open Files**: Pick specific source files for targeted analysis (multi-select)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron (Main Process)                │
│  electron/main.ts — Window, IPC handlers, backend spawn  │
└──────────┬──────────────────────────────────┬────────────┘
           │ IPC (select-folder, select-files) │
           ▼                                   ▼
┌──────────────────────┐        ┌──────────────────────────┐
│   React Frontend     │  HTTP  │   Python FastAPI Backend  │
│   (Renderer Process) │◄──────►│   port 8766               │
│                      │        │                          │
│  ┌────────────────┐  │        │  /api/ontology/analyze   │
│  │ OntologyPanel  │  │        │  /api/ontology/list-files│
│  │  ├─ FileList   │  │        │  /api/ontology/code-prev │
│  │  ├─ Graph      │  │        │  /api/health             │
│  │  └─ Properties │  │        │                          │
│  └────────────────┘  │        │  Parsers: Java, Python,  │
│                      │        │  TS/JS, Go, C/C++        │
│  Vite + Tailwind CSS │        │  Semgrep integration     │
└──────────────────────┘        └──────────────────────────┘
```

### Frontend (`src/`)
| Component | Description |
|-----------|-------------|
| `App.tsx` | Root component, backend health polling |
| `OntologyPanel.tsx` | Main orchestrator — state management, API calls, toolbar |
| `OntologyFileList.tsx` | Left panel — folder/file selector, file tree with search |
| `OntologyGraph.tsx` | Center panel — Canvas-based graph rendering with physics engine |
| `OntologyProperties.tsx` | Right panel — Node details, metrics, vulnerability list |

### Backend (`backend/`)
| File | Description |
|------|-------------|
| `main.py` | FastAPI app with CORS middleware |
| `api/routes_ontology.py` | All endpoints — parsing, analysis, Semgrep scanning |
| `security/semgrep-rules.yml` | Bundled security rules (SQL injection, XSS, hardcoded secrets, etc.) |

---

## Getting Started

### Prerequisites
- **Node.js** >= 18
- **Python** >= 3.10
- **pip packages**: `fastapi`, `uvicorn`, `pydantic`
- **Semgrep** (optional, for vulnerability scanning): `pip install semgrep`

### Install Dependencies

```bash
# Frontend
npm install

# Backend
pip install -r backend/requirements.txt

# Optional: Security scanning
pip install semgrep
```

### Development

**Option 1: Quick start (Windows)**
```bash
start.bat
```
This starts both the backend and Electron app automatically.

**Option 2: Manual start**
```bash
# Terminal 1 — Backend
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8766

# Terminal 2 — Electron + Vite
npm run electron:dev
```

**Option 3: Frontend only (browser)**
```bash
# Terminal 1 — Backend
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8766

# Terminal 2 — Vite dev server
npm run dev
# Open http://localhost:5174
```

---

## Build & Package

### Full Production Build (Windows)

```bash
build.bat
```

This runs 5 steps:
1. **PyInstaller** — Bundles Python backend into `dist-backend/main/main.exe`
2. **PyInstaller** — Bundles Semgrep scanner into `dist-semgrep/semgrep/semgrep.exe`
3. **Vite** — Builds React frontend into `dist/`
4. **TypeScript** — Compiles Electron main process into `dist-electron/`
5. **electron-builder** — Packages everything into NSIS installer

### Individual Steps

```bash
# Backend only
pyinstaller main.spec --noconfirm --distpath dist-backend

# Semgrep only
pyinstaller semgrep.spec --noconfirm --distpath dist-semgrep

# Frontend only
npx vite build

# Electron TypeScript only
npx tsc -p tsconfig.electron.json

# Package only (requires steps 1-4 first)
npx electron-builder --win
```

### Output
```
release/
  Ontology Analyzer Setup {version}.exe    # NSIS installer (~90 MB)
```

---

## Usage Guide

### Basic Workflow
1. Launch the app
2. Click **"Select folder or files..."** (top-left)
3. Choose **Open Folder** to scan a project, or **Open Files** to pick specific files
4. Wait for analysis to complete (file list + graph appear)
5. Interact with the graph — click nodes, hover for code preview

### Graph Interaction
| Action | Effect |
|--------|--------|
| **Click node** | Select — opens Properties panel on the right |
| **Hover node** | Shows code preview tooltip after 400ms |
| **Drag node** | Repositions node (force layout re-stabilizes) |
| **Scroll wheel** | Zoom in/out |
| **Click + drag background** | Pan the canvas |
| **Ctrl+F** | Open node search |
| **Esc** | Close search / clear selection |

### Layout Modes
| Mode | Button | Description |
|------|--------|-------------|
| **Force** | `F` | Spring-damper physics simulation (default) |
| **Tree** | `T` | Hierarchical top-down layout |
| **Radial** | `R` | Circular layout with root at center |

### Status Badges (top-right)
| Badge | Meaning |
|-------|---------|
| **N cycles** | Circular dependencies detected — click to navigate |
| **N dead** | Unreferenced methods/functions — click to navigate |
| **N vulns** | Security vulnerabilities found — click to navigate |

### Toolbar (bottom-right)
- **F / T / R** — Layout mode selector
- **Inheritance tree** icon — Filter to show only extends/implements relationships
- **Search** icon — Toggle node search (Ctrl+F)
- **Focus** icon — Reset view to fit all nodes
- **Export** icon — Download graph as PNG
- **Zoom +/-** — Zoom controls

### Properties Panel (right sidebar)
When a node is selected, the panel shows:
- **Node type** and file location
- **Complexity metrics**: Fan-in, Fan-out, Lines of code
- **Connected nodes**: Incoming and outgoing edges with clickable navigation
- **Call order**: Sequential call numbering within methods
- **Impact scope**: BFS-highlighted nodes within 3 levels
- **Vulnerabilities**: Semgrep findings associated with the node

---

## Security Scanning

Ontology Analyzer integrates [Semgrep](https://semgrep.dev/) for static application security testing (SAST).

### Bundled Rules
The file `backend/security/semgrep-rules.yml` includes custom rules for:
- **SQL Injection** — String formatting, f-strings, concatenation in queries
- **Cross-Site Scripting (XSS)** — Unsafe template rendering
- **Hardcoded Credentials** — Passwords, API keys, tokens in source
- **Command Injection** — Unsafe `os.system()`, `subprocess` calls
- **Path Traversal** — Unsanitized file path inputs
- And more across Python, Java, JavaScript, Go, C/C++

### How It Works
1. After code structure analysis completes, Semgrep runs in parallel
2. Results are mapped to the nearest enclosing node (class/method/function)
3. Vulnerable nodes get a `vulnCount` badge on the graph
4. Click the **vulns** badge (top-right) to navigate through findings
5. Full details appear in the Properties panel

### Install Semgrep
```bash
pip install semgrep
```
> Note: Semgrep is optional. The graph visualization works without it — you'll just see a non-blocking warning if it's not installed.

---

## Project Structure

```
ontology-analyzer/
├── electron/                  # Electron main process
│   ├── main.ts                # App entry, window, IPC, backend spawn
│   └── preload.ts             # Context bridge (electronAPI)
├── src/                       # React frontend
│   ├── App.tsx                # Root component
│   ├── api/
│   │   └── client.ts          # API client (fetch wrapper)
│   ├── components/
│   │   └── Ontology/
│   │       ├── OntologyPanel.tsx       # Main orchestrator
│   │       ├── OntologyFileList.tsx    # File tree + selector
│   │       ├── OntologyGraph.tsx       # Canvas graph renderer
│   │       └── OntologyProperties.tsx  # Node details panel
│   └── types/
│       └── electron.d.ts      # Electron API type definitions
├── backend/                   # Python FastAPI backend
│   ├── main.py                # FastAPI app
│   ├── requirements.txt       # Python dependencies
│   ├── api/
│   │   └── routes_ontology.py # Parsers + API endpoints
│   └── security/
│       └── semgrep-rules.yml  # Custom SAST rules
├── start.bat                  # Dev launcher (Windows)
├── build.bat                  # Production build script
├── package.json               # Node.js dependencies
├── electron-builder.yml       # Packaging configuration
├── vite.config.ts             # Vite configuration
├── tailwind.config.mjs        # Tailwind CSS configuration
├── tsconfig.json              # TypeScript config (frontend)
├── tsconfig.electron.json     # TypeScript config (Electron)
├── main.spec                  # PyInstaller spec
└── index.html                 # HTML entry point
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Desktop** | Electron 31 |
| **Frontend** | React 18 + TypeScript 5.5 |
| **Build Tool** | Vite 5.4 |
| **Styling** | Tailwind CSS 3.4 |
| **Icons** | Lucide React |
| **Backend** | Python 3.12 + FastAPI 0.115 |
| **ASGI Server** | Uvicorn |
| **Security Scanner** | Semgrep |
| **Bundler (Backend)** | PyInstaller |
| **Packager** | electron-builder (NSIS) |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/ontology/analyze` | Analyze code structure + vulnerabilities |
| `POST` | `/api/ontology/list-files` | List supported source files |
| `POST` | `/api/ontology/code-preview` | Get code snippet around a line number |

### Request/Response Examples

**POST /api/ontology/analyze**
```json
// Request
{ "path": "C:/projects/my-app", "files": null }

// Response
{
  "nodes": [
    { "id": "class:UserService", "label": "UserService", "type": "class",
      "file": "src/services/UserService.java", "line": 15,
      "cluster": 0, "size": 5, "fanIn": 3, "fanOut": 7,
      "lines": 120, "dead": false, "vulnCount": 1 }
  ],
  "edges": [
    { "source": "class:UserService", "target": "class:UserRepository",
      "type": "calls", "order": 0, "circular": false }
  ],
  "vulnerabilities": [
    { "rule": "sql-injection-format", "severity": "critical",
      "message": "SQL injection via string formatting",
      "line": 42, "file": "src/services/UserService.java",
      "nodeId": "method:UserService.findByName" }
  ]
}
```

---

## License

MIT
