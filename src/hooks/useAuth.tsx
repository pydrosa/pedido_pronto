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

  async function ensureEstablishment(currentUser: User): Promise<Establishment | null> {
    const { data, error } = await supabase
      .from('establishments')
      .select('*')
      .eq('owner_id', currentUser.id)
      .maybeSingle()

    if (data) {
      const currentEstablishment = data as Establishment
      setEstablishment(currentEstablishment)
      return currentEstablishment
    }

    if (error) {
      console.error('[Auth] Erro ao buscar estabelecimento:', error)
      return null
    }

    const fallbackName =
      (currentUser.user_metadata?.establishment_name as string | undefined)?.trim() ||
      (currentUser.user_metadata?.name as string | undefined)?.trim() ||
      currentUser.email?.split('@')[0] ||
      'Meu estabelecimento'

    const { data: created, error: insertError } = await supabase
      .from('establishments')
      .insert({
        owner_id: currentUser.id,
        name: fallbackName,
        email: currentUser.email ?? '',
        plan: 'free',
        orders_this_month: 0,
      })
      .select()
      .single()

    if (insertError) {
      console.error('[Auth] Erro ao criar estabelecimento:', insertError)

      const { data: existing } = await supabase
        .from('establishments')
        .select('*')
        .eq('owner_id', currentUser.id)
        .maybeSingle()

      if (existing) {
        const currentEstablishment = existing as Establishment
        setEstablishment(currentEstablishment)
        return currentEstablishment
      }

      return null
    }

    const currentEstablishment = created as Establishment
    setEstablishment(currentEstablishment)
    return currentEstablishment
  }

  async function fetchEstablishment(currentUser: User) {
    await ensureEstablishment(currentUser)
  }

  async function refreshEstablishment() {
    if (user) await fetchEstablishment(user)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) fetchEstablishment(session.user).finally(() => setLoading(false))
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) fetchEstablishment(session.user)
      else setEstablishment(null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  const signUp = async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          establishment_name: name,
          name,
        },
      },
    })

    if (error) return { error: error.message }
    if (!data.user) return { error: 'Erro ao criar usuario' }
    if (!data.session) {
      return {
        error: 'Conta criada, mas o login imediato nao foi liberado. Verifique a confirmacao de e-mail no Supabase.',
      }
    }

    const currentEstablishment = await ensureEstablishment(data.user)
    return { error: currentEstablishment ? null : 'Conta criada, mas nao foi possivel criar o estabelecimento.' }
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
