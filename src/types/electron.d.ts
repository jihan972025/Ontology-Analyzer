declare const __APP_VERSION__: string

interface ElectronAPI {
  selectFolder: () => Promise<string | null>
  selectFiles: () => Promise<string[] | null>
  openDoc: () => Promise<void>
}

interface Window {
  electronAPI: ElectronAPI
}
