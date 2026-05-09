// src/pages/landing/LandingPage.tsx
import { Link } from 'react-router-dom'
import { useEffect } from 'react'

export default function LandingPage() {
  useEffect(() => {
    const id = 'tm-fonts-v3'
    if (!document.getElementById(id)) {
      const l1 = document.createElement('link'); l1.rel = 'preconnect'; l1.href = 'https://fonts.googleapis.com'
      const l2 = document.createElement('link'); l2.rel = 'preconnect'; l2.href = 'https://fonts.gstatic.com'; l2.crossOrigin = ''
      const l3 = document.createElement('link'); l3.id = id; l3.rel = 'stylesheet'
      l3.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap'
      document.head.append(l1, l2, l3)
    }
    document.documentElement.style.scrollBehavior = 'smooth'
  }, [])

  return (
    <div className="tm-root">
      <style>{css}</style>

      {/* ambient backdrop */}
      <div className="tm-bg" aria-hidden>
        <div className="tm-grid"/>
        <div className="tm-glow tm-glow-1"/>
        <div className="tm-glow tm-glow-2"/>
      </div>

      {/* NAV */}
      <nav className="tm-nav">
        <div className="tm-nav-inner">
          <div className="tm-brand">
            <span className="tm-mark">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path d="M3 16 L8 10 L12 13 L19 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="19" cy="5" r="2" fill="currentColor"/>
              </svg>
            </span>
            TradeMindset
          </div>
          <div className="tm-nav-links">
            <a href="#produit">Produit</a>
            <a href="#methode">Méthode</a>
            <a href="#tarifs">Tarifs</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="tm-nav-cta">
            <Link to="/login" className="tm-btn tm-btn-ghost">Connexion</Link>
            <Link to="/register" className="tm-btn tm-btn-primary">Démarrer<span className="arr">→</span></Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="tm-hero">
        <div className="tm-container">
          <span className="tm-eyebrow">
            <span className="tm-ping"/>
            <span>v3.4 · Coach IA · Sync TradingView · MT5</span>
          </span>
          <h1 className="tm-h1">
            Le journal de trading qui<br/>
            transforme la <em>discipline</em><br/>
            en performance mesurable.
          </h1>
          <p className="tm-sub">
            Capture chaque trade, chaque émotion, chaque décision. L'IA croise tes
            données et révèle les patterns qui te font perdre — et ceux qui te font gagner.
          </p>
          <div className="tm-hero-ctas">
            <Link to="/register" className="tm-btn tm-btn-primary tm-btn-lg">
              Commencer gratuitement<span className="arr">→</span>
            </Link>
            <a href="#produit" className="tm-btn tm-btn-ghost tm-btn-lg">
              <span className="play">▶</span> Tour produit · 90s
            </a>
          </div>
          <div className="tm-hero-meta">
            <span>14 modules</span><span className="dot"/>
            <span>iOS · Android · Web</span><span className="dot"/>
            <span>Sync brokers</span><span className="dot"/>
            <span>RGPD · données chiffrées</span>
          </div>
        </div>

        {/* HERO CHART */}
        <div className="tm-container tm-chart-wrap">
          <div className="tm-chart-card">
            <div className="tm-chart-head">
              <div className="tm-chart-title">
                <span className="tm-chip">📊 Equity Curve</span>
                <span className="tm-chart-meta">90 jours · multi-comptes consolidés</span>
              </div>
              <div className="tm-chart-tabs">
                <span>1J</span><span>1S</span><span className="active">90J</span><span>1A</span><span>ALL</span>
              </div>
            </div>
            <div className="tm-kpis">
              <div className="tm-kpi">
                <div className="tm-kpi-lbl">P&L net</div>
                <div className="tm-kpi-val tm-up">+34 240 €</div>
                <div className="tm-kpi-delta">↗ +18,2 %</div>
              </div>
              <div className="tm-kpi">
                <div className="tm-kpi-lbl">Win rate</div>
                <div className="tm-kpi-val">64,2 %</div>
                <div className="tm-kpi-delta tm-up">+12 pts vs avant</div>
              </div>
              <div className="tm-kpi">
                <div className="tm-kpi-lbl">Sharpe</div>
                <div className="tm-kpi-val">1,84</div>
                <div className="tm-kpi-delta">excellent</div>
              </div>
              <div className="tm-kpi">
                <div className="tm-kpi-lbl">Max DD</div>
                <div className="tm-kpi-val tm-down">−6,4 %</div>
                <div className="tm-kpi-delta">contenu</div>
              </div>
              <div className="tm-kpi">
                <div className="tm-kpi-lbl">Expectancy</div>
                <div className="tm-kpi-val tm-up">+1,2 R</div>
                <div className="tm-kpi-delta">stable</div>
              </div>
            </div>
            <div className="tm-chart-svg">
              <svg viewBox="0 0 1200 320" preserveAspectRatio="none" aria-hidden>
                <defs>
                  <linearGradient id="tmEqFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34D399" stopOpacity="0.32"/>
                    <stop offset="60%" stopColor="#34D399" stopOpacity="0.06"/>
                    <stop offset="100%" stopColor="#34D399" stopOpacity="0"/>
                  </linearGradient>
                  <linearGradient id="tmEqLine" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#34D399"/>
                    <stop offset="100%" stopColor="#A7F3D0"/>
                  </linearGradient>
                </defs>
                {/* grid */}
                <g stroke="rgba(255,255,255,0.05)" strokeWidth="1">
                  <line x1="0" y1="80" x2="1200" y2="80"/>
                  <line x1="0" y1="160" x2="1200" y2="160"/>
                  <line x1="0" y1="240" x2="1200" y2="240"/>
                </g>
                {/* axis labels */}
                <g fontFamily="Geist Mono, monospace" fontSize="10" fill="rgba(255,255,255,0.35)">
                  <text x="8" y="84">+30k</text>
                  <text x="8" y="164">+15k</text>
                  <text x="8" y="244">  0k</text>
                </g>
                <path d="M0 290 L80 280 L160 270 L240 274 L320 250 L400 245 L480 258 L560 235 L640 215 L720 200 L800 175 L880 188 L960 145 L1040 110 L1120 80 L1200 50 L1200 320 L0 320 Z" fill="url(#tmEqFill)"/>
                <path d="M0 290 L80 280 L160 270 L240 274 L320 250 L400 245 L480 258 L560 235 L640 215 L720 200 L800 175 L880 188 L960 145 L1040 110 L1120 80 L1200 50" fill="none" stroke="url(#tmEqLine)" strokeWidth="2.4" strokeLinejoin="round"/>
                {/* end glow */}
                <circle cx="1200" cy="50" r="5" fill="#34D399"/>
                <circle cx="1200" cy="50" r="14" fill="none" stroke="#34D399" strokeWidth="1.2" opacity="0.45"/>
                {/* annotation */}
                <line x1="560" y1="60" x2="560" y2="280" stroke="rgba(244,88,59,0.4)" strokeWidth="1" strokeDasharray="3 4"/>
                <text x="568" y="74" fontFamily="Geist Mono, monospace" fontSize="10" fill="#F4583B">PIVOT · TM activé</text>
              </svg>
            </div>
          </div>

          {/* trust strip */}
          <div className="tm-trust">
            <span className="tm-trust-lbl">SYNC AVEC</span>
            <div className="tm-trust-logos">
              <span>TradingView</span>
              <span>MetaTrader 5</span>
              <span>Binance</span>
              <span>Bybit</span>
              <span>Interactive Brokers</span>
              <span>FTMO</span>
            </div>
          </div>
        </div>
      </section>

      {/* PRODUCT BENTO */}
      <section className="tm-section" id="produit">
        <div className="tm-container">
          <div className="tm-sect-head">
            <div>
              <span className="tm-kicker">Produit · 14 modules</span>
              <h2 className="tm-h2">Tout l'équipement du <em>trader sérieux</em>.<br/>Une seule app.</h2>
            </div>
            <p className="tm-sect-desc">Dashboard, journal d'émotions, coach IA, screener, calendrier de performance, whales, badges. Conçu pour la rigueur — pas pour le bruit.</p>
          </div>

          <div className="tm-bento">
            {/* Coach IA — feature card */}
            <div className="tm-card tm-c-coach">
              <div className="tm-card-head">
                <span className="tm-pill tm-pill-glow">✦ Coach IA</span>
                <span className="tm-card-num">01</span>
              </div>
              <h3 className="tm-card-h">Il <em>se souvient</em> de chacun de tes trades.</h3>
              <p className="tm-card-p">Lit ton journal, croise tes émotions et ta P&L, te montre les régularités que tu ne vois pas. Pas un signal — une lecture.</p>
              <div className="tm-coach-msg">
                <div className="tm-coach-av">✦</div>
                <div>
                  <div className="tm-coach-meta">Insight #47 · vendredi 21h45</div>
                  <p>« 78 % de tes trades pris <em>frustré</em> sont perdants entre 14h et 16h. <strong>Pause obligatoire après 2 pertes</strong> — réduction de taille à −40 % la semaine suivante ?»</p>
                  <div className="tm-coach-actions">
                    <button>Activer la règle</button>
                    <button className="ghost">Voir les 47 trades</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Journal */}
            <div className="tm-card tm-c-journal">
              <div className="tm-card-head">
                <span className="tm-pill">📓 Journal</span>
                <span className="tm-card-num">02</span>
              </div>
              <h3 className="tm-card-h">10 émotions, <em>14 secondes</em>.</h3>
              <p className="tm-card-p">Capture l'état affectif au moment du trade. L'IA fait le reste.</p>
              <div className="tm-emo-grid">
                {[['😎','21%','up'],['🎯','18%','up'],['😌','16%','up'],['🤩','9%','up'],['😤','13%','dn'],['😨','9%','dn'],['😡','5%','dn'],['💰','4%','dn'],['🤔','3%',''],['😰','2%','dn']].map(([e,p,k],i)=> (
                  <div key={i} className={`tm-emo ${k}`}><span>{e}</span><b>{p}</b></div>
                ))}
              </div>
            </div>

            {/* Whales */}
            <div className="tm-card tm-c-whales">
              <div className="tm-card-head">
                <span className="tm-pill">🐋 Whales · live</span>
                <span className="tm-card-num">03</span>
              </div>
              <h3 className="tm-card-h">Les <em>gros mouvements</em> avant les autres.</h3>
              <ul className="tm-whales">
                <li className="up"><i/><span className="sym">BTC/USDT</span><span className="vol">+$8,4M</span><span className="t">2s</span></li>
                <li className="dn"><i/><span className="sym">ETH/USDT</span><span className="vol">−$2,1M</span><span className="t">14s</span></li>
                <li className="up"><i/><span className="sym">SOL/USDT</span><span className="vol">+$1,7M</span><span className="t">38s</span></li>
                <li className="up"><i/><span className="sym">DAX</span><span className="vol">+€12,8M</span><span className="t">1m</span></li>
              </ul>
            </div>

            {/* Photo AI / MTF */}
            <div className="tm-card tm-c-photo">
              <div className="tm-card-head">
                <span className="tm-pill">📸 Photo AI</span>
                <span className="tm-card-num">04</span>
              </div>
              <h3 className="tm-card-h">Capture un graphe. <em>L'IA le lit</em>.</h3>
              <p className="tm-card-p">Niveaux, structure, tendance, confluence multi-timeframe. Trois secondes, une thèse de trade complète.</p>
              <div className="tm-mtf">
                <div className="tm-tf">
                  <div className="tm-tf-meta">H4 · BTCUSD</div>
                  <svg viewBox="0 0 200 60"><polyline points="0,40 30,38 60,30 90,32 120,22 150,18 180,12 200,15" fill="none" stroke="#34D399" strokeWidth="2"/><line x1="0" y1="22" x2="200" y2="22" stroke="#F4583B" strokeWidth="0.6" strokeDasharray="2 3"/></svg>
                </div>
                <div className="tm-tf">
                  <div className="tm-tf-meta">M15 · BTCUSD</div>
                  <svg viewBox="0 0 200 60"><polyline points="0,30 25,40 50,28 75,42 100,25 125,38 150,20 175,28 200,15" fill="none" stroke="#7BA9F7" strokeWidth="2"/></svg>
                </div>
              </div>
            </div>

            {/* Calendar */}
            <div className="tm-card tm-c-cal">
              <div className="tm-card-head">
                <span className="tm-pill">📅 Calendrier</span>
                <span className="tm-card-num">05</span>
              </div>
              <h3 className="tm-card-h">Tes meilleurs jours, <em>vus de haut</em>.</h3>
              <div className="tm-heatmap">
                {Array.from({length:56}).map((_,i)=>{
                  const lvl = ['','l1','l2','l3','l4','lo1','lo2'][[2,3,1,2,4,3,0,2,5,3,4,3,1,0,3,4,4,6,5,1,2,4,3,4,3,4,3,2,1,2,4,3,2,1,3,4,3,4,3,2,2,3,1,2,4,3,0,2,5,3,4,3,1,0,3,4][i] || 0]
                  return <div key={i} className={`hm ${lvl}`}/>
                })}
              </div>
              <div className="tm-cal-leg">
                <span>Moins</span>
                <span className="hm"/><span className="hm l1"/><span className="hm l2"/><span className="hm l3"/><span className="hm l4"/>
                <span>Plus</span>
              </div>
            </div>

            {/* Big stat */}
            <div className="tm-card tm-c-stat">
              <span className="tm-card-num">06</span>
              <div className="tm-stat-num">+12<em>pts</em></div>
              <div className="tm-stat-lbl">de Win Rate moyen<br/>après 8 semaines de discipline</div>
              <div className="tm-stat-spark">
                <svg viewBox="0 0 200 40"><polyline points="0,30 25,28 50,26 75,28 100,22 125,18 150,14 175,10 200,5" fill="none" stroke="#34D399" strokeWidth="2"/></svg>
              </div>
            </div>

            {/* Badges */}
            <div className="tm-card tm-c-badges">
              <div className="tm-card-head">
                <span className="tm-pill">🏆 Badges</span>
                <span className="tm-card-num">07</span>
              </div>
              <h3 className="tm-card-h">150 paliers, <em>7 prestiges</em>.</h3>
              <p className="tm-card-p">La discipline récompensée. Une série qui se rompt — et qui reprend.</p>
              <div className="tm-badges">
                {['⭐','🎯','🔥','📓','💎','🏅','🛡️','⚡','🎖️'].map((b,i)=> (
                  <div key={i} className={`tm-bdg ${i<5?'on':''}${i===0?' legend':''}`}>{b}</div>
                ))}
                <div className="tm-bdg locked">+141</div>
              </div>
            </div>

            {/* Predict */}
            <div className="tm-card tm-c-predict">
              <div className="tm-card-head">
                <span className="tm-pill">🔮 Predict</span>
                <span className="tm-card-num">08</span>
              </div>
              <h3 className="tm-card-h">Probas <em>ex-ante</em>, basées sur <em>ton</em> historique.</h3>
              <div className="tm-proba">
                <div className="tm-proba-row"><span>Trade gagnant</span><div className="bar"><div style={{width:'72%'}}/></div><b>72 %</b></div>
                <div className="tm-proba-row"><span>R atteint &gt; 1.5</span><div className="bar"><div style={{width:'48%'}}/></div><b>48 %</b></div>
                <div className="tm-proba-row"><span>Drawdown &gt; −2 %</span><div className="bar dn"><div style={{width:'18%'}}/></div><b>18 %</b></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* METHOD */}
      <section className="tm-section tm-method" id="methode">
        <div className="tm-container">
          <div className="tm-sect-head">
            <div>
              <span className="tm-kicker">Méthode · en 3 temps</span>
              <h2 className="tm-h2">Capturer. Corréler. <em>Corriger.</em></h2>
            </div>
            <p className="tm-sect-desc">La discipline n'est pas une vertu — c'est un instrument. TradeMindset le rend mesurable.</p>
          </div>

          <div className="tm-steps">
            <article className="tm-step">
              <div className="tm-step-n">01</div>
              <h3>Capturer</h3>
              <p>Trade, émotion, intensité, contexte. Saisi en quatorze secondes, hors ligne, depuis ton mobile.</p>
              <ul>
                <li>10 émotions · intensité 1–10</li>
                <li>Screenshots automatiques</li>
                <li>R-multiples calculés</li>
              </ul>
            </article>
            <article className="tm-step">
              <div className="tm-step-n">02</div>
              <h3>Corréler</h3>
              <p>L'IA croise ton journal et ta P&L. Elle ne te donne pas de signal — elle te montre tes régularités.</p>
              <ul>
                <li>Pattern engine comportemental</li>
                <li>Insights chronométriques</li>
                <li>Score de volatilité émotionnelle</li>
              </ul>
            </article>
            <article className="tm-step">
              <div className="tm-step-n">03</div>
              <h3>Corriger</h3>
              <p>Règles automatiques, pauses obligatoires, multiplicateurs d'XP. La discipline devient système.</p>
              <ul>
                <li>Règles personnalisées</li>
                <li>Alertes pré-trade</li>
                <li>150 badges, 7 prestiges</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="tm-section">
        <div className="tm-container">
          <div className="tm-stats-row">
            <div><div className="tm-stats-num">12 480</div><div className="tm-stats-lbl">traders actifs / sem.</div></div>
            <div><div className="tm-stats-num">2,4M</div><div className="tm-stats-lbl">trades journalisés</div></div>
            <div><div className="tm-stats-num">187k</div><div className="tm-stats-lbl">insights IA livrés</div></div>
            <div><div className="tm-stats-num">99,98 %</div><div className="tm-stats-lbl">uptime · 90 j</div></div>
          </div>

          <div className="tm-quotes">
            <blockquote>
              <p>« L'app m'a dit, noir sur blanc : tes pires trades sont à 14h47, pris frustré. <em>+12 pts de win rate</em> en six semaines. »</p>
              <footer><span className="av" style={{background:'linear-gradient(135deg,#34D399,#A7F3D0)'}}>R</span><div><b>Romain L.</b><span>Trader DAX · 7 ans</span></div></footer>
            </blockquote>
            <blockquote>
              <p>« Je tenais un Notion depuis trois ans, je n'y revenais jamais. TradeMindset me <em>force</em> à m'asseoir trois minutes après chaque session. »</p>
              <footer><span className="av" style={{background:'linear-gradient(135deg,#7BA9F7,#B89AF7)'}}>I</span><div><b>Inès P.</b><span>Crypto · prop firm</span></div></footer>
            </blockquote>
            <blockquote>
              <p>« La gamification m'a sauvé du <em>revenge trading</em>. Briser une série de 47 jours pour un trade rageur ? Impossible. »</p>
              <footer><span className="av" style={{background:'linear-gradient(135deg,#F4583B,#F0C84A)'}}>K</span><div><b>Karim B.</b><span>Forex · swing</span></div></footer>
            </blockquote>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="tm-section" id="tarifs">
        <div className="tm-container">
          <div className="tm-sect-head tm-sect-center">
            <div>
              <span className="tm-kicker">Tarifs</span>
              <h2 className="tm-h2">Simple. <em>Honnête.</em> Annulable.</h2>
              <p className="tm-sect-desc" style={{marginTop:14}}>Aucune carte avant l'essai. Si la rigueur ne te va pas, la version gratuite reste à vie.</p>
            </div>
          </div>

          <div className="tm-prices">
            <div className="tm-price">
              <div className="tm-price-head"><h4>Apprenti</h4><span className="tm-price-tag">Gratuit à vie</span></div>
              <div className="tm-price-num">0€<small>/mois</small></div>
              <ul>
                <li>Journal d'émotions illimité</li>
                <li>50 premiers badges</li>
                <li>Stats de base</li>
                <li>1 compte broker</li>
              </ul>
              <Link to="/register" className="tm-btn tm-btn-ghost tm-btn-block">Commencer</Link>
            </div>
            <div className="tm-price tm-price-featured">
              <div className="tm-price-ribbon">Recommandé</div>
              <div className="tm-price-head"><h4>Pro</h4><span className="tm-price-tag">7 jours gratuits</span></div>
              <div className="tm-price-num">9€<small>/mois</small></div>
              <ul>
                <li>Tout d'Apprenti</li>
                <li>Coach IA illimité</li>
                <li>150 badges + 7 prestiges</li>
                <li>Sync TradingView, MT5, Binance</li>
                <li>Photo AI · Multi-timeframe</li>
              </ul>
              <Link to="/register" className="tm-btn tm-btn-primary tm-btn-block">Essayer Pro<span className="arr">→</span></Link>
            </div>
            <div className="tm-price">
              <div className="tm-price-head"><h4>Maître</h4><span className="tm-price-tag">Prop firms</span></div>
              <div className="tm-price-num">29€<small>/mois</small></div>
              <ul>
                <li>Tout de Pro</li>
                <li>Multi-comptes prop firm</li>
                <li>Rapports PDF certifiés</li>
                <li>Coach humain 1×/mois</li>
              </ul>
              <Link to="/register" className="tm-btn tm-btn-ghost tm-btn-block">Voir la démo</Link>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="tm-section" id="faq">
        <div className="tm-container">
          <div className="tm-sect-head">
            <div>
              <span className="tm-kicker">FAQ</span>
              <h2 className="tm-h2">Questions <em>fréquentes</em>.</h2>
            </div>
          </div>
          <div className="tm-faq">
            {[
              ['Mes données de trading sont-elles sécurisées ?', "Oui. Chiffrement AES-256 au repos, TLS en transit, hébergement européen, conformité RGPD. Tu peux exporter ou supprimer tout à tout moment."],
              ['Compatible avec mon broker ?', "TradingView, MetaTrader 5, Binance, Bybit, Interactive Brokers, FTMO et plus. Sync automatique ou import CSV."],
              ['Combien de temps pour voir des résultats ?', "Les premiers patterns émergent à partir de 30 trades journalisés. Un changement statistiquement significatif (win rate, DD) apparaît typiquement en 6 à 8 semaines."],
              ['Puis-je annuler à tout moment ?', "Oui, en deux clics. Pas d'engagement, pas de carte demandée pour l'essai gratuit."],
              ['Y a-t-il une app mobile ?', "Oui — iOS, Android et Web. Mode hors ligne pour saisir tes trades sans connexion ; sync à la reconnexion."],
            ].map(([q,a],i)=>(
              <details key={i}>
                <summary>{q}<span className="caret">+</span></summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="tm-section">
        <div className="tm-container">
          <div className="tm-final">
            <div className="tm-final-glow"/>
            <span className="tm-kicker">L'invitation</span>
            <h2 className="tm-h2">Commence ton carnet.<br/><em>Trente jours, gratuits.</em></h2>
            <p>Sans carte, sans engagement. Si tu trouves un meilleur instrument pour mesurer ta discipline, tu reviendras nous le dire.</p>
            <div className="tm-final-ctas">
              <Link to="/register" className="tm-btn tm-btn-primary tm-btn-lg">Démarrer gratuitement<span className="arr">→</span></Link>
              <a href="#produit" className="tm-btn tm-btn-ghost tm-btn-lg">Comparer les plans</a>
            </div>
          </div>
        </div>
      </section>

      <footer className="tm-footer">
        <div className="tm-container tm-footer-inner">
          <div className="tm-brand"><span className="tm-mark"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M3 16 L8 10 L12 13 L19 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="19" cy="5" r="2" fill="currentColor"/></svg></span>TradeMindset</div>
          <div className="tm-footer-links">
            <a href="#produit">Produit</a>
            <a href="#methode">Méthode</a>
            <a href="#tarifs">Tarifs</a>
            <a href="#faq">FAQ</a>
            <Link to="/login">Connexion</Link>
          </div>
          <div className="tm-footer-meta">
            <span>© 2026 TradeMindset SAS</span>
            <span>v3.4.1</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

const css = `
  .tm-root{
    --bg:#06070A;
    --bg-2:#0B0D12;
    --card:#0F1218;
    --card-2:#13171F;
    --line:rgba(255,255,255,0.06);
    --line-2:rgba(255,255,255,0.10);
    --line-3:rgba(255,255,255,0.14);
    --text:#E7E9ED;
    --text-2:#9CA1AB;
    --text-3:#6B7080;
    --green:#34D399;
    --green-2:#A7F3D0;
    --red:#F87171;
    --coral:#F4583B;
    --blue:#7BA9F7;
    --violet:#B89AF7;
    --gold:#F0C84A;
    background:var(--bg); color:var(--text);
    font-family:'Geist',-apple-system,BlinkMacSystemFont,sans-serif;
    font-size:15px; line-height:1.55; -webkit-font-smoothing:antialiased;
    min-height:100vh; position:relative; overflow-x:hidden;
  }
  .tm-root *{box-sizing:border-box}
  .tm-root ::selection{background:var(--green); color:#06070A}
  .tm-root a{color:inherit; text-decoration:none}

  .tm-bg{position:fixed; inset:0; z-index:0; pointer-events:none}
  .tm-grid{
    position:absolute; inset:0;
    background-image:
      linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
    background-size:64px 64px;
    mask-image: radial-gradient(ellipse 100% 70% at 50% 0%, #000 35%, transparent 80%);
    -webkit-mask-image: radial-gradient(ellipse 100% 70% at 50% 0%, #000 35%, transparent 80%);
  }
  .tm-glow{position:absolute; border-radius:50%; filter:blur(120px); opacity:0.55}
  .tm-glow-1{width:720px;height:720px; top:-220px; left:50%; transform:translateX(-50%); background:radial-gradient(circle, rgba(52,211,153,0.35) 0%, transparent 65%)}
  .tm-glow-2{width:560px;height:560px; top:340px; right:-120px; background:radial-gradient(circle, rgba(123,169,247,0.18) 0%, transparent 65%)}

  .tm-container{max-width:1240px; margin:0 auto; padding:0 28px; position:relative; z-index:1}
  .tm-h1, .tm-h2, .tm-h3, h1, h2, h3, h4 { color:#fff }
  em{font-family:'Instrument Serif', serif; font-style:italic; font-weight:400}

  /* NAV */
  .tm-nav{position:sticky; top:0; z-index:50; backdrop-filter:blur(14px); background:rgba(6,7,10,0.7); border-bottom:1px solid var(--line)}
  .tm-nav-inner{max-width:1240px; margin:0 auto; padding:14px 28px; display:flex; align-items:center; justify-content:space-between; gap:24px}
  .tm-brand{display:flex; align-items:center; gap:10px; font-weight:600; font-size:15.5px; letter-spacing:-0.01em; color:#fff}
  .tm-mark{width:28px;height:28px;border-radius:8px; background:linear-gradient(135deg,#0F1F18, #1B3F2E); border:1px solid rgba(52,211,153,0.3); color:var(--green); display:inline-flex;align-items:center;justify-content:center; box-shadow:0 0 16px rgba(52,211,153,0.25)}
  .tm-nav-links{display:flex; gap:4px}
  .tm-nav-links a{padding:7px 14px; border-radius:8px; color:var(--text-2); font-size:13.5px; font-weight:500}
  .tm-nav-links a:hover{color:#fff; background:rgba(255,255,255,0.04)}
  .tm-nav-cta{display:flex; gap:8px; align-items:center}

  .tm-btn{display:inline-flex; align-items:center; gap:8px; padding:9px 16px; border-radius:9px; font-size:13.5px; font-weight:600; cursor:pointer; border:1px solid transparent; transition:transform .12s, background .18s, border-color .18s; white-space:nowrap; line-height:1; font-family:inherit}
  .tm-btn .arr{font-family:'Geist Mono',monospace; font-weight:400}
  .tm-btn-primary{background:#fff; color:#06070A; border-color:#fff}
  .tm-btn-primary:hover{transform:translateY(-1px); background:#F4F2EE}
  .tm-btn-ghost{background:rgba(255,255,255,0.03); color:#fff; border-color:var(--line-2)}
  .tm-btn-ghost:hover{background:rgba(255,255,255,0.06); border-color:var(--line-3)}
  .tm-btn-lg{padding:13px 22px; font-size:14.5px; border-radius:11px}
  .tm-btn-block{display:flex; width:100%; justify-content:center; padding:13px 16px}
  .tm-btn-lg .play{font-size:11px; opacity:0.7}

  /* HERO */
  .tm-hero{padding:64px 0 56px; text-align:center; position:relative}
  .tm-eyebrow{display:inline-flex; align-items:center; gap:10px; padding:6px 12px; border-radius:999px; background:rgba(255,255,255,0.04); border:1px solid var(--line-2); font-size:12.5px; color:var(--text-2); font-family:'Geist Mono', monospace; letter-spacing:0.01em}
  .tm-ping{width:7px; height:7px; border-radius:50%; background:var(--green); box-shadow:0 0 12px var(--green); animation:tm-pulse 2s infinite}
  @keyframes tm-pulse{0%,100%{opacity:1; transform:scale(1)}50%{opacity:.6; transform:scale(1.15)}}
  .tm-h1{font-size:clamp(46px, 7.2vw, 92px); font-weight:600; line-height:1; letter-spacing:-0.045em; margin:24px auto 20px; max-width:1000px; text-wrap:balance; background:linear-gradient(180deg, #FFFFFF 0%, #B7BBC4 100%); -webkit-background-clip:text; background-clip:text; color:transparent}
  .tm-h1 em{background:linear-gradient(180deg, #BBF7D0 0%, var(--green) 100%); -webkit-background-clip:text; background-clip:text; color:transparent; font-size:0.96em}
  .tm-sub{color:var(--text-2); max-width:620px; margin:0 auto 32px; font-size:17px; line-height:1.55; text-wrap:pretty}
  .tm-hero-ctas{display:inline-flex; gap:10px; flex-wrap:wrap; justify-content:center}
  .tm-hero-meta{display:flex; align-items:center; justify-content:center; gap:14px; margin-top:28px; font-family:'Geist Mono',monospace; font-size:12px; color:var(--text-3); flex-wrap:wrap}
  .tm-hero-meta .dot{width:3px; height:3px; border-radius:50%; background:var(--text-3)}

  /* CHART */
  .tm-chart-wrap{margin-top:64px}
  .tm-chart-card{background:linear-gradient(180deg, rgba(15,18,24,0.85) 0%, rgba(11,13,18,0.95) 100%); border:1px solid var(--line-2); border-radius:24px; padding:24px; backdrop-filter:blur(20px); position:relative; overflow:hidden; box-shadow:0 30px 80px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(52,211,153,0.04) inset}
  .tm-chart-card::before{content:""; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg, transparent, rgba(52,211,153,0.45), transparent)}
  .tm-chart-head{display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; gap:14px; flex-wrap:wrap}
  .tm-chart-title{display:flex; align-items:center; gap:14px; flex-wrap:wrap}
  .tm-chip{display:inline-flex; align-items:center; gap:8px; padding:6px 12px; border-radius:8px; background:rgba(52,211,153,0.08); border:1px solid rgba(52,211,153,0.25); color:var(--green); font-size:12.5px; font-weight:500}
  .tm-chart-meta{font-family:'Geist Mono',monospace; font-size:12px; color:var(--text-3)}
  .tm-chart-tabs{display:flex; gap:2px; padding:3px; background:rgba(255,255,255,0.04); border:1px solid var(--line-2); border-radius:9px}
  .tm-chart-tabs span{padding:5px 11px; font-family:'Geist Mono',monospace; font-size:11.5px; color:var(--text-3); border-radius:6px; cursor:pointer}
  .tm-chart-tabs span.active{background:rgba(255,255,255,0.08); color:#fff}
  .tm-kpis{display:grid; grid-template-columns:repeat(5, 1fr); gap:18px; padding:18px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); margin-bottom:18px}
  .tm-kpi-lbl{font-family:'Geist Mono',monospace; font-size:11px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:5px}
  .tm-kpi-val{font-family:'Geist',sans-serif; font-size:24px; font-weight:600; letter-spacing:-0.02em; color:#fff}
  .tm-kpi-val.tm-up{color:var(--green)}
  .tm-kpi-val.tm-down{color:var(--coral)}
  .tm-kpi-delta{font-family:'Geist Mono',monospace; font-size:11px; color:var(--text-3); margin-top:3px}
  .tm-kpi-delta.tm-up{color:var(--green)}
  .tm-up{color:var(--green)} .tm-down{color:var(--coral)}
  .tm-chart-svg{height:300px}
  .tm-chart-svg svg{width:100%; height:100%; display:block}

  .tm-trust{display:flex; align-items:center; gap:24px; margin-top:36px; padding:18px 24px; border:1px solid var(--line); border-radius:14px; background:rgba(255,255,255,0.015); flex-wrap:wrap}
  .tm-trust-lbl{font-family:'Geist Mono',monospace; font-size:11px; color:var(--text-3); letter-spacing:0.12em}
  .tm-trust-logos{display:flex; gap:28px; flex-wrap:wrap; flex:1; justify-content:flex-end}
  .tm-trust-logos span{font-family:'Instrument Serif',serif; font-style:italic; font-size:17px; color:var(--text-2); opacity:0.85}

  /* SECTION */
  .tm-section{padding:96px 0; position:relative}
  .tm-sect-head{display:flex; align-items:flex-end; justify-content:space-between; gap:48px; margin-bottom:48px; flex-wrap:wrap}
  .tm-sect-head.tm-sect-center{justify-content:center; text-align:center}
  .tm-kicker{display:inline-block; font-family:'Geist Mono',monospace; font-size:11px; color:var(--green); letter-spacing:0.14em; text-transform:uppercase; margin-bottom:14px}
  .tm-h2{font-size:clamp(36px, 4.6vw, 60px); font-weight:600; letter-spacing:-0.035em; line-height:1.04; margin:0; max-width:780px; text-wrap:balance}
  .tm-h2 em{background:linear-gradient(180deg, #BBF7D0 0%, var(--green) 100%); -webkit-background-clip:text; background-clip:text; color:transparent}
  .tm-sect-desc{color:var(--text-2); max-width:420px; margin:0; font-size:15.5px; line-height:1.6}

  /* BENTO */
  .tm-bento{display:grid; grid-template-columns:repeat(12, 1fr); gap:14px}
  .tm-card{background:linear-gradient(180deg, rgba(15,18,24,0.7) 0%, rgba(11,13,18,0.9) 100%); border:1px solid var(--line-2); border-radius:18px; padding:22px; position:relative; overflow:hidden; backdrop-filter:blur(10px)}
  .tm-card::before{content:""; position:absolute; top:0; left:24px; right:24px; height:1px; background:linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)}
  .tm-c-coach{grid-column:span 7; grid-row:span 2}
  .tm-c-journal{grid-column:span 5; grid-row:span 2}
  .tm-c-whales{grid-column:span 4; grid-row:span 2}
  .tm-c-photo{grid-column:span 4; grid-row:span 2}
  .tm-c-cal{grid-column:span 4; grid-row:span 2}
  .tm-c-stat{grid-column:span 3; grid-row:span 2; display:flex; flex-direction:column; justify-content:center; text-align:left}
  .tm-c-badges{grid-column:span 5; grid-row:span 2}
  .tm-c-predict{grid-column:span 4; grid-row:span 2}

  .tm-card-head{display:flex; align-items:center; justify-content:space-between; margin-bottom:14px}
  .tm-pill{display:inline-flex; align-items:center; gap:6px; padding:5px 11px; border-radius:8px; background:rgba(255,255,255,0.04); border:1px solid var(--line-2); color:var(--text-2); font-size:12px; font-weight:500; font-family:'Geist Mono',monospace; letter-spacing:0.02em}
  .tm-pill-glow{background:rgba(52,211,153,0.08); border-color:rgba(52,211,153,0.25); color:var(--green)}
  .tm-card-num{font-family:'Geist Mono',monospace; font-size:11px; color:var(--text-3); letter-spacing:0.06em}
  .tm-card-h{font-size:24px; font-weight:600; letter-spacing:-0.025em; line-height:1.15; margin:6px 0 8px; color:#fff}
  .tm-card-h em{color:var(--green-2)}
  .tm-card-p{margin:0 0 14px; color:var(--text-2); font-size:14px; line-height:1.55}
  .tm-card-p em{color:var(--green-2)}

  /* Coach card */
  .tm-coach-msg{display:flex; gap:12px; align-items:flex-start; padding:14px; background:rgba(52,211,153,0.04); border:1px solid rgba(52,211,153,0.18); border-radius:14px}
  .tm-coach-av{flex-shrink:0; width:34px; height:34px; border-radius:50%; background:linear-gradient(135deg, var(--green), #059669); display:flex; align-items:center; justify-content:center; font-size:16px; color:#06070A; font-weight:700; box-shadow:0 0 16px rgba(52,211,153,0.4)}
  .tm-coach-meta{font-family:'Geist Mono',monospace; font-size:11px; color:var(--text-3); margin-bottom:6px}
  .tm-coach-msg p{margin:0 0 12px; font-size:13.5px; line-height:1.55; color:var(--text)}
  .tm-coach-msg p em{color:var(--green-2)}
  .tm-coach-msg p strong{color:#fff; font-weight:600}
  .tm-coach-actions{display:flex; gap:8px}
  .tm-coach-actions button{padding:6px 12px; font-size:12px; border-radius:7px; border:1px solid rgba(52,211,153,0.4); background:rgba(52,211,153,0.12); color:var(--green); cursor:pointer; font-family:inherit; font-weight:500}
  .tm-coach-actions button.ghost{background:transparent; border-color:var(--line-2); color:var(--text-2)}

  /* Journal emo grid */
  .tm-emo-grid{display:grid; grid-template-columns:repeat(5, 1fr); gap:6px; margin-top:auto}
  .tm-emo{aspect-ratio:1/1; border-radius:10px; background:rgba(255,255,255,0.03); border:1px solid var(--line); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; position:relative}
  .tm-emo span{font-size:20px}
  .tm-emo b{font-family:'Geist Mono',monospace; font-size:9.5px; font-weight:600; color:var(--text-3); letter-spacing:0.02em}
  .tm-emo.up{background:rgba(52,211,153,0.06); border-color:rgba(52,211,153,0.18)}
  .tm-emo.up b{color:var(--green-2)}
  .tm-emo.dn{background:rgba(244,88,59,0.06); border-color:rgba(244,88,59,0.2)}
  .tm-emo.dn b{color:var(--coral)}

  /* Whales */
  .tm-whales{list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:6px}
  .tm-whales li{display:grid; grid-template-columns:8px 1fr auto auto; gap:12px; align-items:center; padding:10px 12px; background:rgba(255,255,255,0.03); border:1px solid var(--line); border-radius:10px; font-size:13px}
  .tm-whales li i{width:8px; height:8px; border-radius:50%; display:block}
  .tm-whales li.up i{background:var(--green); box-shadow:0 0 10px var(--green)}
  .tm-whales li.dn i{background:var(--coral); box-shadow:0 0 10px var(--coral)}
  .tm-whales .sym{font-family:'Geist Mono',monospace; font-weight:600; color:#fff}
  .tm-whales .vol{font-family:'Geist Mono',monospace; color:var(--text-2); font-size:12.5px}
  .tm-whales li.up .vol{color:var(--green-2)}
  .tm-whales li.dn .vol{color:var(--coral)}
  .tm-whales .t{font-family:'Geist Mono',monospace; font-size:11px; color:var(--text-3)}

  /* MTF */
  .tm-mtf{display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:auto}
  .tm-tf{background:rgba(255,255,255,0.025); border:1px solid var(--line); border-radius:10px; padding:10px}
  .tm-tf-meta{font-family:'Geist Mono',monospace; font-size:10.5px; color:var(--text-3); margin-bottom:6px}
  .tm-tf svg{width:100%; height:42px; display:block}

  /* Heatmap */
  .tm-heatmap{display:grid; grid-template-columns:repeat(14, 1fr); gap:3px; margin:14px 0 10px}
  .tm-heatmap .hm{aspect-ratio:1/1; border-radius:3px; background:rgba(255,255,255,0.04)}
  .hm.l1{background:rgba(52,211,153,0.22)} .hm.l2{background:rgba(52,211,153,0.42)} .hm.l3{background:rgba(52,211,153,0.65)} .hm.l4{background:#34D399}
  .hm.lo1{background:rgba(244,88,59,0.45)} .hm.lo2{background:rgba(244,88,59,0.7)}
  .tm-cal-leg{display:flex; align-items:center; gap:5px; font-family:'Geist Mono',monospace; font-size:11px; color:var(--text-3)}
  .tm-cal-leg .hm{width:11px; height:11px; border-radius:2.5px}

  /* Big stat */
  .tm-c-stat{padding:24px}
  .tm-stat-num{font-size:74px; font-weight:600; letter-spacing:-0.045em; line-height:0.9; color:#fff; margin-bottom:8px}
  .tm-stat-num em{font-size:30px; color:var(--green); margin-left:2px}
  .tm-stat-lbl{color:var(--text-2); font-size:13.5px; line-height:1.45}
  .tm-stat-spark{margin-top:14px}
  .tm-stat-spark svg{width:100%; height:38px}

  /* Badges */
  .tm-badges{display:grid; grid-template-columns:repeat(5, 1fr); gap:8px; margin-top:auto}
  .tm-bdg{aspect-ratio:1/1; border-radius:10px; border:1px solid var(--line); background:rgba(255,255,255,0.025); display:flex; align-items:center; justify-content:center; font-size:22px}
  .tm-bdg.on{background:rgba(240,200,74,0.10); border-color:rgba(240,200,74,0.35)}
  .tm-bdg.legend{background:linear-gradient(135deg, rgba(244,88,59,0.18), rgba(240,200,74,0.18)); border-color:rgba(244,88,59,0.45)}
  .tm-bdg.locked{font-family:'Geist Mono',monospace; font-size:13px; color:var(--text-3); font-weight:600}

  /* Predict */
  .tm-proba{display:flex; flex-direction:column; gap:10px; margin-top:auto}
  .tm-proba-row{display:grid; grid-template-columns:1fr 80px 36px; gap:10px; align-items:center; font-size:12.5px; color:var(--text-2)}
  .tm-proba-row .bar{height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden}
  .tm-proba-row .bar div{height:100%; background:linear-gradient(90deg, var(--green), var(--green-2)); border-radius:3px}
  .tm-proba-row .bar.dn div{background:linear-gradient(90deg, var(--coral), #FFA088)}
  .tm-proba-row b{font-family:'Geist Mono',monospace; font-weight:600; color:#fff; text-align:right; font-size:12.5px}

  /* Steps */
  .tm-method{background:linear-gradient(180deg, transparent, rgba(15,18,24,0.5))}
  .tm-steps{display:grid; grid-template-columns:repeat(3, 1fr); gap:18px}
  .tm-step{background:linear-gradient(180deg, rgba(15,18,24,0.6), rgba(11,13,18,0.85)); border:1px solid var(--line-2); border-radius:18px; padding:28px}
  .tm-step-n{font-family:'Geist Mono',monospace; font-size:12px; color:var(--green); letter-spacing:0.1em; margin-bottom:14px}
  .tm-step h3{font-size:26px; font-weight:600; letter-spacing:-0.025em; margin:0 0 10px; color:#fff}
  .tm-step p{color:var(--text-2); font-size:14.5px; line-height:1.55; margin:0 0 16px}
  .tm-step ul{list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:6px; font-size:13.5px; color:var(--text-2)}
  .tm-step ul li{padding-left:18px; position:relative}
  .tm-step ul li::before{content:""; position:absolute; left:0; top:8px; width:8px; height:8px; border:1px solid var(--green); border-radius:50%; background:transparent}

  /* Stats row */
  .tm-stats-row{display:grid; grid-template-columns:repeat(4, 1fr); gap:18px; padding:32px; background:linear-gradient(180deg, rgba(15,18,24,0.6), rgba(11,13,18,0.85)); border:1px solid var(--line-2); border-radius:18px; text-align:center}
  .tm-stats-num{font-family:'Geist',sans-serif; font-size:42px; font-weight:600; letter-spacing:-0.04em; line-height:1; color:#fff; background:linear-gradient(180deg, #fff, var(--green-2)); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent}
  .tm-stats-lbl{font-family:'Geist Mono',monospace; font-size:11.5px; color:var(--text-3); letter-spacing:0.06em; text-transform:uppercase; margin-top:6px}

  /* Quotes */
  .tm-quotes{display:grid; grid-template-columns:repeat(3, 1fr); gap:18px; margin-top:32px}
  .tm-quotes blockquote{margin:0; background:linear-gradient(180deg, rgba(15,18,24,0.55), rgba(11,13,18,0.8)); border:1px solid var(--line-2); border-radius:18px; padding:24px}
  .tm-quotes p{margin:0 0 18px; font-family:'Instrument Serif',serif; font-size:19px; line-height:1.45; color:var(--text); font-style:italic}
  .tm-quotes p em{color:var(--green); font-style:italic}
  .tm-quotes footer{display:flex; align-items:center; gap:10px}
  .tm-quotes .av{width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:600; color:#06070A; font-size:13px; font-family:'Geist',sans-serif}
  .tm-quotes footer b{display:block; font-size:13px; font-weight:600; color:#fff}
  .tm-quotes footer span{font-family:'Geist Mono',monospace; font-size:11px; color:var(--text-3)}

  /* Pricing */
  .tm-prices{display:grid; grid-template-columns:repeat(3, 1fr); gap:14px; max-width:1080px; margin:0 auto}
  .tm-price{background:linear-gradient(180deg, rgba(15,18,24,0.7), rgba(11,13,18,0.9)); border:1px solid var(--line-2); border-radius:20px; padding:28px; position:relative}
  .tm-price-featured{border-color:rgba(52,211,153,0.4); box-shadow:0 0 0 1px rgba(52,211,153,0.2), 0 30px 80px -30px rgba(52,211,153,0.25)}
  .tm-price-featured::before{content:""; position:absolute; inset:0; border-radius:20px; padding:1px; background:linear-gradient(135deg, rgba(52,211,153,0.5), transparent 50%); -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite:xor; mask-composite:exclude; pointer-events:none}
  .tm-price-ribbon{position:absolute; top:-12px; left:50%; transform:translateX(-50%); background:var(--green); color:#06070A; padding:5px 14px; border-radius:999px; font-family:'Geist Mono',monospace; font-size:11px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase}
  .tm-price-head{display:flex; align-items:baseline; justify-content:space-between; margin-bottom:6px}
  .tm-price-head h4{margin:0; font-size:18px; font-weight:600; color:#fff}
  .tm-price-tag{font-family:'Geist Mono',monospace; font-size:10.5px; color:var(--text-3); letter-spacing:0.06em; text-transform:uppercase}
  .tm-price-num{font-size:48px; font-weight:600; letter-spacing:-0.04em; line-height:1; color:#fff; margin:18px 0 24px}
  .tm-price-num small{font-size:13px; font-weight:500; color:var(--text-3); letter-spacing:0; margin-left:2px}
  .tm-price ul{list-style:none; padding:0; margin:0 0 24px; display:flex; flex-direction:column; gap:9px; font-size:13.5px; color:var(--text-2)}
  .tm-price ul li{padding-left:22px; position:relative; line-height:1.45}
  .tm-price ul li::before{content:"✓"; position:absolute; left:0; top:0; color:var(--green); font-weight:700; font-size:14px}

  /* FAQ */
  .tm-faq{max-width:840px; margin:0 auto; display:flex; flex-direction:column; gap:8px}
  .tm-faq details{background:linear-gradient(180deg, rgba(15,18,24,0.5), rgba(11,13,18,0.75)); border:1px solid var(--line-2); border-radius:14px; overflow:hidden}
  .tm-faq summary{cursor:pointer; padding:18px 24px; font-size:15.5px; font-weight:500; color:#fff; display:flex; align-items:center; justify-content:space-between; gap:14px; list-style:none}
  .tm-faq summary::-webkit-details-marker{display:none}
  .tm-faq .caret{font-family:'Geist Mono',monospace; font-size:18px; color:var(--text-3); transition:transform .2s; line-height:1}
  .tm-faq details[open] .caret{transform:rotate(45deg); color:var(--green)}
  .tm-faq p{margin:0; padding:0 24px 22px; color:var(--text-2); font-size:14.5px; line-height:1.6}

  /* Final CTA */
  .tm-final{position:relative; text-align:center; padding:80px 32px; border:1px solid var(--line-2); border-radius:28px; background:linear-gradient(180deg, rgba(15,18,24,0.85), rgba(6,7,10,0.95)); overflow:hidden}
  .tm-final-glow{position:absolute; inset:0; background:radial-gradient(ellipse 80% 60% at 50% 100%, rgba(52,211,153,0.25) 0%, transparent 60%); pointer-events:none}
  .tm-final .tm-h2{margin:14px auto 16px; max-width:680px; position:relative}
  .tm-final p{color:var(--text-2); max-width:540px; margin:0 auto 28px; font-size:16px; position:relative}
  .tm-final-ctas{display:inline-flex; gap:10px; flex-wrap:wrap; justify-content:center; position:relative}

  /* Footer */
  .tm-footer{padding:40px 0; border-top:1px solid var(--line); margin-top:64px}
  .tm-footer-inner{display:flex; align-items:center; justify-content:space-between; gap:24px; flex-wrap:wrap}
  .tm-footer-links{display:flex; gap:22px; font-size:13.5px; color:var(--text-2)}
  .tm-footer-links a:hover{color:#fff}
  .tm-footer-meta{display:flex; gap:18px; font-family:'Geist Mono',monospace; font-size:11.5px; color:var(--text-3)}

  /* Responsive */
  @media (max-width:1080px){
    .tm-c-coach,.tm-c-journal{grid-column:span 12}
    .tm-c-whales,.tm-c-photo,.tm-c-cal{grid-column:span 6}
    .tm-c-stat,.tm-c-badges,.tm-c-predict{grid-column:span 6}
    .tm-kpis{grid-template-columns:repeat(3,1fr); gap:14px}
    .tm-quotes,.tm-steps,.tm-prices{grid-template-columns:1fr}
    .tm-stats-row{grid-template-columns:repeat(2,1fr)}
  }
  @media (max-width:680px){
    .tm-nav-links{display:none}
    .tm-h1{font-size:42px}
    .tm-h2{font-size:32px}
    .tm-c-whales,.tm-c-photo,.tm-c-cal,.tm-c-stat,.tm-c-badges,.tm-c-predict{grid-column:span 12}
    .tm-kpis{grid-template-columns:repeat(2,1fr)}
    .tm-chart-svg{height:200px}
    .tm-stats-row{grid-template-columns:1fr 1fr; padding:22px}
    .tm-stats-num{font-size:32px}
    .tm-final{padding:48px 22px}
  }
`
