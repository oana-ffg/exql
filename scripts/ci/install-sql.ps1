$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'This installer is only for disposable GitHub runners.' }
if (Get-Service MSSQLSERVER -ErrorAction SilentlyContinue) { throw 'Refusing to replace an existing SQL instance.' }
$directory = Join-Path $env:RUNNER_TEMP 'exql-sql-setup'
New-Item -ItemType Directory -Path $directory | Out-Null
$bootstrap = Join-Path $directory 'SQL2022-Express.exe'
Invoke-WebRequest 'https://go.microsoft.com/fwlink/p/?linkid=2216019&clcid=0x409&culture=en-us&country=us' -OutFile $bootstrap
$download = Start-Process -FilePath $bootstrap -ArgumentList "/Action=Download /MediaType=Core /Quiet /MediaPath=$directory" -WindowStyle Hidden -Wait -PassThru
if ($download.ExitCode -ne 0) { throw "SQL media download failed: $($download.ExitCode)" }
$media = @(Get-ChildItem -LiteralPath $directory -Filter 'SQLEXPR*x64*.exe')
if ($media.Count -ne 1) { throw 'Expected one SQL Express media executable.' }
$extracted = Join-Path $directory 'media'
$extract = Start-Process -FilePath $media[0].FullName -ArgumentList "/q /x:$extracted" -WindowStyle Hidden -Wait -PassThru
if ($extract.ExitCode -ne 0) { throw "SQL media extraction failed: $($extract.ExitCode)" }
$env:EXQL_TEST_SQL_PASSWORD = 'Exql!' + [Guid]::NewGuid().ToString('N') + 'aB9'
Write-Output "::add-mask::$env:EXQL_TEST_SQL_PASSWORD"
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = @('/Q', '/ACTION=Install', '/FEATURES=SQLENGINE', '/INSTANCENAME=MSSQLSERVER',
    '/IACCEPTSQLSERVERLICENSETERMS', '/UPDATEENABLED=False', '/USEMICROSOFTUPDATE=False',
    '/TCPENABLED=1', '/NPENABLED=1', '/SQLSVCSTARTUPTYPE=Automatic', '/SECURITYMODE=SQL',
    "/SAPWD=$env:EXQL_TEST_SQL_PASSWORD", "/SQLSYSADMINACCOUNTS=`"$account`"")
$install = Start-Process -FilePath (Join-Path $extracted 'setup.exe') -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
if ($install.ExitCode -notin 0, 3010) { throw "SQL Express installation failed: $($install.ExitCode). See SQL Setup Bootstrap logs." }
"EXQL_TEST_SERVER=localhost`nEXQL_TEST_AUTH=windows`nEXQL_TEST_SQL_USER=sa`nEXQL_TEST_SQL_PASSWORD=$env:EXQL_TEST_SQL_PASSWORD" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
