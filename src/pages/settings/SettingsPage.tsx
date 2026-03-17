import { IconSettings } from '@/components/ui/Icons'
export default function SettingsPage() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-3"><IconSettings size={22} /> Paramètres</h1>
        <p className="text-sm text-text-secondary mt-1">Firebase · API · Stockage · Export</p>
      </div>
      <div className="card flex flex-col items-center gap-3 py-12 text-text-tertiary">
        <IconSettings size={36} />
        <div className="text-sm">Section Paramètres — en cours de développement</div>
      </div>
    </div>
  )
}
