const API_URL = import.meta.env.VITE_API_URL || 'https://api.usemint.dev'

class ApiClient {
  private jwt: string | null = null

  setJwt(jwt: string | null) {
    this.jwt = jwt
    if (jwt) {
      localStorage.setItem('mint_jwt', jwt)
    } else {
      localStorage.removeItem('mint_jwt')
    }
  }

  getJwt(): string | null {
    if (!this.jwt) {
      this.jwt = localStorage.getItem('mint_jwt')
    }
    return this.jwt
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const jwt = this.getJwt()
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        ...options.headers,
      },
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data as T
  }

  // Auth
  async signup(email: string, password: string, name?: string) {
    return this.request<{
      user: { id: string; email: string; name: string | null }
      api_token: string
      jwt: string
    }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, ...(name ? { name } : {}) }),
    })
  }

  async login(email: string, password: string) {
    return this.request<{
      user: { id: string; email: string; name: string | null; plan: string }
      jwt: string
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  }

  async getMe() {
    return this.request<{
      user: { id: string; email: string; name: string | null; plan: string; created_at: string }
    }>('/auth/me')
  }

  // Dashboard data
  async getStats() {
    return this.request<{
      stats: {
        total_requests: number
        total_cost: number
        total_input_tok: number
        total_output_tok: number
      }
    }>('/auth/stats')
  }

  async getSessions(limit = 20) {
    return this.request<{
      sessions: Array<{
        session_id: string
        request_count: number
        total_cost: number
        first_ts: string
        last_ts: string
      }>
    }>(`/auth/sessions?limit=${limit}`)
  }

  async getHistory(limit = 50) {
    return this.request<{
      history: Array<{
        id: string
        session_id: string
        ts: string
        model: string
        provider: string
        task_type: string
        input_tok: number
        output_tok: number
        cost_actual: number
        cost_sonnet: number
        latency_ms: number
        error: string | null
      }>
    }>(`/auth/history?limit=${limit}`)
  }

  // Tokens
  async getTokens() {
    return this.request<{
      tokens: Array<{
        id: string
        token_prefix: string
        name: string
        last_used_at: string | null
        created_at: string
        revoked_at: string | null
      }>
    }>('/auth/tokens')
  }

  async createToken(name?: string) {
    return this.request<{ token: string; prefix: string }>('/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  }

  async revokeToken(id: string) {
    return this.request<{ ok: boolean }>(`/auth/tokens/${id}`, { method: 'DELETE' })
  }
}

export const api = new ApiClient()
