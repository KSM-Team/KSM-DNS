import { create } from 'zustand'

interface AuthState {
  token: string | null
  username: string | null
  role: string | null
  isLoggedIn: boolean
  mustChangePassword: boolean
  login: (token: string, username: string, role?: string, mustChangePassword?: boolean) => void
  setUser: (username: string, role: string) => void
  clearMustChangePassword: () => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('token'),
  username: localStorage.getItem('username'),
  role: localStorage.getItem('role'),
  isLoggedIn: !!localStorage.getItem('token'),
  mustChangePassword: localStorage.getItem('must_change_password') === 'true',
  login: (token, username, role = 'admin', mustChangePassword = false) => {
    localStorage.setItem('token', token)
    localStorage.setItem('username', username)
    localStorage.setItem('role', role)
    if (mustChangePassword) {
      localStorage.setItem('must_change_password', 'true')
    } else {
      localStorage.removeItem('must_change_password')
    }
    set({ token, username, role, isLoggedIn: true, mustChangePassword })
  },
  setUser: (username, role) => {
    localStorage.setItem('username', username)
    localStorage.setItem('role', role)
    set({ username, role })
  },
  clearMustChangePassword: () => {
    localStorage.removeItem('must_change_password')
    set({ mustChangePassword: false })
  },
  logout: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('username')
    localStorage.removeItem('role')
    localStorage.removeItem('must_change_password')
    set({ token: null, username: null, role: null, isLoggedIn: false, mustChangePassword: false })
  },
}))
