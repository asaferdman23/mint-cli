import { Navigate } from 'react-router-dom'

export function Login() {
  return <Navigate to="/auth" replace />
}
