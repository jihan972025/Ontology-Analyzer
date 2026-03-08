import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'

let mainWindow: BrowserWindow | null = null
let pythonProcess: ChildProcess | null = null

const isDev = !app.isPackaged

function getDisplayVersion(): string {
  return app.getVersion()
}

function findPythonBackend(): string | null {
  if (isDev) return null // dev mode uses external uvicorn
  const resourcesPath = process.resourcesPath
  const exePath = path.join(resourcesPath, 'backend', 'main.exe')
  if (fs.existsSync(exePath)) return exePath
  return null
}

function startBackend() {
  const backendPath = findPythonBackend()
  if (!backendPath) {
    console.log('[Ontology] Dev mode: backend should be started manually')
    return
  }

  console.log('[Ontology] Starting backend:', backendPath)
  pythonProcess = spawn(backendPath, [], {
    cwd: path.dirname(backendPath),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })

  pythonProcess.stdout?.on('data', (data: Buffer) => {
    console.log('[Backend]', data.toString().trim())
  })

  pythonProcess.stderr?.on('data', (data: Buffer) => {
    console.error('[Backend]', data.toString().trim())
  })

  pythonProcess.on('exit', (code: number | null) => {
    console.log('[Backend] Process exited with code:', code)
    pythonProcess = null
  })
}

function stopBackend() {
  if (pythonProcess) {
    console.log('[Ontology] Stopping backend...')
    pythonProcess.kill()
    pythonProcess = null
  }
}

function getIconPath(): string | undefined {
  if (isDev) {
    const devIcon = path.join(__dirname, '..', 'assets', 'icon.ico')
    if (fs.existsSync(devIcon)) return devIcon
    const devPng = path.join(__dirname, '..', 'assets', 'icon.png')
    if (fs.existsSync(devPng)) return devPng
  } else {
    const prodIcon = path.join(process.resourcesPath, 'assets', 'icon.ico')
    if (fs.existsSync(prodIcon)) return prodIcon
    const prodPng = path.join(process.resourcesPath, 'assets', 'icon.png')
    if (fs.existsSync(prodPng)) return prodPng
  }
  return undefined
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: `Ontology Analyzer v${getDisplayVersion()}`,
    icon: getIconPath(),
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault()
  })

  if (isDev) {
    // Wait for Vite dev server to be ready before loading
    const waitForVite = async (url: string, retries = 30): Promise<void> => {
      for (let i = 0; i < retries; i++) {
        try {
          const http = await import('http')
          await new Promise<void>((resolve, reject) => {
            const req = http.get(url, (res) => {
              res.resume()
              resolve()
            })
            req.on('error', reject)
            req.setTimeout(1000, () => { req.destroy(); reject(new Error('timeout')) })
          })
          return
        } catch {
          await new Promise(r => setTimeout(r, 500))
        }
      }
    }
    waitForVite('http://localhost:5174').then(() => {
      mainWindow?.loadURL('http://localhost:5174')
    })
  } else {
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html')
    mainWindow.loadFile(indexPath)
  }

  // F12 or Ctrl+Shift+I to toggle DevTools
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown') {
      if (input.key === 'F12' ||
          (input.control && input.shift && input.key.toLowerCase() === 'i')) {
        mainWindow?.webContents.toggleDevTools()
      }
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// IPC Handlers
ipcMain.handle('select-folder', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('select-files', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Source Files',
        extensions: [
          'java', 'py', 'ts', 'tsx', 'js', 'jsx', 'mjs',
          'go', 'c', 'cpp', 'cc', 'h', 'hpp',
        ],
      },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths
})

ipcMain.handle('open-doc', async () => {
  let docPath: string
  if (isDev) {
    docPath = path.join(__dirname, '..', 'docs', 'index.html')
  } else {
    docPath = path.join(process.resourcesPath, 'docs', 'index.html')
  }
  if (fs.existsSync(docPath)) {
    shell.openExternal(`file://${docPath.replace(/\\/g, '/')}`)
  }
})

// App lifecycle
app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  startBackend()
  createWindow()
})

app.on('window-all-closed', () => {
  stopBackend()
  app.quit()
})

app.on('before-quit', () => {
  stopBackend()
})
