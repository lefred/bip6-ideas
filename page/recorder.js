import { create, id, codec } from '@zos/media'

// Adapter for Zepp OS audio recording.
//
// Official Zepp OS v3+ media API:
//   import { create, id, codec } from '@zos/media'
//   const recorder = create(id.RECORDER)
//   recorder.setFormat(codec.OPUS, { target_file: 'data://record_file.opus' })
//   recorder.start()
//   recorder.stop()
export function createVoiceRecorder() {
  const recorder = create(id.RECORDER)
  let currentFilePath = ''

  return {
    async start(options) {
      // The recorder requires a data:// path. OPUS is the documented codec.
      currentFilePath = toDataFilePath(options.filePath)

      recorder.setFormat(codec.OPUS, {
        target_file: currentFilePath
      })

      recorder.start()

      return { filePath: currentFilePath }
    },

    async stop() {
      recorder.stop()

      return { filePath: currentFilePath }
    }
  }
}

function toDataFilePath(filePath) {
  const normalized = filePath.endsWith('.opus') ? filePath : `${filePath}.opus`

  if (normalized.indexOf('data://') === 0) {
    return normalized
  }

  return `data://${normalized.replace(/^\/+/, '')}`
}
