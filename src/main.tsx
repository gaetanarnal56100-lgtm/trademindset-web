// src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--tm-bg-card)',
            color: 'var(--tm-text-primary)',
            border: '1px solid #2A2F3E',
            borderRadius: '10px',
            fontSize: '14px',
          },
          success: { iconTheme: { primary: 'var(--tm-profit)', secondary: 'var(--tm-bg)' } },
          error:   { iconTheme: { primary: 'var(--tm-loss)', secondary: 'var(--tm-bg)' } },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
)
