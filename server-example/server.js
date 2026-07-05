const express = require('express')
const { execFile } = require('child_process')
const fs = require('fs')
const multer = require('multer')
const nodemailer = require('nodemailer')
const path = require('path')
const { convertZeppOpusToOgg } = require('./zepp-opus')

const app = express()
const port = process.env.PORT || 3000
const uploadDir = process.env.VOICE_IDEAS_UPLOAD_DIR || path.join(__dirname, 'uploads')
const ffmpegBin = process.env.FFMPEG_BIN || 'ffmpeg'
const whisperBin = process.env.WHISPER_CPP_BIN || 'whisper-cli'
const whisperModel = process.env.WHISPER_CPP_MODEL || ''
const whisperLanguage = process.env.WHISPER_CPP_LANGUAGE || 'fr'

app.use(express.json({ limit: '25mb' }))
fs.mkdirSync(uploadDir, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, callback) => {
      const safeName = file.originalname || 'voice-idea.opus'
      callback(null, `${Date.now()}-${safeName}`)
    }
  }),
  limits: {
    fileSize: 20 * 1024 * 1024
  }
})

app.post('/api/voice-ideas', upload.single('audio'), (req, res) => {
  console.log('body:', req.body)
  console.log('file:', req.file)

  if (req.body && req.body.audioBase64) {
    const safeName = safeBasename(req.body.fileName || 'voice-idea.opus')
    const receivedAt = Number(req.body.createdAt) || Date.now()
    const fileName = `${receivedAt}-${safeName}`
    const filePath = path.join(uploadDir, fileName)
    const audioBuffer = Buffer.from(req.body.audioBase64, 'base64')

    fs.writeFileSync(filePath, audioBuffer)
    processVoiceIdea({
      rawPath: filePath,
      rawFileName: fileName,
      createdAt: receivedAt,
      recipientEmail: normalizeEmail(req.body.recipientEmail),
      declaredSize: req.body.fileSize || null,
      mode: 'json-base64'
    }).catch((error) => {
      console.error('voice idea background processing failed:', error)
    })

    return res.json({
      ok: true,
      mode: 'json-base64',
      file: fileName,
      processing: true,
      size: audioBuffer.length,
      declaredSize: req.body.fileSize || null,
      createdAt: req.body.createdAt || null
    })
  }

  if (!req.file) {
    return res.status(400).json({
      ok: false,
      error: 'MISSING_AUDIO',
      body: req.body || {}
    })
  }

  processVoiceIdea({
    rawPath: req.file.path,
    rawFileName: req.file.filename,
    createdAt: Number(req.body.createdAt) || Date.now(),
    recipientEmail: normalizeEmail(req.body.recipientEmail),
    declaredSize: req.file.size,
    mode: 'multipart'
  }).catch((error) => {
    console.error('voice idea background processing failed:', error)
  })

  res.json({
    ok: true,
    file: req.file.filename,
    processing: true,
    size: req.file.size,
    createdAt: req.body.createdAt || null,
    sourcePath: req.body.sourcePath || null
  })
})

app.post('/api/voice-ideas/debug', (req, res) => {
  console.log('debug:', req.body)
  res.json({ ok: true })
})

app.listen(port, () => {
  console.log(`Voice Ideas server listening on port ${port}`)
})

async function processVoiceIdea({ rawPath, rawFileName, createdAt, recipientEmail, declaredSize, mode }) {
  const oggFileName = `${formatTimestampUtc(createdAt)}-idea.ogg`
  const oggPath = path.join(uploadDir, oggFileName)

  console.log('processing voice idea:', {
    rawFileName,
    oggFileName,
    createdAt,
    recipientEmail,
    declaredSize,
    mode
  })

  const conversion = convertZeppOpusToOgg(rawPath, oggPath)
  console.log('ogg generated:', conversion)

  const textPath = path.join(uploadDir, `${formatTimestampUtc(createdAt)}-idea.txt`)
  const transcript = await transcribeAudio(oggPath, textPath)
  console.log('transcription saved:', { textPath, length: transcript.length })

  await sendTranscriptionEmail({
    transcript,
    rawFileName,
    oggFileName,
    createdAt,
    recipientEmail,
    textPath,
    oggPath
  })

  console.log('transcription email sent:', { rawFileName, oggFileName })

  cleanupProcessedFiles({
    rawPath,
    oggPath,
    wavPath: oggPath.replace(/\.ogg$/i, '.wav'),
    textPath
  })
}

