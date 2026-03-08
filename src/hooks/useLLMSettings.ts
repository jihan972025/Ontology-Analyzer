import { useState, useEffect, useCallback } from 'react'
import type { LLMSettings, LLMProviderConfig } from '../types/llm'
import { getDefaultSettings } from '../types/llm'

const STORAGE_KEY = 'ontology-analyzer-llm-settings'

export function useLLMSettings() {
  const [settings, setSettings] = useState<LLMSettings>(() => {
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
        return parsed
      }
    } catch { /* ignore */ }
    return getDefaultSettings()
  })

  // Persist on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  const updateProvider = useCallback((providerId: string, config: Partial<LLMProviderConfig>) => {
    setSettings(prev => ({
      ...prev,
      providers: {
        ...prev.providers,
        [providerId]: { ...prev.providers[providerId], ...config },
      },
    }))
  }, [])

  const setActiveProvider = useCallback((providerId: string) => {
    setSettings(prev => ({ ...prev, activeProviderId: providerId }))
  }, [])

  const getActiveConfig = useCallback((): LLMProviderConfig | null => {
    const config = settings.providers[settings.activeProviderId]
    return config || null
  }, [settings])

  return { settings, updateProvider, setActiveProvider, getActiveConfig }
}
