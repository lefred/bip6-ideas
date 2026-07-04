const DEFAULT_SERVER_UPLOAD_URL = 'https://ideas.lefred.be/api/voice-ideas'
const DEFAULT_SERVER_DEBUG_URL = 'https://ideas.lefred.be/api/voice-ideas/debug'
const DEFAULT_RECIPIENT_EMAIL = ''

AppSettingsPage({
  state: {
    props: null,
    serverUploadUrl: DEFAULT_SERVER_UPLOAD_URL,
    serverDebugUrl: DEFAULT_SERVER_DEBUG_URL,
    recipientEmail: DEFAULT_RECIPIENT_EMAIL
  },

  build(props) {
    this.state.props = props
    this.state.serverUploadUrl = getStoredValue(props, 'serverUploadUrl', DEFAULT_SERVER_UPLOAD_URL)
    this.state.serverDebugUrl = getStoredValue(props, 'serverDebugUrl', DEFAULT_SERVER_DEBUG_URL)
    this.state.recipientEmail = getStoredValue(props, 'recipientEmail', DEFAULT_RECIPIENT_EMAIL)

    return View(
      {
        style: {
          padding: '16px 20px',
          color: '#111'
        }
      },
      [
        View(
          {
            style: {
              marginBottom: '14px'
            }
          },
          [
            TextInput({
              label: 'Server upload URL',
              value: this.state.serverUploadUrl,
              maxLength: 300,
              onChange: (value) => {
                this.setSetting('serverUploadUrl', value, DEFAULT_SERVER_UPLOAD_URL)
              }
            })
          ]
        ),
        View(
          {
            style: {
              marginBottom: '14px'
            }
          },
          [
            TextInput({
              label: 'Debug URL',
              value: this.state.serverDebugUrl,
              maxLength: 300,
              onChange: (value) => {
                this.setSetting('serverDebugUrl', value, DEFAULT_SERVER_DEBUG_URL)
              }
            })
          ]
        ),
        View(
          {
            style: {
              marginBottom: '14px'
            }
          },
          [
            TextInput({
              label: 'Recipient email',
              value: this.state.recipientEmail,
              maxLength: 200,
              onChange: (value) => {
                this.setSetting('recipientEmail', value, DEFAULT_RECIPIENT_EMAIL)
              }
            })
          ]
        ),
        Button({
          label: 'Reset defaults',
          style: {
            fontSize: '14px',
            borderRadius: '24px',
            background: '#24c6a6',
            color: 'white',
            padding: '8px 16px'
          },
          onClick: () => {
            this.setSetting('serverUploadUrl', DEFAULT_SERVER_UPLOAD_URL, DEFAULT_SERVER_UPLOAD_URL)
            this.setSetting('serverDebugUrl', DEFAULT_SERVER_DEBUG_URL, DEFAULT_SERVER_DEBUG_URL)
            this.setSetting('recipientEmail', DEFAULT_RECIPIENT_EMAIL, DEFAULT_RECIPIENT_EMAIL)
          }
        })
      ]
    )
  },

  setSetting(key, value, fallback) {
    const normalized = normalizeUrl(value, fallback)
    this.state.props.settingsStorage.setItem(key, normalized)
  }
})

function getStoredValue(props, key, fallback) {
  const value = props.settingsStorage.getItem(key)
  return normalizeUrl(value, fallback)
}

function normalizeUrl(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
}
