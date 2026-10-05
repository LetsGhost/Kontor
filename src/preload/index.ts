import { contextBridge, ipcRenderer } from 'electron'
import type { KontorApi } from '../shared/api'

const api: KontorApi = {
  info: () => ipcRenderer.invoke('info'),
  load: () => ipcRenderer.invoke('load'),
  save: (collection, data) => ipcRenderer.invoke('save', collection, data),
  saveTransactions: (year, data) => ipcRenderer.invoke('saveTransactions', year, data),
  listBackups: () => ipcRenderer.invoke('listBackups'),
  createBackup: () => ipcRenderer.invoke('createBackup'),
  restoreBackup: (name) => ipcRenderer.invoke('restoreBackup', name),
  openDataFolder: () => ipcRenderer.invoke('openDataFolder'),
  addAttachment: (bytes, type) => ipcRenderer.invoke('addAttachment', bytes, type),
  readAttachment: (name) => ipcRenderer.invoke('readAttachment', name),
  openAttachment: (name) => ipcRenderer.invoke('openAttachment', name),
  saveExport: (defaultName, bytes) => ipcRenderer.invoke('saveExport', defaultName, bytes),
  focusWindow: () => ipcRenderer.invoke('focusWindow')
}

contextBridge.exposeInMainWorld('kontor', api)
