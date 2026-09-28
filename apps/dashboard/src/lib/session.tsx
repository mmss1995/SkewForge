import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { createApi, type Api } from './api'

const KEY = 'skewforge:admin-token'

interface SessionValue {
  token: string | null
  api: Api | null
  signIn(token: string): void
  signOut(): void
}

const SessionContext = createContext<SessionValue | null>(null)

function readToken(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** The admin token lives in sessionStorage: it survives reloads, not closing the tab. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(readToken)
  const signIn = useCallback((next: string) => {
    try {
      sessionStorage.setItem(KEY, next)
    } catch {
      // private mode: keep it in memory only
    }
    setToken(next)
  }, [])
  const signOut = useCallback(() => {
    try {
      sessionStorage.removeItem(KEY)
    } catch {
      // ignore
    }
    setToken(null)
  }, [])
  const value = useMemo(() => ({ token, api: token ? createApi(token) : null, signIn, signOut }), [token, signIn, signOut])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession() outside <SessionProvider>')
  return value
}

export function useApi(): Api {
  const { api } = useSession()
  if (!api) throw new Error('not signed in')
  return api
}
