import { readFileSync, statSync } from '@zos/fs'

const CHUNK_SIZE = 2048
const SIDE_SERVICE_TIMEOUT_MS = 10000

// Send the recorded file to the phone Side Service in JSON/base64 chunks.
// TransferFile did not trigger onReceivedFile reliably on Bip 6 in preview
// installs, so this uses the MessageBuilder channel that we know is alive.
export async function sendAudioToSideService(pageContext, { filePath, contentType, createdAt, onStatus }) {
  const dataPath = normalizeDataPath(filePath)
  const stat = statSync({ path: dataPath })

  if (!stat || !stat.size) {
    throw new Error(`AUDIO_FILE_NOT_FOUND: ${dataPath}`)
  }

  const content = readFileSync({ path: dataPath })

  if (!content) {
    throw new Error(`AUDIO_FILE_READ_FAILED: ${dataPath}`)
  }

  setStatus(onStatus, 'Envoi au telephone...')

  const uploadId = `audio-${Date.now()}`
  const totalChunks = Math.ceil(stat.size / CHUNK_SIZE)

  await requestSideService({
    method: 'AUDIO_UPLOAD_START',
    params: {
      uploadId,
      fileName: dataPath,
      fileSize: stat.size,
      totalChunks,
      contentType,
      createdAt: createdAt || Date.now()
    }
  })

  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, stat.size)
    const chunk = content.slice(start, end)

    await requestSideService({
      method: 'AUDIO_UPLOAD_CHUNK',
      params: {
        uploadId,
        index,
        totalChunks,
        data: arrayBufferToBase64(chunk)
      }
    })

    setStatus(onStatus, `Telephone ${Math.floor(((index + 1) * 100) / totalChunks)}%`)
  }

  const response = await requestSideService({
    method: 'AUDIO_UPLOAD_FINISH',
    params: {
      uploadId,
      fileName: dataPath,
      fileSize: stat.size,
      totalChunks,
      contentType
    }
  })

  setStatus(onStatus, 'Upload serveur termine')

  return response
}

async function requestSideService(payload) {
  const app = getApp()
  const messageBuilder = app && app._options && app._options.globalData
    ? app._options.globalData.messageBuilder
    : null

  if (!messageBuilder) {
    throw new Error('MESSAGE_BUILDER_UNAVAILABLE')
  }

  const response = await withTimeout(
    messageBuilder.request(payload, {
      timeout: SIDE_SERVICE_TIMEOUT_MS
    }),
    SIDE_SERVICE_TIMEOUT_MS,
    `${payload.method}_TIMEOUT`
  )

  if (!response || response.ok === false) {
    throw new Error(response && response.error ? response.error : `${payload.method}_FAILED`)
  }

  return response
}

function normalizeDataPath(filePath) {
  return filePath && filePath.indexOf('data://') === 0
    ? filePath.replace('data://', '')
    : filePath
}

function arrayBufferToBase64(buffer) {
  return Buffer.from(buffer).toString('base64')
}

function setStatus(onStatus, text) {
  if (typeof onStatus === 'function') {
    onStatus(text)
  }
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) {
        return
      }

      done = true
      reject(new Error(`${label}: ${timeoutMs}ms`))
    }, timeoutMs)

    promise
      .then((result) => {
        if (done) {
          return
        }

        done = true
        clearTimeout(timer)
        resolve(result)
      })
      .catch((error) => {
        if (done) {
          return
        }

        done = true
        clearTimeout(timer)
        reject(error)
      })
  })
}
