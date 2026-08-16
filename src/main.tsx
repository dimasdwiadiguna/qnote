import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Elemen #root tidak ditemukan')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// `registerType: 'autoUpdate'` — service worker memperbarui dirinya sendiri.
// Header cache untuk sw.js & manifest sengaja no-cache (lihat vercel.json),
// kalau tidak app akan macet di versi lama dan update tidak pernah sampai.
registerSW({ immediate: true })
