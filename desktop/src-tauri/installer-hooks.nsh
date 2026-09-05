; Where Quire installs. Not a preference — the answer.
;
; The NSIS installer is supposed to remember its own folder: it writes
; $INSTDIR to HKCU\Software\subhadip\Quire on install, and reads it back
; through RestorePreviousInstallLocation on the next one. That key says
; C:\Users\<user>\IDEAVERSE\Quire-Prod and has said so since 3 Sep 2026.
; The 0.1.24 updater ran anyway and copied itself into %LOCALAPPDATA%\Quire,
; leaving the folder the Start Menu shortcut points at untouched on 0.1.23 —
; so every launch found 0.1.24 "available", installed it somewhere nobody
; opens, and found it available again next launch. Forever.
;
; I could not reproduce which branch of that restore lost the path, and the
; loop is not worth another release spent guessing. So the folder stops being
; something the installer works out and becomes something it is told. This
; runs inside Section Install before the first File command, so the payload,
; the registry write, the shortcuts and the uninstaller all follow $INSTDIR
; here rather than the other way round.
;
; The cost is that the directory page cannot move the install any more. That
; is the intent: there is exactly one Quire folder per stage on this machine.

!macro NSIS_HOOK_PREINSTALL
  !if "${PRODUCTNAME}" == "Quire"
    ; Prod. The folder is Quire-Prod, not Quire — the product name and the
    ; stage name differ, which is why this cannot just be ${PRODUCTNAME}.
    StrCpy $INSTDIR "$PROFILE\IDEAVERSE\Quire-Prod"
  !else
    ; Quire-Dev, and anything else that is named for its own stage.
    StrCpy $INSTDIR "$PROFILE\IDEAVERSE\${PRODUCTNAME}"
  !endif
  ; SetOutPath already ran against the old $INSTDIR at the top of the section.
  SetOutPath $INSTDIR
  DetailPrint "Installing to $INSTDIR"
!macroend
