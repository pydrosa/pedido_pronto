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

    // Fallback: o gatilho on_auth_user_created já cria o estabelecimento no
    // servidor. O navegador só envia owner_id, name e email — plano e
    // contadores são definidos pelo banco e não são graváveis pelo cliente.
    const { data: created, error: insertError } = await supabase
      .from('establishments')
      .insert({
        owner_id: currentUser.id,
        name: fallbackName.slice(0, 80),
        email: currentUser.email ?? '',
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

    if (error) return { error: translateAuthError(error.message) }
    if (!data.user) return { error: 'Não foi possível criar a conta. Tente novamente.' }
    if (!data.session) {
      // Confirmação de e-mail ligada no Supabase: a conta existe, mas só
      // entra depois de clicar no link enviado.
      return { error: 'Conta criada! Confirme pelo link que enviamos para o seu e-mail e depois faça login.' }
    }

    const currentEstablishment = await ensureEstablishment(data.user)
    return {
      error: currentEstablishment
        ? null
        : 'Conta criada, mas não foi possível criar o estabelecimento. Saia e entre novamente.',
    }
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

// O Supabase devolve mensagens em inglês; estas são as que o dono de um
// estabelecimento realmente vê no cadastro.
function translateAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('already registered') || m.includes('already been registered')) {
    return 'Este e-mail já tem uma conta. Faça login ou recupere a senha.'
  }
  if (m.includes('password') && (m.includes('least') || m.includes('weak') || m.includes('short'))) {
    return 'Senha muito fraca. Use pelo menos 6 caracteres.'
  }
  if (m.includes('invalid') && m.includes('email')) return 'E-mail inválido.'
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Muitas tentativas. Aguarde um minuto e tente de novo.'
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'Sem conexão. Confira sua internet e tente de novo.'
  }
  return 'Não foi possível criar a conta. Tente novamente.'
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
