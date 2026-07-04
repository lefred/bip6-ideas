import { createWidget, widget, align, text_style, prop } from '@zos/ui'
import { px } from '@zos/utils'
import { readdirSync } from '@zos/fs'
import { createVoiceFlow } from './voice-flow'

const COLORS = {
  background: 0x101418,
  panel: 0x1f2933,
  primary: 0x24c6a6,
  primaryPressed: 0x1aa087,
  danger: 0xff5a5f,
  dangerPressed: 0xdb4247,
  text: 0xffffff,
  muted: 0xb7c0ca
}

const SCREEN_WIDTH = 390
const SCREEN_HEIGHT = 450

Page({
  state: {
    voiceFlow: null,
    lastLogoTapAt: 0,
    statusText: 'Pret a enregistrer'
  },

  onInit() {
    this.state.voiceFlow = createVoiceFlow({
      setStatus: (text) => this.setStatus(text),
      setRecordingState: (isRecording) => {
        if (isRecording) {
          this.setButton('Arreter', COLORS.danger, COLORS.dangerPressed)
        } else {
          this.setButton('Enregistrer', COLORS.primary, COLORS.primaryPressed)
        }
      }
    })
  },

  build() {
    this.drawBackground()
    this.drawTitle()
    this.drawStatus()
    this.drawRecordButton()
    this.drawLogo()
  },

  onDestroy() {
    if (this.state.voiceFlow) {
      this.state.voiceFlow.destroy()
    }
  },

  drawBackground() {
    createWidget(widget.FILL_RECT, {
      x: 0,
      y: 0,
      w: px(SCREEN_WIDTH),
      h: px(SCREEN_HEIGHT),
      color: COLORS.background
    })
  },

  drawTitle() {
    createWidget(widget.TEXT, {
      x: px(18),
      y: px(72),
      w: px(354),
      h: px(44),
      color: COLORS.text,
      text_size: px(28),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.NONE,
      text: 'Voice Ideas'
    })
  },

  drawStatus() {
    this.statusWidget = createWidget(widget.TEXT, {
      x: px(18),
      y: px(136),
      w: px(354),
      h: px(72),
      color: COLORS.muted,
      text_size: px(18),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.WRAP,
      text: this.state.statusText
    })
  },

  drawRecordButton() {
    this.buttonWidget = createWidget(widget.BUTTON, {
      x: px(36),
      y: px(248),
      w: px(318),
      h: px(76),
      radius: px(8),
      normal_color: COLORS.primary,
      press_color: COLORS.primaryPressed,
      text: 'Enregistrer',
      text_size: px(24),
      color: COLORS.text,
      click_func: () => this.state.voiceFlow.toggleRecording()
    })
  },

  drawLogo() {
    createWidget(widget.BUTTON, {
      x: px(258),
      y: px(402),
      w: px(100),
      h: px(27),
      normal_src: 'images/by_lefred.png',
      press_src: 'images/by_lefred.png',
      click_func: () => this.handleLogoTap()
    })
  },

  handleLogoTap() {
    const now = Date.now()

    if (now - this.state.lastLogoTapAt <= 700) {
      this.state.lastLogoTapAt = 0
      this.showLocalFilesInfo()
      return
    }

    this.state.lastLogoTapAt = now
  },

  showLocalFilesInfo() {
    const localCount = countLocalRecordings()
    this.setStatus(`by lefred <lefred@lefred.be>\nLocal files: ${localCount}`)
  },

  setStatus(text) {
    this.state.statusText = text
    if (this.statusWidget) {
      this.statusWidget.setProperty(prop.TEXT, text)
    }
  },

  setButton(text, normalColor, pressColor) {
    if (!this.buttonWidget) {
      return
    }

    this.buttonWidget.setProperty(prop.TEXT, text)
    this.buttonWidget.setProperty(prop.MORE, {
      normal_color: normalColor,
      press_color: pressColor
    })
  }
})

function countLocalRecordings() {
  try {
    const files = readdirSync({ path: '' }) || []
    let count = 0

    files.forEach((name) => {
      if (typeof name === 'string' && name.indexOf('idea-') === 0 && name.endsWith('.opus')) {
        count += 1
      }
    })

    return count
  } catch (error) {
    console.log('List local recordings failed', error)
    return 0
  }
}
