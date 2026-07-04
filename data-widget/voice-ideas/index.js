import { createWidget, widget, align, text_style } from '@zos/ui'
import { push } from '@zos/router'
import { px } from '@zos/utils'

const COLORS = {
  background: 0x101418,
  primary: 0x24c6a6,
  primaryPressed: 0x1aa087,
  text: 0xffffff,
  muted: 0xb7c0ca
}

// Swipe widget used as a stable shortcut to the full app page. Recording from
// the widget itself is avoided because the Bip 6 firmware was unstable when
// starting microphone/upload work directly inside the widget runtime.
DataWidget({
  state: {
    buttonWidget: null
  },

  build() {
    this.drawBackground()
    this.drawTitle()
    this.drawStatus()
    this.drawOpenButton()
    this.drawLogo()
  },

  drawBackground() {
    createWidget(widget.FILL_RECT, {
      x: 0,
      y: 0,
      w: px(390),
      h: px(450),
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
    createWidget(widget.TEXT, {
      x: px(18),
      y: px(136),
      w: px(354),
      h: px(72),
      color: COLORS.muted,
      text_size: px(18),
      align_h: align.CENTER_H,
      align_v: align.CENTER_V,
      text_style: text_style.WRAP,
      text: 'Ouvrir pour enregistrer'
    })
  },

  drawOpenButton() {
    this.state.buttonWidget = createWidget(widget.BUTTON, {
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
      click_func: () => {
        push({
          url: 'page/index'
        })
      }
    })
  },

  drawLogo() {
    createWidget(widget.IMG, {
      x: px(258),
      y: px(402),
      w: px(100),
      h: px(27),
      src: 'images/by_lefred.png'
    })
  }
})
