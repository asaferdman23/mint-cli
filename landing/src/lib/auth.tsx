import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { User as SupabaseUser } from '@supabase/supabase-js'

export interface User {
  id: string
  email: string
  name: string | null
  plan?: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  signInWithGoogle: () => Promise<void>
  signInWithGithub: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

function toUser(su: SupabaseUser): User {
  return {
    id: su.id,
    email: su.email ?? '',
    name: su.user_metadata?.full_name ?? su.user_metadata?.name ?? null,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setUser(toUser(session.user))
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(toUser(session.user))
      } else {
        setUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback${window.location.search}`,
      },
    })
    if (error) throw error
  }

  const signInWithGithub = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: `${window.location.origin}/auth/callback${window.location.search}`,
      },
    })
    if (error) throw error
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signInWithGithub, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
