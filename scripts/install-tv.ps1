# Instala o .ipk numa TV LG (webOS) pela rede local, pelo Modo Desenvolvedor.
#
#   Duplo clique no install-tv.bat, ou:
#   powershell -ExecutionPolicy Bypass -File install-tv.ps1 [arquivo.ipk] [ip-da-tv]
#
# Mesmo fluxo do install-tv.command (macOS/Linux), só com o que já vem no
# Windows 10/11 (PowerShell + Cliente OpenSSH; sem ele, baixa o OpenSSH
# portátil da Microsoft sozinho). Os passos que rodam NA TV
# ficam em install-tv-remote.sh, o mesmo arquivo nos dois sistemas.
#
# Chamadas a ssh/ssh-keygen vão por System.Diagnostics.Process com os
# argumentos numa string só: o PowerShell 5 some com argumento vazio (-N "")
# e com aspas dentro de argumento. E o .ipk vai em bytes pro stdin do ssh:
# pipe do PowerShell E Start-Process -RedirectStandardInput tratam o arquivo
# como TEXTO e corrompem o binário (testado: 459 KB viravam 834 KB).

param([string]$Ipk, [string]$Ip)

$Aqui = $PSScriptRoot
$Destino = '/media/developer/temp'

function Falhou([string]$Mensagem) {
    Write-Host ""
    Write-Host $Mensagem
    Write-Host "Confira:"
    Write-Host "  - TV e computador na MESMA rede;"
    Write-Host "  - Developer Mode com 'Dev Mode Status' e 'Key Server' ligados;"
    Write-Host "  - a Passphrase igual à da tela;"
    Write-Host "  - a sessão de desenvolvedor não expirou (renove no app Developer Mode)."
    exit 1
}

function Rodar([string]$Programa, [string]$Argumentos, [string]$Entrada) {
    $info = New-Object System.Diagnostics.ProcessStartInfo $Programa, $Argumentos
    $info.UseShellExecute = $false
    $info.RedirectStandardInput = [bool]$Entrada
    $processo = [System.Diagnostics.Process]::Start($info)
    if ($Entrada) {
        # Bytes crus direto no stdin do ssh (o .ipk é binário)
        $arquivo = [System.IO.File]::OpenRead($Entrada)
        try {
            $arquivo.CopyTo($processo.StandardInput.BaseStream)
        } catch {
            # ssh caiu antes de ler tudo: o código de saída abaixo diz o motivo
        } finally {
            $arquivo.Close()
            $processo.StandardInput.Close()
        }
    }
    $processo.WaitForExit()
    return $processo.ExitCode
}

# ssh/ssh-keygen: os do Windows (Cliente OpenSSH), senão o OpenSSH portátil
# oficial da Microsoft (PowerShell/Win32-OpenSSH), baixado uma vez pra
# %LOCALAPPDATA%\ZappTV - sem admin, sem mexer no sistema. Versão fixa e
# conferida por SHA-256: nunca roda um .exe diferente do que foi revisado.
$OpenSshVersao = '10.0.0.0p2-Preview'
$OpenSshHash = @{
    'Win64' = '23F50F3458C4C5D0B12217C6A5DDFDE0137210A30FA870E98B29827F7B43ABA5'
    'ARM64' = '698C6AEC31C1DD0FB996206E8741F4531A97355686B5431EF347D531B07FCD42'
    'Win32' = 'C61D7FEA20DDFE0FC50EB56210A66464557721120F7794FF9CC883B5BA526ABD'
}

