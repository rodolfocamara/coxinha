; Spec 0132: the uninstaller's "Delete the application data" box (unchecked by default)
; removes the app data folders. Notes and recordings in the default vault are the
; owner's files, so they get their own question, and "No" is the default answer.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
  ${AndIfNot} ${Silent}
  ${AndIf} ${FileExists} "$PROFILE\coxinha\*.*"
    MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Also delete your notes and recordings in $PROFILE\coxinha?$\r$\n$\r$\nThis cannot be undone. Choose No to keep them." IDNO coxinha_keep_vault
    RmDir /r "$PROFILE\coxinha"
    coxinha_keep_vault:
  ${EndIf}
!macroend
