# Roda NA TV, mandado por install-tv.command / install-tv.ps1 via "ssh ... sh -s <id> <pasta>":
# instala o .ipk já enviado pra <pasta>/zapp.ipk, espera o "installed" e abre o app.
# O luna-send com subscribe NUNCA termina sozinho: vai pro fundo escrevendo
# num arquivo e morre assim que a resposta chega (ou em 3 min).
# Fica em LF (ver .gitattributes): o sh da TV não entende CRLF.
IPK=$2/zapp.ipk
LOG=$2/zapp-install.log
luna-send-pub -i luna://com.webos.appInstallService/dev/install \
    "{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"$IPK\",\"subscribe\":true}" > "$LOG" 2>/dev/null &
LUNA=$!
ok=1
n=0
while [ $n -lt 180 ]; do
    if grep -q '"installed"' "$LOG"; then ok=0; break; fi
    if grep -qE '"failed"|"returnValue":false' "$LOG"; then cat "$LOG"; break; fi
    sleep 1
    n=$((n + 1))
done
kill $LUNA 2>/dev/null
rm -f "$IPK" "$LOG"
[ $ok -eq 0 ] || exit 1
luna-send-pub -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$1\"}" >/dev/null 2>&1
exit 0
