; O protocolo kiroshi:// (convite por link, F8), registrado pelo INSTALADOR.
;
; O electron-builder so registra protocolo no Mac e no Linux; no Windows o
; costume e o app chamar setAsDefaultProtocolClient toda vez que abre. Aqui
; quem grava e o instalador, e quem apaga e o desinstalador: o app nunca mexe
; no registro sozinho — e um build de teste aberto de uma pasta qualquer nao
; sequestra os links de quem tem o app instalado.
;
; Por usuario (HKCU), como a instalacao (perMachine: false). A atualizacao
; automatica roda este mesmo instalador, entao o registro acompanha a pasta.

!macro customInstall
  WriteRegStr HKCU "Software\Classes\kiroshi" "" "URL:Kiroshi"
  WriteRegStr HKCU "Software\Classes\kiroshi" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\kiroshi\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\kiroshi\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

; A atualizacao tambem passa pelo desinstalador da versao velha: la o
; registro fica, porque a nova grava de novo logo em seguida. Na remocao de
; verdade, so apaga se o protocolo ainda for deste app, e nao de outro Kiroshi
; que o tenha registrado depois.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadRegStr $0 HKCU "Software\Classes\kiroshi\shell\open\command" ""
    ${if} $0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
      DeleteRegKey HKCU "Software\Classes\kiroshi"
    ${endIf}
  ${endIf}
!macroend
