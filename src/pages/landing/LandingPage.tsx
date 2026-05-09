// src/pages/landing/LandingPage.tsx
// Variante 2 — Dopamine Duolingo. Hand-crafted FR copy.
import { Link } from 'react-router-dom'

export default function LandingPage() {
  return (
    <div className="tm-landing-v2">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800;900&family=Geist+Mono:wght@500;600&display=swap');

        .tm-landing-v2{
          --bg:#FFFEF7;
          --bg-soft:#FFF4D6;
          --ink:#1B1F2A;
          --ink-soft:#3F4554;
          --muted:#7A8197;
          --acid:#58CC02;
          --acid-deep:#46A302;
          --acid-shadow:#2E7300;
          --gold:#FFC800;
          --gold-shadow:#C99A00;
          --pink:#FF4B6E;
          --pink-shadow:#C7263F;
          --blue:#1CB0F6;
          --blue-shadow:#0E81B8;
          --purple:#CE82FF;
          --line:#E8E5D5;
          --card:#FFFFFF;
          background:var(--bg);
          color:var(--ink);
          font-family:'Nunito',system-ui,sans-serif;
          font-weight:700;
          font-size:17px;
          line-height:1.5;
          -webkit-font-smoothing:antialiased;
          min-height:100vh;
        }
        .tm-landing-v2 *{box-sizing:border-box}
        .tm-landing-v2 .mono{font-family:'Geist Mono',monospace;font-weight:600}
        .tm-landing-v2 ::selection{background:var(--acid);color:#fff}

        .tm-landing-v2 .btn{
          display:inline-flex;align-items:center;justify-content:center;gap:10px;
          padding:16px 28px;border-radius:16px;
          font-family:'Nunito',sans-serif;font-weight:900;font-size:15px;
          text-transform:uppercase;letter-spacing:0.06em;
          cursor:pointer;border:0;text-decoration:none;
          transition:transform .08s ease, box-shadow .08s ease;
        }
        .tm-landing-v2 .btn-acid{background:var(--acid);color:#fff;box-shadow:0 5px 0 var(--acid-shadow)}
        .tm-landing-v2 .btn-acid:hover{transform:translateY(2px);box-shadow:0 3px 0 var(--acid-shadow)}
        .tm-landing-v2 .btn-acid:active{transform:translateY(5px);box-shadow:0 0 0 var(--acid-shadow)}
        .tm-landing-v2 .btn-white{background:#fff;color:var(--ink);box-shadow:0 5px 0 var(--line);border:2px solid var(--line)}
        .tm-landing-v2 .btn-white:hover{transform:translateY(2px);box-shadow:0 3px 0 var(--line)}
        .tm-landing-v2 .btn-pink{background:var(--pink);color:#fff;box-shadow:0 5px 0 var(--pink-shadow)}
        .tm-landing-v2 .btn-gold{background:var(--gold);color:var(--ink);box-shadow:0 5px 0 var(--gold-shadow)}

        .tm-landing-v2 .container{max-width:1180px;margin:0 auto;padding:0 24px}

        .tm-landing-v2 nav.top{
          position:sticky;top:0;z-index:50;
          background:rgba(255,254,247,0.92);backdrop-filter:blur(12px);
          border-bottom:2px solid var(--line);
        }
        .tm-landing-v2 .nav-inner{display:flex;align-items:center;justify-content:space-between;padding:14px 0}
        .tm-landing-v2 .brand{display:flex;align-items:center;gap:10px;font-family:'Nunito',sans-serif;font-weight:900;font-size:22px;letter-spacing:-0.01em;color:var(--ink);text-decoration:none}
        .tm-landing-v2 .nav-links{display:flex;gap:8px;align-items:center}
        .tm-landing-v2 .nav-link{padding:8px 14px;border-radius:12px;font-weight:800;color:var(--ink-soft);text-decoration:none;font-size:14px}
        .tm-landing-v2 .nav-link:hover{background:var(--bg-soft);color:var(--ink)}
        .tm-landing-v2 .nav-streak{display:inline-flex;gap:6px;align-items:center;background:#FFF1B8;border:2px solid var(--gold);border-radius:12px;padding:6px 12px;font-weight:900;color:#8B6500}

        .tm-landing-v2 .hero{padding:48px 0 80px;position:relative;overflow:hidden}
        .tm-landing-v2 .hero-grid{display:grid;grid-template-columns:1.05fr 1fr;gap:40px;align-items:center}
        .tm-landing-v2 .badge-chip{display:inline-flex;align-items:center;gap:8px;background:#fff;border:2px solid var(--line);border-radius:999px;padding:8px 14px;font-size:13px;font-weight:800;color:var(--ink-soft);box-shadow:0 3px 0 var(--line)}
        .tm-landing-v2 .badge-chip .star{color:var(--gold);font-size:14px}
        .tm-landing-v2 h1.huge{
          font-family:'Nunito',sans-serif;font-weight:900;
          font-size:clamp(44px,6.6vw,82px);line-height:0.96;letter-spacing:-0.025em;
          margin:18px 0 18px;text-wrap:balance;color:var(--ink);
        }
        .tm-landing-v2 h1.huge .hl{position:relative;color:var(--acid-deep);display:inline-block}
        .tm-landing-v2 h1.huge .hl::after{
          content:"";position:absolute;left:-2%;right:-2%;bottom:6%;height:18%;
          background:#D7F08B;z-index:-1;border-radius:6px;
        }
        .tm-landing-v2 .hero p.sub{font-size:18px;color:var(--ink-soft);max-width:520px;margin:0 0 28px;font-weight:700}
        .tm-landing-v2 .hero-ctas{display:flex;gap:14px;flex-wrap:wrap;align-items:center}
        .tm-landing-v2 .hero-trust{display:flex;align-items:center;gap:10px;margin-top:24px;font-size:13px;color:var(--muted);font-weight:700}
        .tm-landing-v2 .avatars{display:flex}
        .tm-landing-v2 .avatars .av{width:30px;height:30px;border-radius:50%;border:2.5px solid var(--bg);margin-left:-8px;display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:#fff}
        .tm-landing-v2 .avatars .av:first-child{margin-left:0}

        .tm-landing-v2 .stage{position:relative;aspect-ratio:1/1;max-width:520px;margin:0 auto}
        .tm-landing-v2 .ground{position:absolute;left:5%;right:5%;bottom:8%;height:28%;background:radial-gradient(ellipse at center, var(--bg-soft) 0%, transparent 70%);border-radius:50%}
        .tm-landing-v2 .floating-card{
          position:absolute;background:var(--card);border:2px solid var(--line);border-radius:18px;
          padding:12px 14px;box-shadow:0 6px 0 var(--line);
          font-size:13px;font-weight:800;
          animation:tm2float 4s ease-in-out infinite;
        }
        .tm-landing-v2 .fc-1{top:6%;left:-4%;animation-delay:.2s}
        .tm-landing-v2 .fc-2{top:14%;right:-4%;animation-delay:.8s;display:flex;align-items:center;gap:10px}
        .tm-landing-v2 .fc-3{bottom:18%;left:-6%;animation-delay:1.2s}
        .tm-landing-v2 .fc-4{bottom:8%;right:-2%;animation-delay:.5s}
        @keyframes tm2float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        .tm-landing-v2 .fc-1 .row{display:flex;align-items:center;gap:8px}
        .tm-landing-v2 .fc-1 .dot{width:10px;height:10px;border-radius:50%;background:var(--acid)}
        .tm-landing-v2 .fc-2 .xp-num{background:var(--gold);color:var(--ink);border-radius:10px;padding:4px 8px;font-weight:900}
        .tm-landing-v2 .fc-3 .label{color:var(--muted);font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px}
        .tm-landing-v2 .fc-3 .value{font-family:'Geist Mono',monospace;font-weight:700;color:var(--acid-deep);font-size:18px}

        .tm-landing-v2 section.tm-section{padding:80px 0;position:relative}

        .tm-landing-v2 .path-section{background:var(--bg-soft);border-top:3px solid var(--line);border-bottom:3px solid var(--line)}
        .tm-landing-v2 .path-head{text-align:center;margin-bottom:48px}
        .tm-landing-v2 .path-head h2{font-size:clamp(34px,4.8vw,56px);font-weight:900;letter-spacing:-0.02em;margin:0 0 12px;text-wrap:balance;line-height:1;color:var(--ink)}
        .tm-landing-v2 .path-head p{color:var(--ink-soft);max-width:560px;margin:0 auto;font-size:17px}
        .tm-landing-v2 .lesson-path{position:relative;max-width:380px;margin:0 auto;padding:20px 0}
        .tm-landing-v2 .lesson-row{display:flex;justify-content:center;margin:14px 0}
        .tm-landing-v2 .lesson-row.r-l{justify-content:flex-start;padding-left:30px}
        .tm-landing-v2 .lesson-row.r-r{justify-content:flex-end;padding-right:30px}
        .tm-landing-v2 .lesson{
          position:relative;width:88px;height:88px;border-radius:50%;
          display:flex;align-items:center;justify-content:center;
          font-size:36px;font-weight:900;cursor:pointer;
          background:var(--acid);color:#fff;
          box-shadow:0 7px 0 var(--acid-shadow);
          border:4px solid #fff;
        }
        .tm-landing-v2 .lesson.locked{background:#D7D3C3;color:#fff;box-shadow:0 7px 0 #A8A290}
        .tm-landing-v2 .lesson.gold{background:var(--gold);box-shadow:0 7px 0 var(--gold-shadow);color:var(--ink)}
        .tm-landing-v2 .lesson.purple{background:var(--purple);box-shadow:0 7px 0 #9B5BCC}
        .tm-landing-v2 .lesson .crown{position:absolute;top:-14px;left:50%;transform:translateX(-50%);background:var(--gold);border:3px solid #fff;border-radius:8px;padding:2px 8px;font-size:11px;font-weight:900;color:var(--ink);box-shadow:0 2px 0 var(--gold-shadow)}
        .tm-landing-v2 .lesson-label{font-size:13px;font-weight:800;color:var(--ink);text-align:center;margin-top:12px;line-height:1.2}
        .tm-landing-v2 .lesson-label small{display:block;font-weight:700;color:var(--muted);font-size:11px;margin-top:2px}

        .tm-landing-v2 .how-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:48px}
        .tm-landing-v2 .how-card{
          background:var(--card);border:3px solid var(--ink);border-radius:24px;
          padding:28px 24px;box-shadow:0 8px 0 var(--ink);position:relative;
          display:flex;flex-direction:column;gap:16px;
        }
        .tm-landing-v2 .how-card.tilt-l{transform:rotate(-1.2deg)}
        .tm-landing-v2 .how-card.tilt-r{transform:rotate(1.2deg)}
        .tm-landing-v2 .how-card .step{position:absolute;top:-18px;left:24px;background:var(--gold);color:var(--ink);border:3px solid var(--ink);border-radius:12px;padding:4px 12px;font-weight:900;font-size:13px}
        .tm-landing-v2 .how-card .icon-box{width:80px;height:80px;border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:42px;border:3px solid var(--ink);box-shadow:0 4px 0 var(--ink)}
        .tm-landing-v2 .how-card.c1 .icon-box{background:#D7F08B}
        .tm-landing-v2 .how-card.c2 .icon-box{background:#BCE6FF}
        .tm-landing-v2 .how-card.c3 .icon-box{background:#FFD6DD}
        .tm-landing-v2 .how-card h3{margin:0;font-size:24px;font-weight:900;letter-spacing:-0.01em;line-height:1.1;color:var(--ink)}
        .tm-landing-v2 .how-card p{margin:0;color:var(--ink-soft);font-weight:700;font-size:15px}
        .tm-landing-v2 .how-card .reward{display:flex;align-items:center;gap:8px;font-weight:900;font-size:13px;color:var(--acid-deep);margin-top:auto;padding-top:10px;border-top:2px dashed var(--line)}
        .tm-landing-v2 em.tm-em{font-style:normal;background:#FFF1B8;padding:0 4px;border-radius:4px}

        .tm-landing-v2 .pop-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:48px}
        .tm-landing-v2 .pop-stat{background:var(--card);border:3px solid var(--ink);border-radius:20px;padding:20px;box-shadow:0 6px 0 var(--ink);text-align:center}
        .tm-landing-v2 .pop-stat .emoji{font-size:32px;margin-bottom:6px}
        .tm-landing-v2 .pop-stat .num{font-family:'Geist Mono',monospace;font-weight:700;font-size:30px;letter-spacing:-0.02em;color:var(--ink)}
        .tm-landing-v2 .pop-stat .lbl{font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-top:4px}

        .tm-landing-v2 .coach-section{background:var(--bg)}
        .tm-landing-v2 .coach-grid{display:grid;grid-template-columns:1fr 1.2fr;gap:48px;align-items:center}
        .tm-landing-v2 .coach-portrait{position:relative;aspect-ratio:1/1;max-width:380px;margin:0 auto}
        .tm-landing-v2 .speech{
          background:var(--card);border:3px solid var(--ink);border-radius:24px;
          padding:24px 26px;box-shadow:0 8px 0 var(--ink);position:relative;
        }
        .tm-landing-v2 .speech::before,.tm-landing-v2 .speech::after{
          content:"";position:absolute;left:-22px;top:32px;
          border:11px solid transparent;border-right-color:var(--ink);
        }
        .tm-landing-v2 .speech::after{left:-18px;border-right-color:var(--card)}
        .tm-landing-v2 .speech .who{display:flex;align-items:center;gap:10px;margin-bottom:14px}
        .tm-landing-v2 .speech .who .av{width:36px;height:36px;border-radius:50%;background:var(--acid);border:2px solid var(--ink);display:inline-flex;align-items:center;justify-content:center;font-size:18px}
        .tm-landing-v2 .speech .who .name{font-weight:900;font-size:14px;color:var(--ink)}
        .tm-landing-v2 .speech .who .role{font-size:11px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:0.05em}
        .tm-landing-v2 .speech p{margin:0 0 12px;font-size:16px;color:var(--ink);font-weight:700;line-height:1.5}
        .tm-landing-v2 .speech p:last-child{margin-bottom:0}
        .tm-landing-v2 .speech-row{display:flex;flex-direction:column;gap:18px;max-width:520px}
        .tm-landing-v2 .speech.right::before,.tm-landing-v2 .speech.right::after{left:auto;right:-22px;border-right-color:transparent;border-left-color:var(--ink)}
        .tm-landing-v2 .speech.right::after{right:-18px;border-left-color:var(--card)}
        .tm-landing-v2 .speech.right{align-self:flex-end}

        .tm-landing-v2 .leaderboard-section{background:var(--bg-soft);border-top:3px solid var(--line);border-bottom:3px solid var(--line)}
        .tm-landing-v2 .lb-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:32px;align-items:start}
        .tm-landing-v2 .lb-card{background:var(--card);border:3px solid var(--ink);border-radius:24px;box-shadow:0 8px 0 var(--ink);overflow:hidden}
        .tm-landing-v2 .lb-head{padding:20px 22px;border-bottom:2px solid var(--line);display:flex;align-items:center;justify-content:space-between}
        .tm-landing-v2 .lb-head h3{margin:0;font-size:20px;font-weight:900;color:var(--ink)}
        .tm-landing-v2 .lb-head .league{display:inline-flex;align-items:center;gap:8px;background:var(--gold);border:2px solid var(--ink);border-radius:10px;padding:4px 10px;font-size:12px;font-weight:900;color:var(--ink)}
        .tm-landing-v2 .lb-row{display:grid;grid-template-columns:32px 1fr auto;align-items:center;gap:12px;padding:12px 22px;border-bottom:1px solid var(--line)}
        .tm-landing-v2 .lb-row:last-child{border-bottom:0}
        .tm-landing-v2 .lb-row.you{background:#FFF8DD}
        .tm-landing-v2 .lb-rank{font-family:'Geist Mono',monospace;font-weight:700;color:var(--muted);font-size:14px;text-align:center}
        .tm-landing-v2 .lb-rank.r1{color:var(--gold-shadow);font-size:18px}
        .tm-landing-v2 .lb-rank.r2{color:#999}
        .tm-landing-v2 .lb-rank.r3{color:#B07440}
        .tm-landing-v2 .lb-name{display:flex;align-items:center;gap:10px;font-weight:800;font-size:14px;color:var(--ink)}
        .tm-landing-v2 .lb-name .av-sm{width:28px;height:28px;border-radius:50%;border:2px solid var(--ink);display:inline-flex;align-items:center;justify-content:center;font-weight:900;color:#fff;font-size:12px}
        .tm-landing-v2 .lb-xp{font-family:'Geist Mono',monospace;font-weight:700;font-size:14px;color:var(--ink)}

        .tm-landing-v2 .streak-card{background:var(--card);border:3px solid var(--ink);border-radius:24px;box-shadow:0 8px 0 var(--ink);padding:24px;text-align:center}
        .tm-landing-v2 .flame{font-size:64px;line-height:1}
        .tm-landing-v2 .streak-card .num{font-family:'Geist Mono',monospace;font-weight:700;font-size:54px;color:#FF6A00;line-height:1;margin:6px 0 0}
        .tm-landing-v2 .streak-card h4{margin:0 0 4px;font-size:14px;font-weight:900;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.06em}
        .tm-landing-v2 .streak-card p{margin:14px 0 0;font-size:14px;font-weight:700;color:var(--ink-soft)}
        .tm-landing-v2 .week-dots{display:flex;justify-content:center;gap:6px;margin-top:18px}
        .tm-landing-v2 .day{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;border:2px solid var(--ink);font-size:11px;font-weight:900;color:var(--ink);background:#fff}
        .tm-landing-v2 .day.done{background:var(--acid);color:#fff;box-shadow:0 2px 0 var(--acid-shadow)}
        .tm-landing-v2 .day.today{background:var(--gold);box-shadow:0 2px 0 var(--gold-shadow)}

        .tm-landing-v2 .pricing-section{background:var(--bg);text-align:center}
        .tm-landing-v2 .pricing-section h2{font-size:clamp(34px,4.8vw,56px);font-weight:900;letter-spacing:-0.02em;margin:0 0 12px;line-height:1;color:var(--ink)}
        .tm-landing-v2 .price-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;margin-top:48px;text-align:left}
        .tm-landing-v2 .price-card{background:var(--card);border:3px solid var(--ink);border-radius:24px;padding:24px;box-shadow:0 8px 0 var(--ink);position:relative}
        .tm-landing-v2 .price-card.featured{transform:translateY(-8px) rotate(-0.6deg);background:#FFF8DD}
        .tm-landing-v2 .price-card.featured .ribbon{position:absolute;top:-16px;right:20px;background:var(--pink);color:#fff;border:3px solid var(--ink);border-radius:10px;padding:4px 12px;font-size:11px;font-weight:900;letter-spacing:0.05em;text-transform:uppercase;box-shadow:0 3px 0 var(--ink)}
        .tm-landing-v2 .price-card h4{margin:0 0 4px;font-size:18px;font-weight:900;color:var(--ink)}
        .tm-landing-v2 .price-card .tag{font-size:13px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:0.06em}
        .tm-landing-v2 .price-card .price{font-family:'Geist Mono',monospace;font-weight:700;font-size:42px;letter-spacing:-0.02em;margin:14px 0 0;color:var(--ink)}
        .tm-landing-v2 .price-card .price small{font-size:13px;color:var(--muted);font-weight:700;font-family:'Nunito'}
        .tm-landing-v2 .price-card ul{list-style:none;padding:0;margin:18px 0 22px;display:flex;flex-direction:column;gap:8px}
        .tm-landing-v2 .price-card li{font-size:14px;font-weight:700;color:var(--ink-soft);display:flex;align-items:center;gap:8px}
        .tm-landing-v2 .price-card li::before{content:"✓";color:var(--acid-deep);font-weight:900;font-size:16px}

        .tm-landing-v2 .final-cta{background:var(--ink);color:#fff;text-align:center}
        .tm-landing-v2 .final-cta h2{font-size:clamp(38px,5.6vw,72px);font-weight:900;letter-spacing:-0.02em;margin:0 0 16px;line-height:0.98;text-wrap:balance;color:#fff}
        .tm-landing-v2 .final-cta h2 span{color:var(--acid)}
        .tm-landing-v2 .final-cta p{color:#B7BAC4;max-width:520px;margin:0 auto 32px;font-size:17px;font-weight:700}

        .tm-landing-v2 footer.tm-footer{background:var(--ink);color:#7F8392;text-align:center;padding:24px 0;font-size:13px;font-weight:700;border-top:1px solid #2A2F3E}

        @media(max-width:900px){
          .tm-landing-v2 .hero-grid{grid-template-columns:1fr}
          .tm-landing-v2 .stage{max-width:340px}
          .tm-landing-v2 .how-grid,.tm-landing-v2 .pop-stats,.tm-landing-v2 .price-grid{grid-template-columns:1fr 1fr}
          .tm-landing-v2 .coach-grid,.tm-landing-v2 .lb-grid{grid-template-columns:1fr}
          .tm-landing-v2 .nav-links{display:none}
        }
        @media(max-width:560px){
          .tm-landing-v2 .how-grid,.tm-landing-v2 .pop-stats,.tm-landing-v2 .price-grid{grid-template-columns:1fr}
        }
      `}</style>

      <nav className="top">
        <div className="container nav-inner">
          <Link to="/" className="brand">
            <svg width="34" height="34" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
              <circle cx="30" cy="32" r="22" fill="#58CC02" stroke="#1B1F2A" strokeWidth="3"/>
              <ellipse cx="22" cy="28" rx="5" ry="6" fill="#fff"/>
              <ellipse cx="38" cy="28" rx="5" ry="6" fill="#fff"/>
              <circle cx="22" cy="29" r="2.5" fill="#1B1F2A"/>
              <circle cx="38" cy="29" r="2.5" fill="#1B1F2A"/>
              <path d="M24 38 Q30 42 36 38" stroke="#1B1F2A" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
              <path d="M16 14 L20 22 M44 14 L40 22" stroke="#1B1F2A" strokeWidth="3" strokeLinecap="round"/>
            </svg>
            TradeMindset
          </Link>
          <div className="nav-links">
            <a className="nav-link" href="#methode">Méthode</a>
            <a className="nav-link" href="#badges">Badges</a>
            <a className="nav-link" href="#coach">Coach</a>
            <a className="nav-link" href="#tarifs">Tarifs</a>
            <span className="nav-streak">🔥 47</span>
            <Link className="btn btn-acid" to="/signup" style={{padding:'10px 20px',fontSize:13}}>JOUER</Link>
          </div>
        </div>
      </nav>

      <section className="hero">
        <div className="container">
          <div className="hero-grid">
            <div>
              <div className="badge-chip"><span className="star">★</span> Nouveau · 150 badges, 7 prestiges</div>
              <h1 className="huge">Deviens un<br/>trader <span className="hl">discipliné</span>.<br/><span style={{color:'var(--ink-soft)',fontWeight:900}}>Cinq minutes par jour.</span></h1>
              <p className="sub">Le journal de trading qui te <em className="tm-em">récompense</em> de respecter tes règles. Apprends à dompter tes émotions comme tu apprends une langue : un peu, tous les jours, et ça finit par rentrer.</p>
              <div className="hero-ctas">
                <Link className="btn btn-acid" to="/signup">Commencer — c'est gratuit</Link>
                <a className="btn btn-white" href="#methode">▶ Voir une leçon</a>
              </div>
              <div className="hero-trust">
                <div className="avatars">
                  <span className="av" style={{background:'var(--pink)'}}>M</span>
                  <span className="av" style={{background:'var(--blue)'}}>R</span>
                  <span className="av" style={{background:'var(--gold)',color:'var(--ink)'}}>I</span>
                  <span className="av" style={{background:'var(--purple)'}}>K</span>
                  <span className="av" style={{background:'var(--acid)'}}>+</span>
                </div>
                <span>12 400 traders en série active cette semaine</span>
              </div>
            </div>

            <div className="stage">
              <div className="ground"></div>
              <div className="floating-card fc-1"><div className="row"><span className="dot"></span><span>Trade journalisé · +12 XP</span></div></div>
              <div className="floating-card fc-2"><span style={{fontSize:18}}>🏆</span><span>Niveau 23</span><span className="xp-num">2 340 XP</span></div>
              <div className="floating-card fc-3"><div className="label">Win rate semaine</div><div className="value">↗ 64,2%</div></div>
              <div className="floating-card fc-4">🔥 47 jours de série</div>

              <svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg" style={{width:'100%',height:'100%',position:'relative',zIndex:2}}>
                <ellipse cx="200" cy="358" rx="100" ry="14" fill="#1B1F2A" opacity="0.12"/>
                <ellipse cx="200" cy="240" rx="120" ry="116" fill="#58CC02" stroke="#1B1F2A" strokeWidth="6"/>
                <ellipse cx="200" cy="270" rx="78" ry="64" fill="#A6E66A"/>
                <path d="M120 142 Q90 100 70 122 Q92 132 110 158 Z" fill="#FFFEF7" stroke="#1B1F2A" strokeWidth="5" strokeLinejoin="round"/>
                <path d="M280 142 Q310 100 330 122 Q308 132 290 158 Z" fill="#FFFEF7" stroke="#1B1F2A" strokeWidth="5" strokeLinejoin="round"/>
                <ellipse cx="200" cy="180" rx="70" ry="18" fill="#9CDF61" opacity="0.6"/>
                <circle cx="160" cy="200" r="30" fill="#fff" stroke="#1B1F2A" strokeWidth="5"/>
                <circle cx="240" cy="200" r="30" fill="#fff" stroke="#1B1F2A" strokeWidth="5"/>
                <circle cx="166" cy="206" r="13" fill="#1B1F2A"/>
                <circle cx="246" cy="206" r="13" fill="#1B1F2A"/>
                <circle cx="170" cy="202" r="4" fill="#fff"/>
                <circle cx="250" cy="202" r="4" fill="#fff"/>
                <ellipse cx="138" cy="240" rx="14" ry="9" fill="#FF9DB1" opacity="0.7"/>
                <ellipse cx="262" cy="240" rx="14" ry="9" fill="#FF9DB1" opacity="0.7"/>
                <ellipse cx="200" cy="248" rx="34" ry="22" fill="#FFCBA4" stroke="#1B1F2A" strokeWidth="5"/>
                <ellipse cx="190" cy="248" rx="3" ry="4" fill="#1B1F2A"/>
                <ellipse cx="210" cy="248" rx="3" ry="4" fill="#1B1F2A"/>
                <path d="M186 262 Q200 274 214 262" stroke="#1B1F2A" strokeWidth="4" fill="none" strokeLinecap="round"/>
                <ellipse cx="106" cy="288" rx="22" ry="34" fill="#58CC02" stroke="#1B1F2A" strokeWidth="5"/>
                <ellipse cx="294" cy="288" rx="22" ry="34" fill="#58CC02" stroke="#1B1F2A" strokeWidth="5"/>
                <rect x="130" y="262" width="140" height="60" rx="10" fill="#fff" stroke="#1B1F2A" strokeWidth="5"/>
                <polyline points="142,308 162,294 184,300 208,278 232,284 258,268" fill="none" stroke="#58CC02" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="258" cy="268" r="5" fill="#58CC02" stroke="#1B1F2A" strokeWidth="3"/>
                <path d="M178 116 L186 100 L192 112 L200 96 L208 112 L214 100 L222 116 Z" fill="#FFC800" stroke="#1B1F2A" strokeWidth="4" strokeLinejoin="round"/>
                <circle cx="186" cy="106" r="2.5" fill="#1B1F2A"/>
                <circle cx="200" cy="100" r="2.5" fill="#1B1F2A"/>
                <circle cx="214" cy="106" r="2.5" fill="#1B1F2A"/>
              </svg>
            </div>
          </div>
        </div>
      </section>

      <section className="tm-section path-section" id="badges">
        <div className="container">
          <div className="path-head">
            <h2>Ton parcours de trader, en leçons</h2>
            <p>Pas de cours magistral. Tu joues, tu loggues, tu apprends. Chaque trade journalisé te rapproche du palier suivant.</p>
          </div>
          <div className="lesson-path">
            <div className="lesson-row"><div style={{display:'flex',flexDirection:'column',alignItems:'center'}}><div className="lesson gold"><span className="crown">★ NIV.4</span>📓</div><div className="lesson-label">Premier journal<small>Terminé · 20 XP</small></div></div></div>
            <div className="lesson-row r-l"><div style={{display:'flex',flexDirection:'column',alignItems:'center'}}><div className="lesson">😎</div><div className="lesson-label">Émotions 1/10<small>Terminé · 35 XP</small></div></div></div>
            <div className="lesson-row r-r"><div style={{display:'flex',flexDirection:'column',alignItems:'center'}}><div className="lesson purple">🎯</div><div className="lesson-label">Plan de trade<small>Terminé · 50 XP</small></div></div></div>
            <div className="lesson-row"><div style={{display:'flex',flexDirection:'column',alignItems:'center'}}><div className="lesson" style={{background:'var(--pink)',boxShadow:'0 7px 0 var(--pink-shadow)'}}>⚡</div><div className="lesson-label" style={{color:'var(--pink-shadow)'}}>EN COURS<small style={{color:'var(--pink)'}}>Discipline · 0/5</small></div></div></div>
            <div className="lesson-row r-l"><div style={{display:'flex',flexDirection:'column',alignItems:'center'}}><div className="lesson locked">🔒</div><div className="lesson-label">Drawdown<small>Verrouillé</small></div></div></div>
            <div className="lesson-row r-r"><div style={{display:'flex',flexDirection:'column',alignItems:'center'}}><div className="lesson locked">🔒</div><div className="lesson-label">Coach IA<small>Niv. 8 requis</small></div></div></div>
          </div>
          <div className="pop-stats">
            <div className="pop-stat"><div className="emoji">🔥</div><div className="num">47</div><div className="lbl">Jours en série</div></div>
            <div className="pop-stat"><div className="emoji">💎</div><div className="num">12 480</div><div className="lbl">XP totale</div></div>
            <div className="pop-stat"><div className="emoji">🏅</div><div className="num">68/150</div><div className="lbl">Badges</div></div>
            <div className="pop-stat"><div className="emoji">⚡</div><div className="num">×1,25</div><div className="lbl">Multiplicateur</div></div>
          </div>
        </div>
      </section>

      <section className="tm-section" id="methode">
        <div className="container">
          <div className="path-head">
            <h2>Comment ça marche</h2>
            <p>Trois habitudes. Trois minutes par jour. Une mascotte qui t'engueule gentiment quand tu loupes ton rituel.</p>
          </div>
          <div className="how-grid">
            <div className="how-card c1 tilt-l">
              <div className="step">ÉTAPE 1</div>
              <div className="icon-box">📓</div>
              <h3>Logue ton trade</h3>
              <p>Choisis ton émotion (😎 confiant, 😤 impatient, 😨 apeuré…), note l'intensité, ajoute deux mots. <em className="tm-em">14 secondes chrono.</em></p>
              <div className="reward">+12 XP par trade</div>
            </div>
            <div className="how-card c2">
              <div className="step">ÉTAPE 2</div>
              <div className="icon-box">🤖</div>
              <h3>Le coach lit tout</h3>
              <p>L'IA croise tes émotions et ta P&amp;L. Tu découvres que tes pires trades sont à 14h47, pris frustré. Tu coupes la session.</p>
              <div className="reward">+50 XP par insight</div>
            </div>
            <div className="how-card c3 tilt-r">
              <div className="step">ÉTAPE 3</div>
              <div className="icon-box">🏆</div>
              <h3>Débloque des badges</h3>
              <p>150 badges, 7 prestiges. Une série de 30 jours = badge légendaire. Une discipline tenue = un multiplicateur d'XP.</p>
              <div className="reward">+1 niveau / 250 XP</div>
            </div>
          </div>
        </div>
      </section>

      <section className="tm-section coach-section" id="coach">
        <div className="container">
          <div className="path-head" style={{marginBottom:32}}>
            <h2>Mindo te parle. Tous les jours.</h2>
            <p>Ta mascotte (un taureau-hibou, ne pose pas de questions) te connaît mieux que toi. Voilà ce qu'il t'a dit cette semaine.</p>
          </div>
          <div className="coach-grid">
            <div className="coach-portrait">
              <svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg" style={{width:'100%',height:'100%'}}>
                <ellipse cx="150" cy="270" rx="80" ry="11" fill="#1B1F2A" opacity="0.15"/>
                <ellipse cx="150" cy="170" rx="100" ry="98" fill="#58CC02" stroke="#1B1F2A" strokeWidth="5"/>
                <path d="M85 100 Q60 60 45 80 Q60 92 75 116 Z" fill="#FFFEF7" stroke="#1B1F2A" strokeWidth="4"/>
                <path d="M215 100 Q240 60 255 80 Q240 92 225 116 Z" fill="#FFFEF7" stroke="#1B1F2A" strokeWidth="4"/>
                <circle cx="120" cy="150" r="24" fill="#fff" stroke="#1B1F2A" strokeWidth="4"/>
                <circle cx="180" cy="150" r="24" fill="#fff" stroke="#1B1F2A" strokeWidth="4"/>
                <circle cx="124" cy="156" r="10" fill="#1B1F2A"/>
                <circle cx="184" cy="156" r="10" fill="#1B1F2A"/>
                <circle cx="127" cy="153" r="3" fill="#fff"/>
                <circle cx="187" cy="153" r="3" fill="#fff"/>
                <ellipse cx="150" cy="194" rx="26" ry="17" fill="#FFCBA4" stroke="#1B1F2A" strokeWidth="4"/>
                <path d="M138 204 Q150 213 162 204" stroke="#1B1F2A" strokeWidth="3" fill="none" strokeLinecap="round"/>
                <ellipse cx="100" cy="180" rx="11" ry="7" fill="#FF9DB1" opacity="0.7"/>
                <ellipse cx="200" cy="180" rx="11" ry="7" fill="#FF9DB1" opacity="0.7"/>
              </svg>
            </div>
            <div className="speech-row">
              <div className="speech">
                <div className="who"><span className="av">😎</span><div><div className="name">Mindo</div><div className="role">Lundi · 9h12</div></div></div>
                <p>Hé, t'as pris <em className="tm-em">3 trades en 12 minutes</em> ce matin. Tu te souviens de la règle ? <em className="tm-em">Max 1 setup par 30 min.</em> Souffle. Bois un café. Reviens dans 18 minutes.</p>
              </div>
              <div className="speech right">
                <div className="who"><span className="av" style={{background:'var(--gold)',color:'var(--ink)'}}>🏆</span><div><div className="name">Mindo</div><div className="role">Mercredi · 17h00</div></div></div>
                <p>SÉRIE DE 47 JOURS DÉBLOQUÉE 🔥 T'es dans le top 8% des traders disciplinés cette saison. <em className="tm-em">Ne casse pas ça pour un revenge trade vendredi soir.</em> Promis ?</p>
              </div>
              <div className="speech">
                <div className="who"><span className="av" style={{background:'var(--pink)'}}>💡</span><div><div className="name">Mindo</div><div className="role">Vendredi · 21h45</div></div></div>
                <p>Insight de la semaine : tes <em className="tm-em">trades "frustrés"</em> ont une espérance de <em className="tm-em">−1,2R</em>. Tes <em className="tm-em">trades "calmes"</em> : <em className="tm-em">+1,4R</em>. Conclusion ? Tu sais déjà.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="tm-section leaderboard-section">
        <div className="container">
          <div className="path-head">
            <h2>Tu joues seul. Mais tu progresses ensemble.</h2>
            <p>Ligues hebdomadaires, classements anonymes par XP, et une série qui te tient en haleine.</p>
          </div>
          <div className="lb-grid">
            <div className="lb-card">
              <div className="lb-head"><h3>Ligue Or — Semaine 17</h3><span className="league">🏆 PROMO ZONE</span></div>
              <div className="lb-row"><span className="lb-rank r1">1</span><span className="lb-name"><span className="av-sm" style={{background:'var(--pink)'}}>Z</span>Zara_FX</span><span className="lb-xp">2 840 XP</span></div>
              <div className="lb-row"><span className="lb-rank r2">2</span><span className="lb-name"><span className="av-sm" style={{background:'var(--blue)'}}>M</span>MaxOnDax</span><span className="lb-xp">2 612 XP</span></div>
              <div className="lb-row"><span className="lb-rank r3">3</span><span className="lb-name"><span className="av-sm" style={{background:'var(--purple)'}}>R</span>RiskRanger</span><span className="lb-xp">2 405 XP</span></div>
              <div className="lb-row you"><span className="lb-rank">4</span><span className="lb-name"><span className="av-sm" style={{background:'var(--acid)'}}>T</span>Toi · niv. 23</span><span className="lb-xp">2 340 XP</span></div>
              <div className="lb-row"><span className="lb-rank">5</span><span className="lb-name"><span className="av-sm" style={{background:'var(--gold)',color:'var(--ink)'}}>K</span>KaribbeanK</span><span className="lb-xp">2 188 XP</span></div>
              <div className="lb-row"><span className="lb-rank">6</span><span className="lb-name"><span className="av-sm" style={{background:'#888'}}>I</span>InesPro</span><span className="lb-xp">2 014 XP</span></div>
            </div>
            <div className="streak-card">
              <div className="flame">🔥</div>
              <div className="num">47</div>
              <h4>jours de série</h4>
              <p>Tu as journalisé tes émotions <em className="tm-em">chaque jour</em> depuis 47 jours. Casse pas ça pour rien.</p>
              <div className="week-dots">
                <div className="day done">L</div>
                <div className="day done">M</div>
                <div className="day done">M</div>
                <div className="day done">J</div>
                <div className="day done">V</div>
                <div className="day today">S</div>
                <div className="day">D</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="tm-section pricing-section" id="tarifs">
        <div className="container">
          <h2>Choisis ton plan</h2>
          <p style={{color:'var(--ink-soft)',maxWidth:520,margin:'0 auto',fontSize:17}}>Gratuit pour toujours. Pro si tu veux le coach et les analyses pointues. Pas de carte bleue avant l'essai.</p>
          <div className="price-grid">
            <div className="price-card">
              <h4>Apprenti</h4>
              <div className="tag">GRATUIT À VIE</div>
              <div className="price">0€<small>/mois</small></div>
              <ul>
                <li>Journal d'émotions illimité</li>
                <li>50 premiers badges</li>
                <li>Stats de base</li>
                <li>1 ligue par mois</li>
              </ul>
              <Link className="btn btn-white" to="/signup" style={{width:'100%'}}>Commencer</Link>
            </div>
            <div className="price-card featured">
              <span className="ribbon">RECOMMANDÉ</span>
              <h4>Pro</h4>
              <div className="tag">7 JOURS GRATUITS</div>
              <div className="price">9€<small>/mois</small></div>
              <ul>
                <li>Tout d'Apprenti</li>
                <li>Coach IA illimité</li>
                <li>150 badges + 7 prestiges</li>
                <li>Insights comportementaux</li>
                <li>Sync brokers (TradingView, MT5)</li>
              </ul>
              <Link className="btn btn-acid" to="/signup" style={{width:'100%'}}>Essayer Pro</Link>
            </div>
            <div className="price-card">
              <h4>Maître</h4>
              <div className="tag">PROP FIRMS</div>
              <div className="price">29€<small>/mois</small></div>
              <ul>
                <li>Tout de Pro</li>
                <li>Multi-comptes prop firm</li>
                <li>Rapports PDF certifiés</li>
                <li>Coach humain 1×/mois</li>
              </ul>
              <Link className="btn btn-gold" to="/signup" style={{width:'100%'}}>Voir la démo</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="tm-section final-cta">
        <div className="container">
          <h2>Prêt à <span>jouer pour de vrai</span> ?</h2>
          <p>Cinq minutes par jour. Une série qui grandit. Une mascotte qui te tient. Et un compte de trading qui s'en porte mieux.</p>
          <Link className="btn btn-acid" to="/signup" style={{fontSize:18,padding:'20px 36px'}}>Commencer ma série — 0€</Link>
          <div style={{marginTop:18,fontSize:13,color:'#7F8392',fontWeight:700}}>Pas de carte. Annule en deux clics. iOS · Android · Web.</div>
        </div>
      </section>

      <footer className="tm-footer">© {new Date().getFullYear()} TradeMindset · Made with 🔥 in Paris</footer>
    </div>
  )
}
