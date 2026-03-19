import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/globals.css'

const app = <App />

createRoot(document.getElementById('root')!).render(
  <StrictMode>{app}</StrictMode>,
)
