import { MessageBuilder } from '../shared/message-side'
import { SERVER_DEBUG_URL, SERVER_UPLOAD_URL, REQUEST_TIMEOUT_MS } from './config'

const messageBuilder = new MessageBuilder()
const receivedAudioFiles = []
const chunkUploads = {}

AppSideService({
  onInit() {
    console.log('Voice Ideas Side Service initialized')
    postDebug('side-service-init')
    messageBuilder.listen(() => {})

    messageBuilder.on('request', (ctx) => {
      const jsonRpc = messageBuilder.buf2Json(ctx.request.payload)

      if (jsonRpc.method === 'UPLOAD_TRANSFERRED_AUDIO') {
        uploadLatestTransferredAudio(jsonRpc.params)
          .then((result) => {
            ctx.response({
              data: {
                ok: true,
                result
              }
            })
          })
          .catch((error) => {
            console.log('Audio upload failed', error)
            ctx.response({
              data: {
                ok: false,
                error: error && error.message ? error.message : 'UPLOAD_FAILED'
              }
            })
          })
      }

      if (jsonRpc.method === 'AUDIO_UPLOAD_START') {
        handleChunkUploadStart(jsonRpc.params)
        ctx.response({
          data: {
            ok: true
          }
        })
      }

      if (jsonRpc.method === 'AUDIO_UPLOAD_CHUNK') {
        handleChunkUploadChunk(jsonRpc.params)
        ctx.response({
          data: {
            ok: true
          }
        })
      }

      if (jsonRpc.method === 'AUDIO_UPLOAD_FINISH') {
        finishChunkUpload(jsonRpc.params)
          .then((result) => {
            ctx.response({
              data: {
                ok: true,
                result
              }
            })
          })
          .catch((error) => {
            ctx.response({
              data: {
                ok: false,
                error: error && error.message ? error.message : 'CHUNK_UPLOAD_FAILED'
              }
            })
          })
      }

      if (jsonRpc.method === 'EXPECT_AUDIO_TRANSFER') {
        console.log('Expecting audio transfer', jsonRpc.params)
        ctx.response({
          data: {
            ok: true,
            expected: true
          }
        })
      }

      if (
        jsonRpc.method !== 'UPLOAD_TRANSFERRED_AUDIO' &&
        jsonRpc.method !== 'EXPECT_AUDIO_TRANSFER' &&
        jsonRpc.method !== 'AUDIO_UPLOAD_START' &&
        jsonRpc.method !== 'AUDIO_UPLOAD_CHUNK' &&
        jsonRpc.method !== 'AUDIO_UPLOAD_FINISH'
      ) {
        ctx.response({
          data: {
            ok: false,
            error: `UNKNOWN_METHOD:${jsonRpc.method}`
          }
        })
      }
    })
  },

  onRun() {
    console.log('Voice Ideas Side Service running')
    postDebug('side-service-run')
  },

  onDestroy() {
    console.log('Voice Ideas Side Service destroyed')
    postDebug('side-service-destroy')
  },

  onReceivedFile(fileHandler) {
    postDebug('received-file-hook', summarizeFileHandler(fileHandler))
    handleReceivedAudioFile(fileHandler)
  },

  onRequest() {}
})

function handleChunkUploadStart(params) {
  const uploadId = params && params.uploadId

  if (!uploadId) {
    throw new Error('MISSING_UPLOAD_ID')
  }

  chunkUploads[uploadId] = {
    ...params,
    chunks: new Array(params.totalChunks || 0),
    received: 0
  }

  postDebug('chunk-upload-start', params)
}

function handleChunkUploadChunk(params) {
  const uploadId = params && params.uploadId
  const session = chunkUploads[uploadId]

  if (!session) {
    throw new Error('UNKNOWN_UPLOAD_ID')
  }

  if (typeof params.index !== 'number' || !params.data) {
    throw new Error('INVALID_CHUNK')
  }

  if (!session.chunks[params.index]) {
    session.received += 1
  }

  session.chunks[params.index] = params.data

  postDebug('chunk-upload-progress', {
    uploadId,
    received: session.received,
    totalChunks: session.totalChunks
  })
}

