; Macro tuỳ chỉnh cho electron-builder NSIS.
; App tự đăng ký AUMID vào HKCU khi chạy (electron/main.js — registerAumid);
; gỡ cài đặt thì phải dọn khoá đó, nếu không sẽ để rác registry.
!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\vn.standup.app"
!macroend
