import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import PairScreen from './screens/PairScreen.jsx'
import { needsPairing, pairing } from './lib/pairing.js'
import './tokens.css'
import './index.css'

// A pairing code in the address is traded for this phone's rider and key first;
// a phone with no key asks for a code instead of failing to connect.
pairing.then(() =>
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>{needsPairing() ? <PairScreen /> : <App />}</React.StrictMode>,
  ),
)
