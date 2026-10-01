// Erzeugt build/icon.png für den Installer. Aufruf: npm run icon
// Das Zeichen ist aus Flächen gebaut statt aus einer Schrift, damit es überall gleich aussieht.
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const SIZE = 512

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="56" fill="#141311"/>
  <rect x="20" y="20" width="472" height="472" rx="40" fill="none" stroke="#33302a" stroke-width="4"/>
  <g fill="#ece8df">
    <rect x="150" y="112" width="52" height="244"/>
    <polygon points="202,236 300,112 366,112 202,318"/>
    <polygon points="214,262 262,224 380,356 314,356"/>
  </g>
  <rect x="150" y="388" width="228" height="14" fill="#cfa858"/>
</svg>`

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  })
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((resolve) => setTimeout(resolve, 300))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })

  const dir = join(__dirname, '..', 'build')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'icon.png'), image.resize({ width: SIZE, height: SIZE }).toPNG())
  console.log('build/icon.png geschrieben')
  app.quit()
})
