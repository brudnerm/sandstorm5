/**
 * Fetch-and-cache hook for data shards. Paths are relative to the page
 * (e.g. 'data/kp/live.json') so the same code works in dev, preview, and
 * under a GitHub Pages subpath.
 */
import { useEffect, useState } from 'react'

const cache = new Map<string, unknown>()

interface JsonState<T> {
  data: T | null
  error: string | null
}

export function useJson<T>(path: string | null): JsonState<T> & { loading: boolean } {
  const [state, setState] = useState<JsonState<T>>(() => ({
    data: path && cache.has(path) ? (cache.get(path) as T) : null,
    error: null,
  }))

  useEffect(() => {
    if (!path) return
    if (cache.has(path)) {
      setState({ data: cache.get(path) as T, error: null })
      return
    }
    let cancelled = false
    setState({ data: null, error: null })
    fetch(path)
      .then(resp => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        return resp.json() as Promise<T>
      })
      .then(data => {
        cache.set(path, data)
        if (!cancelled) setState({ data, error: null })
      })
      .catch(err => {
        if (!cancelled) setState({ data: null, error: String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [path])

  return { ...state, loading: !!path && state.data === null && state.error === null }
}
