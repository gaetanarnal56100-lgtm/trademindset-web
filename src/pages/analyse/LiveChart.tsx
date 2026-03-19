// LiveChart.tsx — Widget TradingView complet (même interface que tradingview.com)
import { useState, useEffect, useRef, useCallback } from 'react'

interface Props { symbol: string; isCrypto: boolean }

function toTVSymbol(symbol: string, isCrypto: boolean): string {
  if (isCrypto) {
    const base  = symbol.replace(/USDT$|BUSD$|USDC$/i, '')
    const quote = symbol.match(/USDT$|BUSD$|USDC$/i)?.[0]?.toUpperCase() ?? 'USDT'
    return `BINANCE:${base}${quote}`
  }
  return symbol
}

const TIMEFRAMES = [
  { label:'1m', tv:'1' }, { label:'5m', tv:'5' }, { label:'15m', tv:'15' },
  { label:'30m', tv:'30' }, { label:'1h', tv:'60' }, { label:'4h', tv:'240' },
  { label:'1j', tv:'D' }, { label:'1S', tv:'W' },
]

export default function LiveChart({ symbol, isCrypto }: Props) {
  const [tf,       setTf]       = useState(TIMEFRAMES[2])
  const [chartType,setChartType]= useState<1|2|3>(1) // 1=bougies, 2=ligne, 3=aire
  const [expanded, setExpanded] = useState(false)
  const [loading,  setLoading]  = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef    = useRef<any>(null)
  const tvSymbol = toTVSymbol(symbol, isCrypto)

  // Charge le script TradingView une seule fois globalement
  useEffect(() => {
    if (document.getElementById('tv-widget-script')) return
    const s = document.createElement('script')
    s.id = 'tv-widget-script'
    s.src = 'https://s3.tradingview.com/tv.js'
    s.async = true
    document.head.appendChild(s)
  }, [])

  const buildWidget = useCallback(() => {
    const el = containerRef.current
    if (!el || !(window as any).TradingView) return
    setLoading(true)
    if (widgetRef.current) { try { widgetRef.current.remove?.() } catch {} }
    el.innerHTML = ''

    widgetRef.current = new (window as any).TradingView.widget({
      container_id:        'tv-chart-container',
      symbol:              tvSymbol,
      interval:            tf.tv,
      theme:               'dark',
      style:               chartType,
      locale:              'fr',
      toolbar_bg:          '#161B22',
      width:               '100%',
      height:              expanded ? 620 : 440,
      autosize:            true,

      // Tout afficher
      hide_top_toolbar:    false,
      hide_side_toolbar:   false,
      hide_legend:         false,
      withdateranges:      true,
      allow_symbol_change: false,
      save_image:          true,
      enable_publishing:   false,
      show_popup_button:   true,
      popup_width:         '1000',
      popup_height:        '650',

      // Activer TOUS les outils et fonctionnalités disponibles
      enabled_features: [
        'side_toolbar_in_fullscreen_mode',
        'header_fullscreen_button',
        'header_screenshot',
        'header_undo_redo',
        'header_indicators',
        'header_compare',
        'drawing_templates',
        'legend_context_menu',
        'show_chart_property_page',
        'chart_crosshair_menu',
        'scales_date_format_button',
        'fix_left_edge',
        'hide_last_na_study_output',
        'move_logo_to_main_pane',
      ],
      disabled_features: [
        'header_saveload',
      ],

      // Couleurs custom pour matcher le design de l'app
      overrides: {
        'paneProperties.background':                        '#0D1117',
        'paneProperties.backgroundType':                    'solid',
        'paneProperties.vertGridProperties.color':          '#1E233060',
        'paneProperties.horzGridProperties.color':          '#1E233060',
        'paneProperties.crossHairProperties.color':         '#555C70',
        'scalesProperties.textColor':                       '#555C70',
        'scalesProperties.lineColor':                       '#1E2330',
        'scalesProperties.backgroundColor':                 '#161B22',
        // Bougies
        'mainSeriesProperties.candleStyle.upColor':         '#22C759',
        'mainSeriesProperties.candleStyle.downColor':       '#FF3B30',
        'mainSeriesProperties.candleStyle.wickUpColor':     '#22C759',
        'mainSeriesProperties.candleStyle.wickDownColor':   '#FF3B30',
        'mainSeriesProperties.candleStyle.borderUpColor':   '#22C759',
        'mainSeriesProperties.candleStyle.borderDownColor': '#FF3B30',
        // Ligne
        'mainSeriesProperties.lineStyle.color':             '#00E5FF',
        'mainSeriesProperties.lineStyle.linewidth':         2,
        // Aire
        'mainSeriesProperties.areaStyle.color1':            '#00E5FF30',
        'mainSeriesProperties.areaStyle.color2':            '#00E5FF05',
        'mainSeriesProperties.areaStyle.linecolor':         '#00E5FF',
        'mainSeriesProperties.areaStyle.linewidth':         2,
      },

      // Indicateurs chargés par défaut
      studies: ['Volume@tv-basicstudies'],

      loading_screen: { backgroundColor: '#0D1117', foregroundColor: '#22C75940' },

      // Callback quand le widget est prêt
      onready: () => setLoading(false),
    })

    // Fallback si onready ne se déclenche pas
    setTimeout(() => setLoading(false), 3000)
  }, [tvSymbol, tf, chartType, expanded])

  useEffect(() => {
    const tryBuild = () => {
      if ((window as any).TradingView) { buildWidget(); return }
      const s = document.getElementById('tv-widget-script')
      s?.addEventListener('load', buildWidget, { once: true })
    }
    const t = setTimeout(tryBuild, 150)
    return () => clearTimeout(t)
  }, [buildWidget])

  const chartH = expanded ? 620 : 440

  return (
    <div style={{ background:'#161B22', border:'1px solid #1E2330', borderRadius:16, overflow:'hidden', marginBottom:16 }}>

      {/* Header */}
      <div style={{ padding:'10px 14px', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid #1E2330', flexWrap:'wrap' }}>

        {/* Logo + titre */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0, marginRight:4 }}>
          <div style={{ width:26, height:26, borderRadius:7, background:'linear-gradient(135deg,#0A85FF,#00E5FF)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13 }}>📈</div>
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:'#F0F3FF', lineHeight:1.2 }}>Graphique Live</div>
            <div style={{ fontSize:9, color:'#555C70' }}>TradingView · {tvSymbol}</div>
          </div>
        </div>

        {/* UT */}
        <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
          {TIMEFRAMES.map(t => (
            <button key={t.label} onClick={() => setTf(t)} style={{
              padding:'3px 8px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer',
              border:`1px solid ${tf.label===t.label?'#0A85FF':'#2A2F3E'}`,
              background: tf.label===t.label?'rgba(10,133,255,0.15)':'transparent',
              color: tf.label===t.label?'#0A85FF':'#555C70',
            }}>{t.label}</button>
          ))}
        </div>

        {/* Séparateur */}
        <div style={{ width:1, height:14, background:'#2A2F3E', flexShrink:0 }}/>

        {/* Type de graphique */}
        {([
          { type:1 as const, icon:'▌▌', label:'Bougies' },
          { type:2 as const, icon:'∿',  label:'Ligne'   },
          { type:3 as const, icon:'◢',  label:'Aire'    },
        ]).map(({ type, icon, label }) => (
          <button key={type} onClick={() => setChartType(type)} title={label} style={{
            padding:'3px 9px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer',
            border:`1px solid ${chartType===type?'#FF9500':'#2A2F3E'}`,
            background: chartType===type?'rgba(255,149,0,0.12)':'transparent',
            color: chartType===type?'#FF9500':'#555C70',
          }}>{icon}</button>
        ))}

        {/* Expand */}
        <button onClick={() => setExpanded(x => !x)} style={{
          marginLeft:'auto', padding:'3px 10px', borderRadius:6, fontSize:10,
          fontWeight:600, cursor:'pointer', border:'1px solid #2A2F3E',
          background:'transparent', color:'#555C70', flexShrink:0,
        }}>
          {expanded ? '⊡ Réduire' : '⊞ Agrandir'}
        </button>
      </div>

      {/* Deux bandeaux : outils + connexion TV */}
      <div style={{ borderBottom:'1px solid #1E2330' }}>
        {/* Outils */}
        <div style={{ padding:'5px 14px', background:'rgba(10,133,255,0.03)',
          display:'flex', alignItems:'center', gap:6, overflowX:'auto', flexWrap:'nowrap',
          borderBottom:'1px solid #1E233060' }}>
          <span style={{ fontSize:9, color:'#3D4254', flexShrink:0 }}>Outils :</span>
          {['↗ Tendance','◎ Fibo','▭ Rectangle','⟨⟩ Pitchfork','∥ Canal','📐 Mesure R/R','✏ Texte','📊 Indicateurs','↩ Undo','↪ Redo'].map(tool => (
            <span key={tool} style={{ fontSize:9, color:'#555C70', background:'rgba(255,255,255,0.03)',
              padding:'2px 6px', borderRadius:4, whiteSpace:'nowrap', flexShrink:0 }}>{tool}</span>
          ))}
          <span style={{ fontSize:9, color:'#3D4254', marginLeft:4, flexShrink:0 }}>← barre gauche</span>
        </div>
        {/* Connexion TradingView */}
        <div style={{ padding:'6px 14px', background:'rgba(191,90,242,0.04)',
          display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:11 }}>💾</span>
            <span style={{ fontSize:10, color:'#8F94A3' }}>
              Connecte-toi à ton compte TradingView pour <span style={{ color:'#BF5AF2', fontWeight:600 }}>sauvegarder tes analyses, dessins et layouts</span> sur leurs serveurs.
            </span>
          </div>
          <a href="https://www.tradingview.com/sign-in/" target="_blank" rel="noopener noreferrer"
            style={{ flexShrink:0, padding:'4px 12px', borderRadius:8, fontSize:10, fontWeight:700,
              background:'rgba(191,90,242,0.15)', border:'1px solid rgba(191,90,242,0.4)',
              color:'#BF5AF2', textDecoration:'none', whiteSpace:'nowrap' }}>
            Créer un compte gratuit →
          </a>
        </div>
      </div>

      {/* Chart */}
      <div style={{ position:'relative', height:chartH, background:'#0D1117' }}>
        {loading && (
          <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center',
            justifyContent:'center', background:'#0D1117', zIndex:2, gap:12 }}>
            <div style={{ width:32, height:32, border:'3px solid #1E2330', borderTopColor:'#22C759',
              borderRadius:'50%', animation:'spin 0.8s linear infinite' }}/>
            <div style={{ fontSize:12, color:'#555C70' }}>Chargement du graphique…</div>
          </div>
        )}
        <div id="tv-chart-container" ref={containerRef} style={{ width:'100%', height:'100%' }}/>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
