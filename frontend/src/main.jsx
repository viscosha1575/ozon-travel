import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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

async function startApp() {
  warmupAppFonts()

  try {
    await bootstrapMiniApp()
  } catch (error) {
    console.warn('Mini App bootstrap failed before render', error)
  }

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void startApp()