async function transcribeAudio(oggPath, textPath) {
  if (!whisperModel) {
    throw new Error('WHISPER_CPP_MODEL is not set')
  }

  const wavPath = oggPath.replace(/\.ogg$/i, '.wav')
  const transcriptBasePath = textPath.replace(/\.txt$/i, '')

  await runCommand(ffmpegBin, [
    '-y',
    '-i',
    oggPath,
    '-ar',
    '16000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    wavPath
  ])

  await runCommand(whisperBin, [
    '-m',
    whisperModel,
    '-f',
    wavPath,
    '-l',
    whisperLanguage,
    '-otxt',
    '-of',
    transcriptBasePath
  ])

  if (!fs.existsSync(textPath)) {
    throw new Error(`Whisper did not create transcript file: ${textPath}`)
  }

  return fs.readFileSync(textPath, 'utf8').trim()
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      timeout: Number(process.env.WHISPER_CPP_TIMEOUT_MS || 120000),
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${error.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`
        reject(error)
        return
      }

      resolve({ stdout, stderr })
    })
  })
}

async function sendTranscriptionEmail({ transcript, rawFileName, oggFileName, createdAt, recipientEmail, oggPath }) {
  const required = ['SMTP_HOST', 'SMTP_FROM']
  const missing = required.filter((name) => !process.env[name])

  if (missing.length) {
    throw new Error(`Missing mail configuration: ${missing.join(', ')}`)
  }

  const mailTo = recipientEmail || normalizeEmail(process.env.MAIL_TO)
  if (!mailTo) {
    throw new Error('Missing recipient email: set Recipient email in Zepp settings or MAIL_TO on the server')
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS || ''
        }
      : undefined
  })

  const recordedAt = new Date(createdAt).toISOString()

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: mailTo,
    subject: `Voice Ideas - ${formatTimestampUtc(createdAt)}`,
    text: [
      'Nouvelle idee vocale recue.',
      '',
      `Date UTC: ${recordedAt}`,
      `Destinataire: ${mailTo}`,
      `Fichier brut: ${rawFileName}`,
      `Fichier Ogg: ${oggFileName}`,
      '',
      'Transcription:',
      transcript || '(transcription vide)'
    ].join('\n'),
    attachments: [
      {
        filename: oggFileName,
        path: oggPath,
        contentType: 'audio/ogg'
      }
    ]
  })
}

function formatTimestampUtc(timestampMs) {
  const date = new Date(timestampMs)
  const pad = (value) => String(value).padStart(2, '0')

  return [
    date.getUTCFullYear(),
    '-',
    pad(date.getUTCMonth() + 1),
    '-',
    pad(date.getUTCDate()),
    '_',
    pad(date.getUTCHours()),
    '-',
    pad(date.getUTCMinutes()),
    '-',
    pad(date.getUTCSeconds())
  ].join('')
}

function safeBasename(fileName) {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_')
}

function cleanupProcessedFiles({ rawPath, oggPath, wavPath, textPath }) {
  if (process.env.VOICE_IDEAS_KEEP_FILES === 'true') {
    console.log('Keeping processed files because VOICE_IDEAS_KEEP_FILES=true')
    return
  }

  ;[rawPath, oggPath, wavPath, textPath].forEach((filePath) => {
    if (!filePath) {
      return
    }

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        console.log('deleted processed file:', filePath)
      }
    } catch (error) {
      console.log('failed to delete processed file:', filePath, error)
    }
  })
}

function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim() : ''

  if (!email) {
    return ''
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.log('Ignoring invalid recipient email:', email)
    return ''
  }

  return email
}
