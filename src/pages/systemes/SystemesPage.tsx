import { IconSystemes } from '@/components/ui/Icons'
export default function SystemesPage() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-3"><IconSystemes size={22} /> Systèmes</h1>
        <p className="text-sm text-text-secondary mt-1">Vos stratégies de trading</p>
      </div>
      <div className="card flex flex-col items-center gap-3 py-12 text-text-tertiary">
        <IconSystemes size={36} />
        <div className="text-sm">Section Systèmes — en cours de développement</div>
      </div>
    </div>
  )
}
