import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { logDevWarn } from './devLogger.js'
import './index.css'
import App from './App.jsx'
import { bootstrapMiniApp } from './telegram.js'

function warmupAppFonts() {
  if (typeof document === 'undefined' || !document.fonts?.load) {
    return
  }

  void Promise.allSettled([
    document.fonts.load('400 16px "GT Eesti Pro Display"', 'Ozon Travel'),
    document.fonts.load('500 16px "GT Eesti Pro Display"', 'Мои призы'),
    document.fonts.load('700 16px "GT Eesti Pro Display"', 'Скидка 1000 ₽'),
  ])
}

function startApp() {
  warmupAppFonts()

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

  void bootstrapMiniApp().catch((error) => {
    logDevWarn('Mini App bootstrap failed before render', error)
  })
}

void startApp()
