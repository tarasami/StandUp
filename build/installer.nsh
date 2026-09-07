; Custom macros for the electron-builder NSIS target.
; The app registers its AUMID under HKCU at runtime (electron/main.js — registerAumid);
; uninstalling must clear that key, otherwise it leaves registry litter behind.
!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\vn.standup.app"
!macroend
