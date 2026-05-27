import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { Establishment } from '@/types'

interface AuthContextType {
  session: Session | null
  user: User | null
  establishment: Establishment | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, name: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshEstablishment: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [establishment, setEstablishment] = useState<Establishment | null>(null)
  const [loading, setLoading] = useState(true)

  async function fetchEstablishment(userId: string) {
    const { data } = await supabase
      .from('establishments')
      .select('*')
      .eq('owner_id', userId)
      .single()
    if (data) setEstablishment(data as Establishment)
  }

  async function refreshEstablishment() {
    if (user) await fetchEstablishment(user.id)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) fetchEstablishment(session.user.id).finally(() => setLoading(false))
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) fetchEstablishment(session.user.id)
      else setEstablishment(null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  const signUp = async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) return { error: error.message }
    if (!data.user) return { error: 'Erro ao criar usuário' }

    // Create establishment record
    const { error: estError } = await supabase.from('establishments').insert({
      owner_id: data.user.id,
      name,
      email,
      plan: 'free',
      orders_this_month: 0,
    })

    return { error: estError?.message ?? null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setEstablishment(null)
  }

  return (
    <AuthContext.Provider value={{
      session, user, establishment, loading,
      signIn, signUp, signOut, refreshEstablishment,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
