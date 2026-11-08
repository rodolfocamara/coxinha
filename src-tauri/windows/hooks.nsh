; Spec 0132: the uninstaller's "Delete the application data" box (unchecked by default)
; removes the app data folders. Notes and recordings in the default vault are the
; owner's files, so they get their own question, and "No" is the default answer.
; Hooks are included before the language files, so the text is picked at run time.
; Saved with a BOM: makensis otherwise reads it in the system code page.
Var CoxinhaVaultPrompt
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
  ${AndIfNot} ${Silent}
  ${AndIf} ${FileExists} "$PROFILE\coxinha\*.*"
    ${If} $LANGUAGE = 1046
      StrCpy $CoxinhaVaultPrompt "Apagar também as suas notas e gravações em $PROFILE\coxinha?$\r$\n$\r$\nIsso não pode ser desfeito. Escolha Não para mantê-las."
    ${Else}
      StrCpy $CoxinhaVaultPrompt "Also delete your notes and recordings in $PROFILE\coxinha?$\r$\n$\r$\nThis cannot be undone. Choose No to keep them."
    ${EndIf}
    MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "$CoxinhaVaultPrompt" IDNO coxinha_keep_vault
    RmDir /r "$PROFILE\coxinha"
    coxinha_keep_vault:
  ${EndIf}
!macroend
