import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function AuthCallback() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    // Supabase handles the OAuth callback automatically via the URL hash
    // We just need to check if we have a session and redirect appropriately
    const handleCallback = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()

        if (error) {
          setStatus('error')
          return
        }

        if (!session) {
          // Wait a moment for Supabase to process the hash
          await new Promise(resolve => setTimeout(resolve, 1000))
          const { data: { session: retrySession } } = await supabase.auth.getSession()

          if (!retrySession) {
            setStatus('error')
            return
          }
        }

        const activeSession = session ?? (await supabase.auth.getSession()).data.session

        // Check if there's a CLI callback URL
        const callback = searchParams.get('callback') ?? localStorage.getItem('mint_cli_callback')
        localStorage.removeItem('mint_cli_callback')

        if (callback && activeSession?.access_token) {
          // Validate callback — only allow localhost
          const isValid = callback.startsWith('http://localhost:') || callback.startsWith('http://127.0.0.1:')
          if (!isValid) {
            setStatus('error')
            return
          }
          // POST token to CLI (not in URL params)
          setStatus('success')
          fetch(callback, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access_token: activeSession.access_token, email: activeSession.user?.email }),
          }).catch(() => {})
          return
        }

        // No CLI callback — redirect to dashboard
        setStatus('success')
        setTimeout(() => navigate('/dashboard'), 500)
      } catch {
        setStatus('error')
      }
    }

    handleCallback()
  }, [navigate, searchParams])

  return (
    <div className="min-h-screen bg-[#07090d] flex items-center justify-center">
      <div className="text-center">
        {status === 'loading' && (
          <>
            <div className="w-8 h-8 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-[#4d6a82]">Signing you in...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <h1 className="text-2xl font-bold text-[#00d4ff] mb-2">Connected!</h1>
            <p className="text-[#4d6a82]">You can close this tab and return to the terminal.</p>
          </>
        )}
        {status === 'error' && (
          <>
            <h1 className="text-2xl font-bold text-red-400 mb-2">Sign in failed</h1>
            <p className="text-[#4d6a82] mb-4">Something went wrong. Please try again.</p>
            <a href="/auth" className="text-[#00d4ff] hover:underline">Back to sign in</a>
          </>
        )}
      </div>
    </div>
  )
}
