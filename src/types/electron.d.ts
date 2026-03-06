declare const __APP_VERSION__: string

interface ElectronAPI {
  selectFolder: () => Promise<string | null>
  selectFiles: () => Promise<string[] | null>
}

interface Window {
  electronAPI: ElectronAPI
}
