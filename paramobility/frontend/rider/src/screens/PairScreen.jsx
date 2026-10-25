import { useState } from 'react'
import PhoneShell from '../components/PhoneShell.jsx'
import Headline from '../components/Headline.jsx'
import Button from '../components/Button.jsx'
import { claim, pairingError } from '../lib/pairing.js'

// A phone that isn't paired yet: the code from the dashboard's Presentation setup.
export default function PairScreen() {
  const [code, setCode] = useState('')
  const [error, setError] = useState(pairingError)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e?.preventDefault()
    setBusy(true)
    try {
      await claim(code)
      window.location.reload()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="lw-desk">
      <PhoneShell>
        <Headline lead="Pair this phone.">Enter the code shown in the dashboard’s Presentation setup.</Headline>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 }}>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            placeholder="123 456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="Pairing code"
            style={{
              font: 'inherit',
              fontSize: 36,
              letterSpacing: '0.2em',
              textAlign: 'center',
              padding: '14px 12px',
              borderRadius: 16,
              border: '1px solid var(--lw-border, #ddd)',
              background: '#fff',
            }}
          />
          {error && <p style={{ margin: 0, color: 'var(--lw-danger)' }}>{error}</p>}
          <Button variant="primary" onClick={submit} disabled={busy || code.replace(/\D/g, '').length !== 6}>
            {busy ? 'Pairing…' : 'Pair'}
          </Button>
        </form>
      </PhoneShell>
    </div>
  )
}
