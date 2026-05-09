// src/components/layout/PublicLayout.tsx
// La landing page Variante 2 (Dopamine Duolingo) gère son propre fond et sa propre navbar.
// Ce layout reste minimal pour ne pas imposer le thème sombre par-dessus.
import { Outlet } from 'react-router-dom'

export default function PublicLayout() {
  return <Outlet />
}