async function finishChunkUpload(params) {
  const uploadId = params && params.uploadId
  const session = chunkUploads[uploadId]

  if (!session) {
    throw new Error('UNKNOWN_UPLOAD_ID')
  }

  const missing = []
  for (let i = 0; i < session.totalChunks; i += 1) {
    if (!session.chunks[i]) {
      missing.push(i)
    }
  }

  if (missing.length) {
    throw new Error(`MISSING_CHUNKS:${missing.join(',')}`)
  }

  const audioBase64 = Buffer
    .concat(session.chunks.map((chunk) => Buffer.from(chunk, 'base64')))
    .toString('base64')

  postDebug('chunk-upload-finish', {
    uploadId,
    fileName: session.fileName,
    fileSize: session.fileSize,
    totalChunks: session.totalChunks
  })

  delete chunkUploads[uploadId]

  return uploadAudioJson({
    fileName: session.fileName,
    fileSize: session.fileSize,
    contentType: session.contentType || 'audio/opus',
    createdAt: session.createdAt,
    recipientEmail: getRecipientEmail(),
    audioBase64
  })
}

function handleReceivedAudioFile(fileHandler) {
  if (!fileHandler) {
    console.log('onReceivedFile without file handler')
    return
  }

  console.log('Audio file received by Side Service', fileHandler.fileName, fileHandler.filePath)
  postDebug('received-file-handler', summarizeFileHandler(fileHandler))

  fileHandler.on('progress', (event) => {
    const data = event && event.data ? event.data : {}
    console.log('Audio file receive progress', data.loadedSize, data.fileSize)
  })

  fileHandler.on('change', (event) => {
    const readyState = event && event.data ? event.data.readyState : ''

    if (readyState === 'transferred') {
      const params = fileHandler.params || {}
      postDebug('received-file-transferred', {
        ...summarizeFileHandler(fileHandler),
        params
      })

      receivedAudioFiles.push({
        filePath: fileHandler.filePath,
        fileName: fileHandler.fileName,
        contentType: params.contentType || 'audio/opus',
        createdAt: params.createdAt,
        originalPath: params.originalPath
      })

      console.log('Queued transferred audio for upload', fileHandler.filePath)

      uploadAudio({
        filePath: fileHandler.filePath,
        contentType: params.contentType || 'audio/opus',
        createdAt: params.createdAt,
        originalPath: params.originalPath
      }).catch((error) => {
        console.log('Transferred audio upload failed', error)
        postDebug('upload-failed', {
          error: error && error.message ? error.message : String(error),
          file: summarizeFileHandler(fileHandler)
        })
      })
    }

    if (readyState === 'error' || readyState === 'canceled') {
      console.log('Audio file receive failed', readyState)
      postDebug('received-file-failed', {
        readyState,
        file: summarizeFileHandler(fileHandler)
      })
    }
  })
}

async function uploadLatestTransferredAudio(params) {
  const audioFile = await waitForReceivedAudio(params && params.originalPath)

  if (!audioFile) {
    throw new Error('NO_RECEIVED_AUDIO_FILE')
  }

  return uploadAudio({
    filePath: audioFile.filePath,
    contentType: audioFile.contentType || params.contentType || 'audio/opus',
    createdAt: audioFile.createdAt || params.createdAt,
    originalPath: audioFile.originalPath || params.originalPath
  })
}

function waitForReceivedAudio(originalPath) {
  const startedAt = Date.now()

  return new Promise((resolve) => {
    const poll = () => {
      const index = findReceivedAudioIndex(originalPath)

      if (index >= 0) {
        const audioFile = receivedAudioFiles.splice(index, 1)[0]
        resolve(audioFile)
        return
      }

      if (Date.now() - startedAt > 5000) {
        resolve(null)
        return
      }

      setTimeout(poll, 500)
    }

    poll()
  })
}

