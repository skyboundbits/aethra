/**
 * src/services/themeService.ts
 * Theme definitions, validation helpers, and DOM application utilities for
 * built-in and user-imported themes.
 */

import type { ThemeDefinition, ThemeMode, ThemeTokenName } from '../types'

/** Public theme token names supported by the app. */
export const THEME_TOKEN_NAMES: ThemeTokenName[] = [
  'app-bg',
  'panel-bg',
  'surface-bg',
  'surface-bg-emphasis',
  'surface-bg-selected',
  'surface-bg-user-message',
  'surface-bg-accent',
  'surface-bg-accent-hover',
  'surface-bg-overlay',
  'border-color',
  'border-color-accent',
  'text-color-primary',
  'text-color-secondary',
  'text-color-muted',
  'text-color-on-accent',
  'text-color-brand',
  'scrollbar-thumb',
  'scrollbar-thumb-hover',
  'shadow-panel',
  'shadow-modal',
]

/** Built-in theme definitions shipped with the app. */
export const BUILT_IN_THEMES: ThemeDefinition[] = [
  {
    id: 'default',
    name: 'Default',
    mode: 'dark',
    tokens: {},
  },
  {
    id: 'dawn',
    name: 'Dawn',
    mode: 'light',
    tokens: {},
  },
]

/**
 * Reset any inline custom theme overrides previously applied to the document.
 */
export function clearAppliedTheme(): void {
  const root = document.documentElement
  root.removeAttribute('data-theme')
  root.style.removeProperty('color-scheme')

  for (const token of THEME_TOKEN_NAMES) {
    root.style.removeProperty(`--${token}`)
  }
}

/**
 * Apply a theme by ID using built-in scopes or inline custom token overrides.
 *
 * @param activeThemeId - Theme ID to apply.
 * @param customThemes  - Imported custom themes available to the user.
 */
export function applyTheme(activeThemeId: string, customThemes: ThemeDefinition[]): void {
  clearAppliedTheme()

  if (activeThemeId === 'default') {
    return
  }

  const builtInTheme = BUILT_IN_THEMES.find((theme) => theme.id === activeThemeId)
  if (builtInTheme) {
    document.documentElement.dataset.theme = builtInTheme.id
    return
  }

  const customTheme = customThemes.find((theme) => theme.id === activeThemeId)
  if (!customTheme) {
    return
  }

  const root = document.documentElement
  root.style.setProperty('color-scheme', customTheme.mode)

  for (const [token, value] of Object.entries(customTheme.tokens)) {
    root.style.setProperty(`--${token}`, value)
  }
}

/**
 * Parse and validate an imported theme file payload.
 *
 * @param raw - Untrusted JSON-parsed input.
 * @returns A normalized theme definition safe to persist and apply.
 */
export function parseImportedTheme(raw: unknown): ThemeDefinition {
  if (!isRecord(raw)) {
    throw new Error('Theme file must contain a JSON object.')
  }

  const rawName = typeof raw['name'] === 'string' ? raw['name'].trim() : ''
  if (!rawName) {
    throw new Error('Theme file must include a non-empty "name".')
  }

  const rawMode = raw['mode']
  const mode: ThemeMode = rawMode === 'light' || rawMode === 'dark' ? rawMode : 'dark'

  const rawTokens = raw['tokens']
  if (!isRecord(rawTokens)) {
    throw new Error('Theme file must include a "tokens" object.')
  }

  const tokens: Partial<Record<ThemeTokenName, string>> = {}
  for (const [key, value] of Object.entries(rawTokens)) {
    if (!THEME_TOKEN_NAMES.includes(key as ThemeTokenName)) {
      throw new Error(`Unsupported theme token "${key}".`)
    }

    if (typeof value !== 'string' || !isSafeThemeValue(value)) {
      throw new Error(`Invalid value for theme token "${key}".`)
    }

    tokens[key as ThemeTokenName] = value.trim()
  }

  if (Object.keys(tokens).length === 0) {
    throw new Error('Theme file must include at least one valid token override.')
  }

  const preferredId = typeof raw['id'] === 'string' ? raw['id'].trim() : rawName
  const id = sanitizeThemeId(preferredId)

  if (!id) {
    throw new Error('Theme file must include a usable "id" or "name".')
  }

  if (BUILT_IN_THEMES.some((theme) => theme.id === id)) {
    throw new Error(`Theme ID "${id}" conflicts with a built-in theme.`)
  }

  return {
    id,
    name: rawName,
    mode,
    tokens,
  }
}

/**
 * Replace or append a custom theme in the saved theme list.
 *
 * @param themes - Existing imported themes.
 * @param theme  - Imported theme to insert.
 * @returns Updated custom theme list.
 */
export function upsertCustomTheme(themes: ThemeDefinition[], theme: ThemeDefinition): ThemeDefinition[] {
  const existingIndex = themes.findIndex((item) => item.id === theme.id)
  if (existingIndex === -1) {
    return [...themes, theme]
  }

  return themes.map((item) => (item.id === theme.id ? theme : item))
}

/**
 * Check whether an unknown value is a plain record-like object.
 *
 * @param value - Value to test.
 * @returns True if the value can be treated as a string-keyed record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Sanitize a theme ID into a stable token safe for persisted settings.
 *
 * @param value - Candidate ID or name.
 * @returns Lowercase slug or an empty string if nothing usable remains.
 */
function sanitizeThemeId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Perform basic validation on a theme token value before applying it.
 *
 * @param value - CSS custom property value candidate.
 * @returns True when the value is non-empty and excludes unsafe delimiters.
 */
function isSafeThemeValue(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 200 && !/[{}<>]/.test(trimmed)
}
