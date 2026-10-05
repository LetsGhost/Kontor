import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { AppInfo, LoadResult } from '../shared/api'
import type { CollectionName } from '../shared/schemas'
import { attachmentPath, pruneAttachments, saveAttachment } from './storage/attachments'
import { createBackup, ensureDailyBackup, listBackups, restoreBackup } from './storage/backup'
import { StorageError } from './storage/files'
import { Store } from './storage/store'

const isDev = !app.isPackaged

// Entwicklung und echte Nutzung bekommen getrennte Ordner, damit Dev-Läufe nie echte Daten anfassen.
app.setPath('userData', join(app.getPath('appData'), isDev ? 'Kontor-dev' : 'Kontor'))

const store = new Store(join(app.getPath('userData'), 'data'))

// Ohne eigene App-ID zeigt Windows keine Benachrichtigungen an oder ordnet sie Electron zu.
app.setAppUserModelId(isDev ? 'de.kontor.app.dev' : 'de.kontor.app')

// Mit Windows gestartet: Kontor prüft nur auf Erinnerungen und zeigt kein Fenster, bis man eine anklickt.
const AUTOSTART_ARG = '--autostart'
// Unter diesem Namen steht der Eintrag in HKCU\...\Run; der Uninstaller (installer/uninstall.nsh) entfernt ihn.
const LOGIN_ITEM_NAME = 'Kontor'
const background = process.argv.includes(AUTOSTART_ARG)
// So lange lassen sich die Benachrichtigungen anklicken, danach beendet sich der Hintergrundstart.
const BACKGROUND_LINGER_MS = 10 * 60 * 1000
let shown = false
let lingerTimer: NodeJS.Timeout | undefined

const loginItemQuery = { args: [AUTOSTART_ARG] }

// openAtLogin bleibt unter Windows false, weil Electron die Argumente des Eintrags nicht zurückliest.
// executableWillLaunchAtLogin stimmt und beachtet auch, ob der Eintrag im Task-Manager deaktiviert wurde.
function autostartEnabled(): boolean {
  return !isDev && app.getLoginItemSettings(loginItemQuery).executableWillLaunchAtLogin
}

function setAutostart(enabled: boolean): void {
  // Im Entwicklungsmodus würde das nackte Electron eingetragen, nicht Kontor.
  if (isDev) throw new Error('Autostart gibt es nur in der installierten App')
  app.setLoginItemSettings({ openAtLogin: enabled, name: LOGIN_ITEM_NAME, args: [AUTOSTART_ARG] })
}

/** Zeigt das Fenster. Ab dann ist es ein ganz normaler Start und beendet sich nicht mehr von selbst. */
function showWindow(): void {
  const win = mainWindow()
  if (!win) return
  shown = true
  clearTimeout(lingerTimer)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/**
 * Der Hintergrundstart hat seine Erinnerungen gezeigt. Gab es keine, ist er fertig. Sonst wartet er eine Weile,
 * damit ein Klick auf die Benachrichtigung das Fenster öffnen kann.
 */
function backgroundDone(notified: number): void {
  if (!background || shown) return
  if (notified === 0) app.quit()
  else lingerTimer = setTimeout(() => app.quit(), BACKGROUND_LINGER_MS)
}

const EXPORT_FILTERS: Record<string, Electron.FileFilter> = {
  '.csv': { name: 'CSV (Excel, Semikolon)', extensions: ['csv'] },
  '.xlsx': { name: 'Excel-Arbeitsmappe', extensions: ['xlsx'] }
}

function mainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0]
}

function load(): LoadResult {
  try {
    store.init()
    return { ok: true, data: store.load() }
  } catch (err) {
    if (err instanceof StorageError) {
      return { ok: false, error: { file: err.file, message: err.message } }
    }
    throw err
  }
}

function registerIpc(): void {
  ipcMain.handle(
    'info',
    (): AppInfo => ({ isDev, dataDir: store.dataDir, version: app.getVersion(), background: background && !shown })
  )
  ipcMain.handle('load', () => load())
  ipcMain.handle('save', (_e, collection: CollectionName, data: unknown) => store.save(collection, data))
  ipcMain.handle('saveTransactions', (_e, year: number, data: unknown) =>
    store.saveTransactions(year, data)
  )
  ipcMain.handle('listBackups', () => listBackups(store.dataDir))
  ipcMain.handle('createBackup', () => {
    createBackup(store.dataDir, { label: 'manuell' })
  })
  ipcMain.handle('restoreBackup', (_e, name: string) => restoreBackup(store.dataDir, name))
  ipcMain.handle('openDataFolder', async () => {
    await shell.openPath(store.dataDir)
  })
  ipcMain.handle('addAttachment', (_e, bytes: Uint8Array, type: string) =>
    saveAttachment(store.dataDir, bytes, type)
  )
  ipcMain.handle('readAttachment', (_e, name: string) => readFileSync(attachmentPath(store.dataDir, name)))
  ipcMain.handle('openAttachment', async (_e, name: string) => {
    const error = await shell.openPath(attachmentPath(store.dataDir, name))
    if (error) throw new Error(error)
  })
  ipcMain.handle('saveExport', async (_e, defaultName: string, bytes: Uint8Array) => {
    const filter = EXPORT_FILTERS[extname(defaultName)]
    if (!filter) throw new Error(`Unbekanntes Exportformat: ${defaultName}`)
    const win = mainWindow()
    const options = { defaultPath: join(app.getPath('documents'), defaultName), filters: [filter] }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, bytes)
    return result.filePath
  })
  ipcMain.handle('focusWindow', () => showWindow())
  ipcMain.handle('backgroundDone', (_e, notified: number) => backgroundDone(notified))
  ipcMain.handle('getAutostart', () => ({ available: !isDev, enabled: autostartEnabled() }))
  ipcMain.handle('setAutostart', (_e, enabled: boolean) => {
    setAutostart(enabled)
    return autostartEnabled()
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    show: false,
    // Gleiche Farbe wie die Oberfläche, sonst blitzt beim Vergrößern ein fremder Rand auf.
    backgroundColor: '#141311',
    title: isDev ? 'Kontor [DEV]' : 'Kontor',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => {
    if (!background) showWindow()
  })

  // Externe Links gehören in den Browser, nicht in das App-Fenster.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message}`))
  }

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Zwei Instanzen würden sich gegenseitig die JSON-Dateien überschreiben.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Auch ein still laufender Hintergrundstart zeigt sich, wenn man Kontor öffnet.
  app.on('second-instance', () => showWindow())

  void app.whenReady().then(() => {
    // Nur sichern, wenn die Daten lesbar sind, sonst verdrängt ein kaputter Stand die guten Backups.
    const readable = load().ok
    if (readable) {
      ensureDailyBackup(store.dataDir)
      pruneAttachments(store.dataDir)
    } else if (background) {
      // Ohne lesbare Daten gibt es nichts zu erinnern; die Fehlermeldung kommt beim nächsten normalen Start.
      app.quit()
      return
    }
    registerIpc()
    createWindow()
  })

  app.on('window-all-closed', () => app.quit())
}
