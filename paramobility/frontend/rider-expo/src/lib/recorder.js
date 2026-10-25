import { useMemo } from 'react'
import { File, Paths } from 'expo-file-system'
import {
  RecordingPresets,
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio'

// Tap-to-talk recording and Leeway's spoken reply on iOS/Android, with
// expo-audio (recorder.web.js is the browser version, same interface).
// startRecording() asks for the microphone and begins recording; the
// returned stop() resolves with {blob, seconds}, the blob being the finished
// .m4a as an expo-file-system File, which api.sendVoice uploads as is.
//
// Unlike a browser's live WebM stream, the phone writes a complete MP4/AAC
// file, which speech-to-text accepts without re-encoding.

export function useRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)

  return useMemo(
    () => ({
      async startRecording() {
        const { granted } = await requestRecordingPermissionsAsync()
        if (!granted) throw new Error('permission was denied')
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
        await recorder.prepareToRecordAsync()
        recorder.record()
        const startedAt = Date.now()

        return async function stop() {
          await recorder.stop()
          // Back to playback, or iOS keeps routing audio to the earpiece and
          // Leeway's reply is barely audible.
          await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
          return { blob: new File(recorder.uri), seconds: (Date.now() - startedAt) / 1000 }
        }
      },

      // Plays Leeway's spoken reply (MP3 bytes). Returns a function that stops it.
      playAudio(mp3, onEnd) {
        const file = new File(Paths.cache, `leeway-reply-${Date.now()}.mp3`)
        file.create({ overwrite: true })
        file.writeSync(new Uint8Array(mp3))
        const player = createAudioPlayer({ uri: file.uri })
        let finished = false
        const done = () => {
          if (finished) return
          finished = true
          subscription.remove()
          player.remove()
          try {
            file.delete()
          } catch {
            // already gone
          }
          onEnd?.()
        }
        const subscription = player.addListener('playbackStatusUpdate', (status) => {
          if (status.didJustFinish) done()
        })
        player.play()
        return () => {
          player.pause()
          done()
        }
      },
    }),
    [recorder],
  )
}
