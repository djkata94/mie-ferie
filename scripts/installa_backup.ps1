# Registra (o aggiorna) l'attività pianificata di Windows "mie-ferie backup":
# ogni giorno alle 13:00 lancia node scripts/backup.js. Se a quell'ora il PC è spento,
# parte appena possibile (StartWhenAvailable). Gira con il tuo utente, senza privilegi elevati.
#
# Uso (PowerShell, dalla cartella del progetto):  powershell -ExecutionPolicy Bypass -File scripts\installa_backup.ps1
# Per toglierla:  Unregister-ScheduledTask -TaskName "mie-ferie backup" -Confirm:$false

$ErrorActionPreference = 'Stop'
$progetto = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$script = Join-Path $progetto 'scripts\backup.js'

$azione = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $progetto
$quando = New-ScheduledTaskTrigger -Daily -At 13:00
$opzioni = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName 'mie-ferie backup' -Description 'Backup giornaliero dei dati di mie-ferie da Supabase (scripts/backup.js)' `
  -Action $azione -Trigger $quando -Settings $opzioni -Force | Out-Null

# Cartella per la chiave di servizio (il file lo crei tu incollando la chiave)
$cartellaChiave = Join-Path $env:USERPROFILE '.mie-ferie'
New-Item -ItemType Directory -Force -Path $cartellaChiave | Out-Null

Write-Output "Attività 'mie-ferie backup' registrata: ogni giorno alle 13:00 (o appena il PC è acceso)."
Write-Output "Chiave di servizio attesa in: $(Join-Path $cartellaChiave 'service_role.key')"
