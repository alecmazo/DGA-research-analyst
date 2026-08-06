export type GpUser = {
  lp_id?: string
  email?: string
  name?: string
  role?: string
  must_change_password?: boolean
  demo_mode?: boolean
  impersonated?: boolean
}

const TOKEN_KEY = 'dga_v2_token'
const USER_KEY = 'dga_v2_user'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function getCachedUser(): GpUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as GpUser) : null
  } catch {
    return null
  }
}

export function setSession(token: string, user: GpUser) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function logout() {
  clearSession()
  window.location.replace('/')
}
