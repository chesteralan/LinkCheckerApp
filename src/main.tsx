import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { StoreProvider } from './hooks/StoreProvider'
import { RunProvider } from './hooks/RunContext'
import { ThemeProvider } from './hooks/ThemeContext'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <RunProvider>
          <StoreProvider>
            <App />
          </StoreProvider>
        </RunProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
