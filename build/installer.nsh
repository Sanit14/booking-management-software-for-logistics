; Included by electron-builder's NSIS target by convention (build/installer.nsh).
; Creates the shared folders and lets every seat write to them. It never deletes anything: there is no
; customUnInstall on purpose, so uninstall removes only the program files and a reinstall finds the same data.
; Nothing here touches DeliveryManager (its folders, shortcuts, registry keys or port).

!include LogicLib.nsh

Var BmProgramData
Var BmIcaclsExit
Var BmAttributes
Var BmLog

; Seats are non-admin Windows users; a folder an elevated installer creates under C:\ is read-only for them.
; Grant the built-in Users group (well-known SID, same on every language) Modify, inherited by new files.
; A Users account can delete these folders (they sit in C:\, ProgramData and D:\) and put a link in their place. icacls follows a directory symlink and
; would change the permissions of the folder it points to, so a link (junction or symlink: FILE_ATTRIBUTE_REPARSE_POINT, 0x400) gets no grant. A path that
; cannot be read counts as a link: when in doubt, no grant. scripts/test-installer.cjs proves this with a real installer.
!macro bmSharedFolder path
  CreateDirectory "${path}"
  System::Call 'kernel32::GetFileAttributesW(w "${path}")i.s'
  Pop $BmAttributes
  IntOp $BmAttributes $BmAttributes & 0x400
  ${If} $BmAttributes != 0
    DetailPrint "SKIPPED: ${path} is a link to another folder (or cannot be read), so Users were not given write access to it. Ask the administrator to look at it."
    ; An update installs silently and shows no details: the line is also kept in a file in the installing user's temp folder.
    FileOpen $BmLog "$TEMP\BookingManager-install.log" a
    FileSeek $BmLog 0 END
    FileWrite $BmLog "SKIPPED: ${path} is a link to another folder (or cannot be read); Users were not given write access to it.$\r$\n"
    FileClose $BmLog
  ${Else}
    nsExec::ExecToLog 'icacls "${path}" /grant *S-1-5-32-545:(OI)(CI)M'
    Pop $BmIcaclsExit
    ${If} $BmIcaclsExit != "0"
      DetailPrint "WARNING: icacls could not give Users write access to ${path} (exit $BmIcaclsExit)"
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  ExpandEnvStrings $BmProgramData "%ProgramData%"
  !insertmacro bmSharedFolder "C:\BookingManagerData"
  !insertmacro bmSharedFolder "$BmProgramData\BookingManager"
  ; (no ...\BookingManager\logs here: it would be created and granted THROUGH a link in place of BookingManager, which the check above skips;
  ; the keeper makes that folder, and the inheritable grant on BookingManager covers it)

  ; Backups belong on another physical disk. Only when D: exists and is a fixed disk (3); otherwise the
  ; keeper reports "backups failing" in the status box instead of falling back to C:.
  System::Call 'kernel32::GetDriveTypeW(w "D:\")i.r0'
  ${If} $0 == 3
    !insertmacro bmSharedFolder "D:\BookingManagerBackups"
  ${EndIf}
!macroend
