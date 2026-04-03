import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock localStorage
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, val: string) => { store[key] = val }),
  removeItem: vi.fn((key: string) => { delete store[key] }),
  clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]) }),
  length: 0,
  key: vi.fn(() => null),
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

// Mock fetch
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

import { api } from '../lib/api'

describe('ApiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    ;(api as any).jwt = null
  })

  it('sets and gets JWT via localStorage', () => {
    api.setJwt('test-jwt-token')
    expect(localStorageMock.setItem).toHaveBeenCalledWith('mint_jwt', 'test-jwt-token')
    expect(api.getJwt()).toBe('test-jwt-token')
  })

  it('clears JWT on setJwt(null)', () => {
    api.setJwt('token')
    api.setJwt(null)
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('mint_jwt')
  })

  it('calls signup endpoint with correct payload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        user: { id: '1', email: 'a@b.com', name: null },
        api_token: 'mint_abc123',
        jwt: 'jwt-token',
      }),
    })

    const result = await api.signup('a@b.com', 'password123')
    expect(result.user.email).toBe('a@b.com')
    expect(result.api_token).toBe('mint_abc123')
    expect(result.jwt).toBe('jwt-token')

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain('/auth/signup')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({
      email: 'a@b.com',
      password: 'password123',
    })
  })

  it('calls login endpoint with correct payload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        user: { id: '1', email: 'a@b.com', name: null, plan: 'free' },
        jwt: 'jwt-token',
      }),
    })

    const result = await api.login('a@b.com', 'password123')
    expect(result.user.email).toBe('a@b.com')
    expect(result.jwt).toBe('jwt-token')
  })

  it('sends Authorization header when JWT is set', async () => {
    api.setJwt('my-jwt')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ user: { id: '1', email: 'a@b.com' } }),
    })

    await api.getMe()
    const [, opts] = mockFetch.mock.calls[0]
    expect(opts.headers.Authorization).toBe('Bearer my-jwt')
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Invalid credentials' }),
    })

    await expect(api.login('a@b.com', 'wrong')).rejects.toThrow('Invalid credentials')
  })

  it('calls getStats endpoint', async () => {
    api.setJwt('jwt')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        stats: { total_requests: 100, total_cost: 1.5, total_input_tok: 5000, total_output_tok: 3000 },
      }),
    })

    const result = await api.getStats()
    expect(result.stats.total_requests).toBe(100)
  })

  it('calls createToken endpoint', async () => {
    api.setJwt('jwt')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: 'mint_full_token', prefix: 'mint_ful' }),
    })

    const result = await api.createToken('my-token')
    expect(result.token).toBe('mint_full_token')
    expect(result.prefix).toBe('mint_ful')
  })

  it('calls revokeToken endpoint with DELETE', async () => {
    api.setJwt('jwt')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    })

    await api.revokeToken('token-id-123')
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain('/auth/tokens/token-id-123')
    expect(opts.method).toBe('DELETE')
  })
})
