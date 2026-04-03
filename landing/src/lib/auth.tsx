import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { api } from './api'

export interface User {
  id: string
  email: string
  name: string | null
  plan?: string
  created_at?: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string, name?: string) => Promise<string>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const jwt = api.getJwt()
    if (jwt) {
      api
        .getMe()
        .then((data) => setUser(data.user))
        .catch(() => {
          api.setJwt(null)
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const loginFn = async (email: string, password: string) => {
    const data = await api.login(email, password)
    api.setJwt(data.jwt)
    setUser(data.user)
  }

  const signupFn = async (email: string, password: string, name?: string) => {
    const data = await api.signup(email, password, name)
    api.setJwt(data.jwt)
    setUser(data.user)
    return data.api_token
  }

  const logoutFn = () => {
    api.setJwt(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, login: loginFn, signup: signupFn, logout: logoutFn }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
