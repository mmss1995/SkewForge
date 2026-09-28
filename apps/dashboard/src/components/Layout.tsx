import { LogOut } from 'lucide-react'
import { Link, Outlet } from 'react-router-dom'
import { useSession } from '../lib/session'
import { Button } from './ui'

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold">
      <svg viewBox="0 0 32 32" className="size-6" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="fill-forge-600" />
        <path d="M9 22 16 8l7 14" stroke="white" strokeWidth="3" fill="none" strokeLinejoin="round" />
      </svg>
      SkewForge
    </Link>
  )
}

export function Layout() {
  const { signOut } = useSession()
  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Logo />
          <Button variant="ghost" onClick={signOut}>
            <LogOut className="size-3.5" /> Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
