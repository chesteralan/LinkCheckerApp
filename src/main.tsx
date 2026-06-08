import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { StoreProvider } from './hooks/StoreProvider'
import { RunProvider } from './hooks/RunContext'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <RunProvider>
        <StoreProvider>
          <App />
        </StoreProvider>
      </RunProvider>
    </BrowserRouter>
  </StrictMode>,
)
