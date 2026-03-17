import { IconProfil } from '@/components/ui/Icons'
import { useUser } from '@/hooks/useAuth'
export default function ProfilPage() {
  const user = useUser()
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-3"><IconProfil size={22} /> Profil</h1>
      </div>
      <div className="card max-w-md">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 rounded-full bg-brand-blue bg-opacity-20 flex items-center justify-center text-xl font-bold text-brand-blue">
            {user?.displayName?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div>
            <div className="text-base font-semibold text-text-primary">{user?.displayName || 'Trader'}</div>
            <div className="text-sm text-text-secondary">{user?.email}</div>
            <span className="badge-cyan mt-1 inline-block">{user?.isPremium ? 'Premium' : 'Free'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
