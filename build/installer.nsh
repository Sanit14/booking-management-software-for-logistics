; Included by electron-builder's NSIS target by convention (build/installer.nsh).
; Creates the shared folders and lets every seat write to them. It never deletes anything: there is no
; customUnInstall on purpose, so uninstall removes only the program files and a reinstall finds the same data.
; Nothing here touches DeliveryManager (its folders, shortcuts, registry keys or port).

!include LogicLib.nsh

Var BmProgramData
Var BmIcaclsExit

; Seats are non-admin Windows users; a folder an elevated installer creates under C:\ is read-only for them.
; Grant the built-in Users group (well-known SID, same on every language) Modify, inherited by new files.
!macro bmSharedFolder path
  CreateDirectory "${path}"
  nsExec::ExecToLog 'icacls "${path}" /grant *S-1-5-32-545:(OI)(CI)M'
  Pop $BmIcaclsExit
  ${If} $BmIcaclsExit != "0"
    DetailPrint "WARNING: icacls could not give Users write access to ${path} (exit $BmIcaclsExit)"
  ${EndIf}
!macroend

!macro customInstall
  ExpandEnvStrings $BmProgramData "%ProgramData%"
  !insertmacro bmSharedFolder "C:\BookingManagerData"
  !insertmacro bmSharedFolder "$BmProgramData\BookingManager"
  !insertmacro bmSharedFolder "$BmProgramData\BookingManager\logs"

  ; Backups belong on another physical disk. Only when D: exists and is a fixed disk (3); otherwise the
  ; keeper reports "backups failing" in the status box instead of falling back to C:.
  System::Call 'kernel32::GetDriveTypeW(w "D:\")i.r0'
  ${If} $0 == 3
    !insertmacro bmSharedFolder "D:\BookingManagerBackups"
  ${EndIf}
!macroend
