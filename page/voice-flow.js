import { showToast } from '@zos/interaction'
import { queryPermission, requestPermission } from '@zos/app'
import { rmSync } from '@zos/fs'
import { createVoiceRecorder } from './recorder'
import { sendAudioToSideService } from './side-service'

const MIC_PERMISSION = 'device:os.mic'

// Shared recording/upload workflow used by both the full app page and the
// swipe widget. The UI object owns rendering; this module owns the recorder,
// permission, upload and local cleanup sequence.
export function createVoiceFlow(ui) {
  return {
    recorder: null,
    isRecording: false,
    isBusy: false,
    currentFilePath: '',

    async toggleRecording() {
      if (this.isBusy) {
        return
      }

      if (this.isRecording) {
        await this.stopRecording()
      } else {
        await this.startRecording()
      }
    },

    async startRecording() {
      const filePath = `idea-${Date.now()}.opus`

      try {
        this.isBusy = true
        await ensureMicPermission()

        if (!this.recorder) {
          this.recorder = createVoiceRecorder()
        }

        await this.recorder.start({
          filePath,
          format: 'opus'
        })

        this.isRecording = true
        this.currentFilePath = filePath
        ui.setStatus('Enregistrement...')
        ui.setRecordingState(true)
      } catch (error) {
        console.log('startRecording failed', error)
        showToast({ content: 'Micro indisponible' })
        ui.setStatus(formatRecorderError(error))
        ui.setRecordingState(false)
        this.recorder = null
      } finally {
        this.isBusy = false
      }
    },

    async stopRecording() {
      try {
        this.isBusy = true
        const result = await this.recorder.stop()
        const audioPath = result && result.filePath ? result.filePath : this.currentFilePath

        this.isRecording = false
        this.recorder = null
        ui.setRecordingState(false)
        ui.setStatus('Envoi...')

        await sendAudioToSideService(this, {
          filePath: audioPath,
          contentType: 'audio/opus',
          onStatus: (text) => ui.setStatus(text)
        })

        showToast({ content: 'Audio envoye' })
        ui.setStatus('Envoye')
        removeLocalAudio(audioPath)
      } catch (error) {
        console.log('stopRecording or upload failed', error)
        showToast({ content: 'Echec envoi' })
        ui.setStatus(formatRecorderError(error))
        this.isRecording = false
        this.recorder = null
        ui.setRecordingState(false)
      } finally {
        this.isBusy = false
      }
    },

    destroy() {
      if (this.isRecording && this.recorder) {
        safeStopRecorder(this.recorder).catch((error) => {
          console.log('Recorder stop on destroy failed', error)
        })
      }
    }
  }
}

function formatRecorderError(error) {
  const message = error && error.message ? error.message : String(error)

  if (message.length <= 62) {
    return message
  }

  return `${message.slice(0, 59)}...`
}

function safeStopRecorder(recorder) {
  return new Promise((resolve, reject) => {
    try {
      const result = recorder.stop()

      if (result && typeof result.then === 'function') {
        result.then(resolve).catch(reject)
        return
      }

      resolve(result)
    } catch (error) {
      reject(error)
    }
  })
}

function removeLocalAudio(filePath) {
  try {
    const dataPath = filePath && filePath.indexOf('data://') === 0
      ? filePath.replace('data://', '')
      : filePath

    if (dataPath) {
      rmSync({ path: dataPath })
    }
  } catch (error) {
    console.log('Local audio cleanup failed', error)
  }
}

function ensureMicPermission() {
  const result = queryPermission({
    permissions: [MIC_PERMISSION]
  })

  if (result && result[0] === 2) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    requestPermission({
      permissions: [MIC_PERMISSION],
      callback: (permissionsResult) => {
        if (permissionsResult && permissionsResult[0] === 2) {
          resolve()
        } else {
          reject(new Error(`PERMISSION_DENIED: ${MIC_PERMISSION}`))
        }
      }
    })
  })
}
