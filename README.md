# TradeMindset Web

WebApp React calquée sur l'app iOS TradeMindset / Signal Legend.  
Stack : React 18 · TypeScript · Vite · TailwindCSS · Firebase · Recharts · TradingView Charts

---

## 🚀 Démarrage rapide

### 1. Installer les dépendances

```bash
npm install
```

### 2. Configurer Firebase

Copie le fichier d'exemple et remplis les valeurs :

```bash
cp .env.example .env.local
```

Ouvre `.env.local` et colle les valeurs depuis :  
**Firebase Console → Project settings → Your apps → Web app → SDK setup and configuration**

```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=ton-projet.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=ton-projet
VITE_FIREBASE_STORAGE_BUCKET=ton-projet.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

### 3. Activer Google Auth dans Firebase

Firebase Console → Authentication → Sign-in method → Activer **Google** et **Email/Password**

### 4. Lancer en développement

```bash
npm run dev
```

Ouvre [http://localhost:5173](http://localhost:5173)

---

## 📦 Déploiement sur Vercel + trademindset.app

### Étape 1 — Créer un repo GitHub

```bash
git init
git add .
git commit -m "Initial scaffold TradeMindset Web"
git remote add origin https://github.com/TON_COMPTE/trademindset-web.git
git push -u origin main
```

### Étape 2 — Déployer sur Vercel

1. Va sur [vercel.com](https://vercel.com) → **New Project**
2. Importe ton repo GitHub
3. Vercel détecte automatiquement Vite — laisse les paramètres par défaut
4. Va dans **Settings → Environment Variables** et ajoute toutes les variables de `.env.example`
5. Clique **Deploy**

Tu obtiens une URL `trademindset-web.vercel.app` en quelques secondes.

### Étape 3 — Connecter trademindset.app (IONOS)

**Dans Vercel :**
1. Settings → Domains → Add Domain → tape `trademindset.app`
2. Vercel te donne des enregistrements DNS à configurer

**Dans IONOS :**
1. Connecte-toi à IONOS → Domaines → `trademindset.app` → DNS
2. Ajoute les enregistrements que Vercel t'indique :
   - Type **A** → `76.76.21.21` (IP Vercel)
   - Type **CNAME** `www` → `cname.vercel-dns.com`
3. Attends 5–30 minutes pour la propagation DNS

**Dans Firebase Console :**
1. Authentication → Settings → Authorized domains
2. Ajoute `trademindset.app` et `www.trademindset.app`

---

## 🏗️ Architecture

```
src/
├── components/
│   ├── layout/          # AppLayout, AuthLayout, Sidebar, MobileNav
│   └── ui/              # Icons, LoadingScreen, composants réutilisables
├── hooks/
│   └── useAuth.ts       # Hook Firebase Auth
├── pages/
│   ├── auth/            # LoginPage, SignUpPage
│   ├── dashboard/       # DashboardPage (complet)
│   ├── trades/          # TradesPage (squelette)
│   ├── analyse/         # AnalysePage (squelette)
│   ├── journal/         # JournalPage (squelette)
│   ├── alertes/         # AlertesPage (squelette)
│   ├── systemes/        # SystemesPage (squelette)
│   ├── profil/          # ProfilPage
│   └── settings/        # SettingsPage
├── services/
│   └── firebase/        # config.ts, auth.ts, trades.ts
├── store/
│   └── appStore.ts      # Zustand (miroir AppState.swift)
├── types/
│   └── index.ts         # Types TypeScript (miroir CoreModels.swift)
├── utils/
│   └── statistics.ts    # Calculs stats (miroir Statistics.swift)
└── styles/
    └── globals.css      # Design system Tailwind
```

## 🎨 Design System

Calqué sur `DesignSystem.swift` de l'app iOS :

| Token           | Valeur      | Usage                    |
|-----------------|-------------|--------------------------|
| `brand-cyan`    | `#00E5FF`   | Accent principal web     |
| `brand-blue`    | `#0A85FF`   | Primaire iOS             |
| `profit`        | `#22C759`   | Gains                    |
| `loss`          | `#FF3B30`   | Pertes                   |
| `bg-primary`    | `#0D1117`   | Fond principal           |
| `bg-card`       | `#1C2133`   | Cartes                   |
| Font display    | Syne        | Titres                   |
| Font body       | DM Sans     | Corps                    |
| Font mono       | JetBrains Mono | Chiffres PnL          |

## 📋 Pages et statut

| Page        | Statut      | Description                              |
|-------------|-------------|------------------------------------------|
| Dashboard   | ✅ Complet  | Stats · Courbe P&L · Heatmap · Métriques |
| Auth        | ✅ Complet  | Login · Signup · Google OAuth            |
| Trades      | 🔄 Squelette | CRUD trades — à développer              |
| Analyse     | 🔄 Squelette | Photo AI · MTF · VMC — à développer     |
| Journal     | 🔄 Squelette | Émotions — à développer                 |
| Alertes     | 🔄 Squelette | TradingView webhooks — à développer      |
| Systèmes    | 🔄 Squelette | Stratégies — à développer               |
| Profil      | ✅ Basique  | Infos utilisateur                        |
| Paramètres  | 🔄 Squelette | Config Firebase/API — à développer      |

## 🔧 Commandes

```bash
npm run dev      # Développement local (localhost:5173)
npm run build    # Build production → /dist
npm run preview  # Preview du build local
```

---

**Version** : 1.0.0-scaffold  
**Dernière mise à jour** : 2025
