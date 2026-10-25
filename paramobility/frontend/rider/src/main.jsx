import './lib/pairing.js' // first: a pairing link sets who this phone is before the app starts
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './tokens.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
