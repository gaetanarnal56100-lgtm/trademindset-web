import { useState, useEffect, useCallback } from 'react'
import { signalService, TradingSignal } from '@/services/notifications/SignalNotificationService'

const URGENCY_COLOR = { premium:'#FFD700', high:'#FF3B30', medium:'#FF9500', low:'#8F94A3' }
const URGENCY_ICON  = { premium:'⭐', high:'🔥', medium:'📊', low:'📈' }
const TYPE_LABEL: Record<string,string> = {
  WT_SMART_BULL:'WT ⭐ Bull', WT_SMART_BEAR:'WT ⭐ Bear', WT_BULL:'WT Bull', WT_BEAR:'WT Bear',
  VMC_BUY:'VMC Buy', VMC_SELL:'VMC Sell', VMC_COMPRESSION:'VMC Comp',
  MTF_BUY:'MTF Buy', MTF_SELL:'MTF Sell', MTF_CONFLUENCE:'MTF Conf',
}

function timeAgo(d: Date) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s/60)}m`; return `${Math.floor(s/3600)}h`
}

export default function NotificationBell() {
  const [signals, setSignals] = useState<TradingSignal[]>([])
  const [open,    setOpen]    = useState(false)
  const [hasNew,  setHasNew]  = useState(false)
  const [granted, setGranted] = useState(signalService.isGranted)

  useEffect(() => {
    setSignals(signalService.getHistory())
    return signalService.subscribe(sig => {
      if (!sig?.id) { setSignals(signalService.getHistory()); return }
      setSignals(signalService.getHistory()); setHasNew(true)
    })
  }, [])

  const requestPerm = useCallback(async () => {
    setGranted(await signalService.requestPermission())
  }, [])

  const recent = signals.filter(s => (Date.now()-s.timestamp.getTime()) < 30*60*1000).length

  return (
    <div style={{position:'relative'}}>
      <button onClick={()=>{setOpen(x=>!x);setHasNew(false)}}
        style={{position:'relative',background:'none',border:'none',cursor:'pointer',padding:'6px',borderRadius:8,
          color:hasNew?'#FF9500':'#555C70',fontSize:20,display:'flex',alignItems:'center',justifyContent:'center'}}>
        🔔
        {recent > 0 && <span style={{position:'absolute',top:2,right:2,width:16,height:16,borderRadius:'50%',background:'#FF3B30',color:'white',fontSize:9,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center'}}>{recent>9?'9+':recent}</span>}
      </button>

      {open && <>
        <div style={{position:'fixed',inset:0,zIndex:150}} onClick={()=>setOpen(false)}/>
        <div style={{position:'absolute',right:0,top:'calc(100% + 8px)',width:360,maxHeight:520,background:'#161B22',border:'1px solid #2A2F3E',borderRadius:14,zIndex:200,display:'flex',flexDirection:'column',boxShadow:'0 8px 32px rgba(0,0,0,0.5)',overflow:'hidden'}}>

          <div style={{padding:'12px 16px',borderBottom:'1px solid #2A2F3E',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
            <div style={{fontSize:13,fontWeight:700,color:'#F0F3FF'}}>Signaux de trading</div>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              {!granted && <button onClick={requestPerm} style={{fontSize:10,color:'#FF9500',background:'rgba(255,149,0,0.1)',border:'1px solid rgba(255,149,0,0.3)',borderRadius:6,padding:'3px 8px',cursor:'pointer'}}>Activer les notifs</button>}
              {signals.length>0 && <button onClick={()=>signalService.clearHistory()} style={{fontSize:10,color:'#555C70',background:'none',border:'none',cursor:'pointer'}}>Effacer</button>}
            </div>
          </div>

          <div style={{flex:1,overflowY:'auto'}}>
            {signals.length===0 ? (
              <div style={{textAlign:'center',padding:'40px 20px',color:'#3D4254'}}>
                <div style={{fontSize:28,marginBottom:8}}>🔕</div>
                <div style={{fontSize:12}}>Aucun signal pour l'instant</div>
                <div style={{fontSize:11,marginTop:4,color:'#2A2F3E'}}>Les signaux apparaissent après chaque refresh live</div>
              </div>
            ) : signals.map(sig => {
              const c=URGENCY_COLOR[sig.urgency]
              return (
                <div key={sig.id} style={{padding:'10px 16px',borderBottom:'1px solid rgba(255,255,255,0.04)',display:'flex',gap:10,alignItems:'flex-start'}}>
                  <div style={{fontSize:16,flexShrink:0,marginTop:1}}>{URGENCY_ICON[sig.urgency]}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                      <span style={{fontSize:9,fontWeight:700,color:c,background:`${c}18`,padding:'1px 6px',borderRadius:4}}>{TYPE_LABEL[sig.type]||sig.type}</span>
                      <span style={{fontSize:10,fontWeight:600,color:'#F59714'}}>{sig.symbol}</span>
                      <span style={{fontSize:9,color:'#3D4254',marginLeft:'auto'}}>{timeAgo(sig.timestamp)}</span>
                    </div>
                    <div style={{fontSize:12,color:'#C5C8D6',lineHeight:1.4}}>{sig.message}</div>
                    {sig.detail&&<div style={{fontSize:11,color:'#555C70',marginTop:2,fontFamily:'monospace'}}>{sig.detail}</div>}
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{padding:'8px 16px',borderTop:'1px solid #2A2F3E',flexShrink:0,display:'flex',alignItems:'center',gap:6}}>
            <div style={{width:7,height:7,borderRadius:'50%',background:granted?'#22C759':'#555C70'}}/>
            <span style={{fontSize:10,color:'#555C70'}}>{granted?'Notifications activées':'Notifications désactivées'}</span>
          </div>
        </div>
      </>}
    </div>
  )
}
