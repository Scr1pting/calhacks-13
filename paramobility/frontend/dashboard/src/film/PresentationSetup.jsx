import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { config, saveConfig } from './liveCall.js'
import { setup } from './presentationSync.js'

// Setting up the presentation before it plays (on the presenter's laptop, not
// the projector): the server's key, the number Leeway calls as the clinic
// (a phone in the room rings when the ride runs late), and whether a real
// phone plays the rider's phone. A real phone is paired by opening the rider
// app from a QR code; once it has, the film leaves its virtual phone out.

const newRider = () => `rider_stage_${Math.random().toString(36).slice(2, 10)}`
const riderAppUrl = () => `${window.location.origin}/rider/index.html`

export default function PresentationSetup({ onClose }) {
  const [saved, setSaved] = useState(config)
  const save = (change) => setSaved(saveConfig(change))
  const [key, setKey] = useState(saved.key)
  const [server, setServer] = useState({ state: saved.key ? 'checking' : 'idle', text: '' })
  const [phone, setPhone] = useState(saved.phone)
  const [pin, setPin] = useState('')
  const [number, setNumber] = useState({ state: 'idle', text: '' })
  const [riderUrl, setRiderUrl] = useState(saved.riderUrl || riderAppUrl())
  const [qr, setQr] = useState('')
  const [seen, setSeen] = useState(false) // the paired phone has opened the app

  // The key: does the server take it?
  useEffect(() => {
    if (!saved.key) return undefined
    let live = true
    setServer({ state: 'checking', text: 'Checking the server…' })
    setup
      .check()
      .then(() => live && setServer({ state: 'ok', text: 'Connected. The presentation drives the server’s ride.' }))
      .catch((e) => live && setServer({ state: 'error', text: `The server says: ${e.message}` }))
    return () => {
      live = false
    }
  }, [saved.key])

  // The clinic's number, as the server sees it.
  useEffect(() => {
    if (!saved.key || !saved.phone) return undefined
    let live = true
    setup
      .approve(saved.phone)
      .then((st) => live && setNumber(st.approved ? { state: 'ok', text: `Leeway will call ${st.phone}.` } : { state: 'error', text: st.reason }))
      .catch((e) => live && setNumber({ state: 'error', text: e.message }))
    return () => {
      live = false
    }
  }, [saved.key, saved.phone])

  async function approveNumber() {
    setNumber({ state: 'checking', text: 'Checking the number…' })
    try {
      const st = await setup.approve(phone.trim(), pin.trim())
      if (!st.approved) return setNumber({ state: 'error', text: st.reason })
      save({ phone: st.phone })
      setPhone(st.phone)
      setPin('')
      setNumber({ state: 'ok', text: `Approved. Leeway will call ${st.phone}.` })
    } catch (e) {
      setNumber({ state: 'error', text: e.message })
    }
  }

  // Pairing: a rider for the phone to become, and the link it opens.
  const pairing = saved.rider && saved.key ? `${riderUrl}?pair=${encodeURIComponent(saved.rider)}#key=${encodeURIComponent(saved.key)}` : ''
  useEffect(() => {
    if (!pairing) return setQr('')
    QRCode.toDataURL(pairing, { margin: 1, width: 220, color: { dark: '#141618', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(''))
    return undefined
  }, [pairing])

  // Until the phone shows up: once its app has started, its rider exists.
  useEffect(() => {
    if (!saved.rider || !saved.key || seen) return undefined
    let live = true
    const look = async () => {
      if (await setup.riderExists(saved.rider)) {
        if (!live) return
        setSeen(true)
        save({ paired: true })
      }
    }
    look()
    const id = setInterval(look, 2000)
    return () => {
      live = false
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.rider, saved.key, seen])

  const startPairing = () => {
    setSeen(false)
    save({ rider: newRider(), paired: false, riderUrl })
  }

  return (
    <section className="card setup" aria-label="Presentation setup">
      <div className="setup-head">
        <div className="eyebrow">Presentation setup</div>
        <button type="button" className="setup-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <h3 className="setup-title">The server</h3>
      <div className="setup-row">
        <input type="password" placeholder="API key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
        <button type="button" className="btn btn-outline" onClick={() => save({ key: key.trim() })}>
          Save
        </button>
      </div>
      <Status {...server} idle="Without a key the presentation plays offline, with a scripted call." />

      <h3 className="setup-title">The clinic’s phone</h3>
      <p className="setup-note">The number Leeway calls as the clinic: a phone in the room rings when the ride runs late.</p>
      <div className="setup-row">
        <input type="tel" placeholder="+1 510 555 0123" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input type="password" placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} className="setup-pin" autoComplete="off" />
        <button type="button" className="btn btn-outline" disabled={!saved.key || !phone.trim()} onClick={approveNumber}>
          Approve
        </button>
      </div>
      <Status {...number} idle={saved.key ? 'New numbers need the server’s PIN (CALL_PIN).' : 'Needs the server.'} />

      <h3 className="setup-title">{saved.rider ? 'Denise’s phone' : 'Denise’s phone: on screen'}</h3>
      {saved.paired && saved.rider ? (
        <>
          <p className="setup-note">
            A real phone plays Denise’s phone (rider <code>{saved.rider}</code>). The film leaves its virtual phone out.
          </p>
          <div className="setup-row">
            <button type="button" className="btn btn-outline" onClick={() => save({ paired: false, rider: '' })}>
              Use the virtual phone
            </button>
            <button type="button" className="btn btn-outline" onClick={startPairing} disabled={!saved.key}>
              Pair another phone
            </button>
          </div>
        </>
      ) : saved.rider && qr ? (
        <>
          <p className="setup-note">
            Scan with the phone. It opens the rider app as Denise; this panel notices when it has. The code carries
            the API key: keep it off the projector.
          </p>
          <img className="setup-qr" src={qr} alt="QR code that pairs a phone" />
          <Status state={seen ? 'ok' : 'checking'} text={seen ? 'Paired.' : 'Waiting for the phone…'} />
          <div className="setup-row">
            <button type="button" className="btn btn-outline" onClick={() => save({ rider: '', paired: false })}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="setup-note">The film shows the rider app on screen. Or pair a real phone to play Denise’s phone.</p>
          <label className="setup-label">
            Rider app address
            <input type="url" value={riderUrl} onChange={(e) => setRiderUrl(e.target.value)} />
          </label>
          <div className="setup-row">
            <button type="button" className="btn btn-outline" onClick={startPairing} disabled={!saved.key}>
              Pair a phone
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function Status({ state, text, idle }) {
  const shown = state === 'idle' ? idle : text
  return shown ? <p className={`setup-status is-${state}`}>{shown}</p> : null
}
