; Wird in den Installer von electron-builder eingebunden (nsis.include in package.json).
; Entfernt beim Deinstallieren den Autostart-Eintrag, den Kontor ueber app.setLoginItemSettings anlegt.
; Der Name muss zu LOGIN_ITEM_NAME in src/main/index.ts passen.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Kontor"
!macroend
