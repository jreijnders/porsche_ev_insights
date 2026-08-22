import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { I18nProvider } from './i18n'
import App from './App.jsx'
import LedgerPage from './ledger/LedgerPage.tsx'

// The ledger lives at /trips, deliberately outside App's tab machinery: the
// existing tabs require CSV-derived data in localStorage, while the ledger
// reads Postgres. Keeping them apart means the prototype cannot break the
// dashboard. Revisit when the tabs are repointed at Postgres (#9, staged).
const isLedger = window.location.pathname.startsWith('/trips')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      {isLedger ? <LedgerPage /> : <App />}
    </I18nProvider>
  </StrictMode>,
)
