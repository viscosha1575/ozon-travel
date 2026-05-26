import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { bootstrapMiniApp } from './telegram.js'

async function startApp() {
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
