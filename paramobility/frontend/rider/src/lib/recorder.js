// Hold-to-talk recording. start() asks for the microphone and begins
// recording; the returned stop() resolves with the recording as a Blob
// (webm/opus in Chrome and Firefox, mp4 in Safari).

const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

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
    return new Promise((resolve) => {
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        resolve({
          blob: new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }),
          seconds: (Date.now() - startedAt) / 1000,
        })
      }
      recorder.stop()
    })
  }
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
