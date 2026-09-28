import { KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { createApi } from '../lib/api'
import { useSession } from '../lib/session'
import { Logo } from '../components/Layout'

export function LoginPage() {
  const { signIn } = useSession()
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await createApi(token).overview()
      signIn(token)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <Logo />
        <p className="text-sm text-zinc-600 dark:text-zinc-300">Enter the gateway's <code className="font-mono text-xs">ADMIN_TOKEN</code>.</p>
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Admin token
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoFocus
            className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          />
        </label>
        {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={!token || pending} className="flex w-full items-center justify-center gap-2 rounded-md bg-forge-600 px-3 py-2 text-sm font-medium text-white hover:bg-forge-700 disabled:opacity-60">
          <KeyRound className="size-4" /> Sign in
        </button>
      </form>
    </main>
  )
}