function findReceivedAudioIndex(originalPath) {
  if (!receivedAudioFiles.length) {
    return -1
  }

  if (!originalPath) {
    return 0
  }

  const exactIndex = receivedAudioFiles.findIndex((file) => file.originalPath === originalPath)
  return exactIndex >= 0 ? exactIndex : 0
}

async function uploadAudio({ filePath, contentType, createdAt, originalPath }) {
  if (!filePath) {
    throw new Error('MISSING_FILE_PATH')
  }

  postDebug('upload-start', {
    filePath,
    contentType,
    createdAt,
    originalPath
  })

  const form = new FormData()

  form.append('audio', {
    uri: filePath,
    name: getFileName(filePath) || getFileName(originalPath) || 'voice-idea.opus',
    type: contentType || 'audio/opus'
  })
  form.append('createdAt', String(createdAt || Date.now()))
  form.append('sourcePath', originalPath || '')
  form.append('recipientEmail', getRecipientEmail())

  // Zepp Side Service fetch uses an object argument: { url, method, headers, body }.
  // Timeout support is SDK-dependent; REQUEST_TIMEOUT_MS is kept in config for the
  // official timeout option if your SDK exposes one.
  const response = await fetch({
    url: getServerUploadUrl(),
    method: 'POST',
    body: form
  })

  const status = response.status || response.statusCode || 200
  if (status < 200 || status >= 300) {
    postDebug('upload-http-error', {
      status,
      body: response.body
    })
    throw new Error(`HTTP_${status}`)
  }

  postDebug('upload-success', {
    status,
    body: response.body
  })

  if (typeof response.body === 'string') {
    try {
      return JSON.parse(response.body)
    } catch (error) {
      return { status, body: response.body }
    }
  }

  return response.body || { status }
}

async function uploadAudioJson({ fileName, fileSize, contentType, createdAt, recipientEmail, audioBase64 }) {
  postDebug('upload-json-start', {
    fileName,
    fileSize,
    contentType,
    createdAt,
    recipientEmail,
    base64Length: audioBase64 ? audioBase64.length : 0
  })

  const response = await fetch({
    url: getServerUploadUrl(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fileName,
      fileSize,
      contentType,
      createdAt,
      recipientEmail,
      audioBase64
    })
  })

  const status = response.status || response.statusCode || 200
  if (status < 200 || status >= 300) {
    postDebug('upload-json-http-error', {
      status,
      body: response.body
    })
    throw new Error(`HTTP_${status}`)
  }

  postDebug('upload-json-success', {
    status,
    body: response.body
  })

  if (typeof response.body === 'string') {
    try {
      return JSON.parse(response.body)
    } catch (error) {
      return { status, body: response.body }
    }
  }

  return response.body || { status }
}

function getFileName(filePath) {
  if (!filePath) {
    return ''
  }

  return filePath.split('/').pop() || filePath.replace('data://', '')
}

function summarizeFileHandler(fileHandler) {
  if (!fileHandler) {
    return { empty: true }
  }

  return {
    fileName: fileHandler.fileName || '',
    filePath: fileHandler.filePath || '',
    params: fileHandler.params || null
  }
}

function postDebug(event, payload = {}) {
  fetch({
    url: getServerDebugUrl(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      event,
      payload,
      time: Date.now()
    })
  }).catch((error) => {
    console.log('Debug POST failed', event, error)
  })
}

function getServerUploadUrl() {
  return getSettingValue('serverUploadUrl', SERVER_UPLOAD_URL)
}

function getServerDebugUrl() {
  return getSettingValue('serverDebugUrl', SERVER_DEBUG_URL)
}

function getRecipientEmail() {
  return getSettingValue('recipientEmail', '')
}

function getSettingValue(key, fallback) {
  try {
    if (
      typeof settings !== 'undefined' &&
      settings.settingsStorage &&
      typeof settings.settingsStorage.getItem === 'function'
    ) {
      const value = settings.settingsStorage.getItem(key)
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }
  } catch (error) {
    console.log('Read setting failed', key, error)
  }

  return fallback
}
