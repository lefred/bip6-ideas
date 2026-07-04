#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const serverExample = path.join(root, 'server-example')
const hiddenServerExample = path.join(root, '.server-example.zeus-hidden')

let moved = false

try {
  if (fs.existsSync(serverExample)) {
    if (fs.existsSync(hiddenServerExample)) {
      fs.rmSync(hiddenServerExample, { recursive: true, force: true })
    }

    fs.renameSync(serverExample, hiddenServerExample)
    moved = true
  }

  const result = spawnSync('zeus', ['build'], {
    cwd: root,
    stdio: 'inherit',
    shell: false
  })

  process.exitCode = result.status || 0
} finally {
  if (moved && fs.existsSync(hiddenServerExample)) {
    fs.renameSync(hiddenServerExample, serverExample)
  }
}