function Achar-OpenSsh {
    $ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
    $keygen = Get-Command ssh-keygen.exe -ErrorAction SilentlyContinue
    if ($ssh -and $keygen) { return @($ssh.Source, $keygen.Source) }

    # PowerShell 32 bits num Windows 64 bits: a arquitetura real vem no W6432
    $arq = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $pacote = switch ($arq) { 'AMD64' { 'Win64' } 'ARM64' { 'ARM64' } default { 'Win32' } }
    $pasta = Join-Path $env:LOCALAPPDATA "ZappTV\openssh-$OpenSshVersao"
    $exe = Join-Path $pasta "OpenSSH-$pacote\ssh.exe"
    if (-not (Test-Path $exe)) {
        Write-Host "SSH não encontrado no Windows: baixando o OpenSSH portátil da Microsoft (~6 MB)..."
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $zip = Join-Path $env:TEMP "OpenSSH-$pacote-$([guid]::NewGuid()).zip"
        try {
            Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/PowerShell/Win32-OpenSSH/releases/download/$OpenSshVersao/OpenSSH-$pacote.zip" -OutFile $zip
            if ((Get-FileHash -Algorithm SHA256 $zip).Hash -ne $OpenSshHash[$pacote]) {
                Write-Host "O arquivo baixado não confere (SHA-256). Nada foi instalado."
                exit 1
            }
            New-Item -ItemType Directory -Force -Path $pasta | Out-Null
            Expand-Archive -Path $zip -DestinationPath $pasta -Force
        } catch {
            Write-Host "Não consegui baixar o OpenSSH. Confira a internet, ou ative o 'Cliente OpenSSH' em Configurações > Apps > Recursos opcionais."
            exit 1
        } finally {
            Remove-Item -Force $zip -ErrorAction SilentlyContinue
        }
    }
    return @($exe, (Join-Path $pasta "OpenSSH-$pacote\ssh-keygen.exe"))
}

$SshExe, $KeygenExe = Achar-OpenSsh

# .ipk: o do argumento, senão o mais novo ao lado do script ou em dist\ipk
if (-not $Ipk) {
    $Ipk = Get-ChildItem -Path $Aqui, (Join-Path (Get-Location) 'dist\ipk') -Filter *.ipk -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Ipk -or -not (Test-Path $Ipk)) {
    Write-Host "Nenhum .ipk encontrado. Uso: install-tv.bat [arquivo.ipk] [ip-da-tv]"
    exit 1
}
$Ipk = (Resolve-Path $Ipk).Path
# ares-package nomeia <id>_<versão>_<arq>.ipk
$AppId = (Split-Path $Ipk -Leaf).Split('_')[0]

while ($Ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    $Ip = (Read-Host 'IP da TV (Configurações > Rede, ex.: 192.168.0.20)').Trim()
}

Write-Host ""
Write-Host "Na TV, abra o app 'Developer Mode' e confira:"
Write-Host "  - Dev Mode Status: ON"
Write-Host "  - Key Server: ON"
$Pass = (Read-Host 'Passphrase que aparece na tela (6 caracteres)').Trim().ToUpper()

$Tmp = Join-Path $env:TEMP ('zapp-tv-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
$Key = Join-Path $Tmp 'webos_rsa'

try {
    Write-Host "Buscando a chave da TV..."
    try {
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri "http://${Ip}:9991/webos_rsa" -OutFile $Key
    } catch {
        Falhou "Não consegui falar com o Key Server da TV."
    }
    # Só o usuário atual lê a chave: o OpenSSH recusa chave "UNPROTECTED"
    # (acesso herdado da pasta TEMP pode incluir outros usuários)
    $acesso = New-Object System.Security.AccessControl.FileSecurity
    $acesso.SetAccessRuleProtection($true, $false)
    $acesso.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        [System.Security.Principal.WindowsIdentity]::GetCurrent().Name, 'FullControl', 'Allow')))
    (Get-Item $Key).SetAccessControl($acesso)
    # Tira a senha de uma cópia temporária: ssh não pergunta a cada comando
    if ((Rodar $KeygenExe "-q -p -P `"$Pass`" -N `"`" -f `"$Key`"") -ne 0) {
        Falhou "A Passphrase não confere com a da TV."
    }

    # O SSH do Modo Desenvolvedor ainda usa chave RSA/SHA-1, que o OpenSSH novo
    # desliga por padrão; host key muda a cada sessão, então não guarda
    $Ssh = "-p 9922 -i `"$Key`" -o BatchMode=yes -o ConnectTimeout=10 " +
        "-o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o LogLevel=ERROR " +
        "-o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedKeyTypes=+ssh-rsa prisoner@$Ip"

    Write-Host "Enviando $(Split-Path $Ipk -Leaf)..."
    if ((Rodar $SshExe "$Ssh `"mkdir -p $Destino && cat > $Destino/zapp.ipk`"" $Ipk) -ne 0) {
        Falhou "Não consegui enviar o app pra TV."
    }

    Write-Host "Instalando..."
    if ((Rodar $SshExe "$Ssh `"sh -s $AppId $Destino`"" (Join-Path $Aqui 'install-tv-remote.sh')) -ne 0) {
        Falhou "A TV recusou a instalação."
    }
    Write-Host "Pronto! O app já está aberto na TV."
} finally {
    Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
