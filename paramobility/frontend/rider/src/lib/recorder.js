// Tap-to-talk recording. start() asks for the microphone and begins
// recording; the returned stop() resolves with the recording as a 16 kHz mono
// WAV Blob.
//
// Browsers record WebM/Opus (Chrome, Firefox) or MP4 (Safari) as a live
// stream, without the index a finished file has, and speech-to-text services
// can reject that. So the recording is decoded and re-encoded as plain WAV,
// which every service accepts.

const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
const RATE = 16000

export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  })
  const mimeType = TYPES.find((t) => window.MediaRecorder?.isTypeSupported(t))
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks = []
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const startedAt = Date.now()
  recorder.start()

  return function stop() {
    return new Promise((resolve, reject) => {
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const seconds = (Date.now() - startedAt) / 1000
        try {
          const raw = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
          resolve({ blob: seconds < 0.4 ? raw : await toWav(raw), seconds })
        } catch (e) {
          reject(new Error(`couldn't read the recording (${e.message})`))
        }
      }
      recorder.stop()
    })
  }
}

// Decode any recording the browser made, mix to mono, resample to 16 kHz and
// wrap it as 16-bit PCM WAV.
async function toWav(blob) {
  const decoder = new AudioContext()
  let audio
  try {
    audio = await decoder.decodeAudioData(await blob.arrayBuffer())
  } finally {
    decoder.close()
  }
  const frames = Math.max(1, Math.ceil(audio.duration * RATE))
  const offline = new OfflineAudioContext(1, frames, RATE)
  const source = offline.createBufferSource()
  source.buffer = audio
  source.connect(offline.destination) // multi-channel input is mixed down to mono
  source.start()
  const pcm = (await offline.startRendering()).getChannelData(0)

  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2))
  const text = (at, s) => [...s].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  out.setUint32(4, 36 + pcm.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  out.setUint32(16, 16, true) // fmt chunk size
  out.setUint16(20, 1, true) // PCM
  out.setUint16(22, 1, true) // mono
  out.setUint32(24, RATE, true)
  out.setUint32(28, RATE * 2, true) // byte rate
  out.setUint16(32, 2, true) // block align
  out.setUint16(34, 16, true) // bits per sample
  text(36, 'data')
  out.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i += 1) {
    const v = Math.max(-1, Math.min(1, pcm[i]))
    out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }
  return new Blob([out], { type: 'audio/wav' })
}

// Plays Leeway's spoken reply. Returns a function that stops it.
export function playAudio(blob, onEnd) {
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  const done = () => {
    URL.revokeObjectURL(url)
    onEnd?.()
  }
  audio.onended = done
  audio.onerror = done
  audio.play().catch(done)
  return () => {
    audio.pause()
    done()
  }
}
