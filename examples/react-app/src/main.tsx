import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { SkewProvider } from '@skewforge/react'
import { App } from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SkewProvider options={{ onMandatory: 'reload' }}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </SkewProvider>
  </StrictMode>,
)
