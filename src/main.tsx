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
            background: '#1C2133',
            color: '#F0F3FF',
            border: '1px solid #2A2F3E',
            borderRadius: '10px',
            fontSize: '14px',
          },
          success: { iconTheme: { primary: '#22C759', secondary: '#0D1117' } },
          error:   { iconTheme: { primary: '#FF3B30', secondary: '#0D1117' } },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
)
