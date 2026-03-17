import { IconJournal } from '@/components/ui/Icons'
export default function JournalPage() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-3"><IconJournal size={22} /> Journal émotionnel</h1>
        <p className="text-sm text-text-secondary mt-1">Humeurs, émotions, charge psychologique</p>
      </div>
      <div className="card flex flex-col items-center gap-3 py-12 text-text-tertiary">
        <IconJournal size={36} />
        <div className="text-sm">Section Journal — en cours de développement</div>
      </div>
    </div>
  )
}
