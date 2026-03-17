// src/components/ui/LoadingScreen.tsx
export default function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-bg-primary flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-2 border-border" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-brand-cyan animate-spin" />
        </div>
        <span className="text-text-tertiary text-sm font-medium tracking-wider uppercase">
          TradeMindset
        </span>
      </div>
    </div>
  )
}
