import { useState, useEffect, useCallback, useRef } from 'react'
import type { LLMSettings, LLMProviderConfig } from '../types/llm'
import { getDefaultSettings } from '../types/llm'
import { encryptApiKey, decryptApiKey } from '../utils/apiKeyCrypto'

const STORAGE_KEY = 'ontology-analyzer-llm-settings'

// ── encryption helpers ───────────────────────────────────────────────

/** Encrypt all API keys in settings before persisting. */
async function encryptSettings(settings: LLMSettings): Promise<LLMSettings> {
  const encrypted: LLMSettings = {
    ...settings,
    providers: { ...settings.providers },
  }
  for (const [id, cfg] of Object.entries(encrypted.providers)) {
    encrypted.providers[id] = {
      ...cfg,
      apiKey: await encryptApiKey(cfg.apiKey),
    }
  }
  return encrypted
}

/** Decrypt all API keys after reading from storage. */
async function decryptSettings(settings: LLMSettings): Promise<LLMSettings> {
  const decrypted: LLMSettings = {
    ...settings,
    providers: { ...settings.providers },
  }
  for (const [id, cfg] of Object.entries(decrypted.providers)) {
    decrypted.providers[id] = {
      ...cfg,
      apiKey: await decryptApiKey(cfg.apiKey),
    }
  }
  return decrypted
}

// ── hook ─────────────────────────────────────────────────────────────

export function useLLMSettings() {
  const [settings, setSettings] = useState<LLMSettings>(getDefaultSettings)
  const [ready, setReady] = useState(false)
  const savingRef = useRef(false)

  // Load & decrypt on mount
  useEffect(() => {
    ;(async () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) {
          const parsed = JSON.parse(saved) as LLMSettings
          // Merge with defaults to handle newly added providers
          const defaults = getDefaultSettings()
          for (const key of Object.keys(defaults.providers)) {
            if (!parsed.providers[key]) {
              parsed.providers[key] = defaults.providers[key]
            }
          }
          const decrypted = await decryptSettings(parsed)
          setSettings(decrypted)
        }
      } catch {
        /* ignore corrupt data */
      }
      setReady(true)
    })()
  }, [])

  // Encrypt & persist on change (skip the initial default state)
  useEffect(() => {
    if (!ready) return
    if (savingRef.current) return
    savingRef.current = true
    ;(async () => {
      try {
        const encrypted = await encryptSettings(settings)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(encrypted))
      } catch (e) {
        console.error('[LLMSettings] Failed to encrypt settings:', e)
      }
      savingRef.current = false
    })()
  }, [settings, ready])

  const updateProvider = useCallback(
    (providerId: string, config: Partial<LLMProviderConfig>) => {
      setSettings(prev => ({
        ...prev,
        providers: {
          ...prev.providers,
          [providerId]: { ...prev.providers[providerId], ...config },
        },
      }))
    },
    [],
  )

  const setActiveProvider = useCallback((providerId: string) => {
    setSettings(prev => ({ ...prev, activeProviderId: providerId }))
  }, [])

  const getActiveConfig = useCallback((): LLMProviderConfig | null => {
    const config = settings.providers[settings.activeProviderId]
    return config || null
  }, [settings])

  return { settings, updateProvider, setActiveProvider, getActiveConfig }
}
