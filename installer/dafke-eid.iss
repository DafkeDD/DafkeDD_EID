; Windows-setup voor DafkeDD eID (Inno Setup 6.3+).
;
; Bouwen: npm run build:setup  (na npm run build:exe; zie docs/releasen.md)
;   iscc /DAppVersion=0.1.0 /DSourceExe=..\dist-bin\dafke-eid-windows-x64.exe installer\dafke-eid.iss
;
; Installeert per gebruiker, zonder administratorrechten, in dezelfde map als het losse programma
; (%LOCALAPPDATA%\DafkeDD\eid). Daarna roept de setup `dafke-eid install --from-setup` aan voor
; autostart, snelkoppeling en config.json; de Apps-vermelding en het verwijderen doet de setup zelf.
;
; Stil installeren (IT):
;   dafke-eid-setup-windows-x64.exe /VERYSILENT /ORIGINS=https://app.x.be /AUTHORIGINS=https://sso.x.be
;   optioneel: /TOKEN=geheim /PORT=47820 /NOTESTPAGE
; Stil verwijderen: "%LOCALAPPDATA%\DafkeDD\eid\unins000.exe" /VERYSILENT

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceExe
  #define SourceExe "..\dist-bin\dafke-eid-windows-x64.exe"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist-bin"
#endif

[Setup]
; Nooit wijzigen: hieraan herkent Windows een update van dezelfde app.
AppId={{318FA63C-09B5-4C3B-A80A-0A742BE1826B}
AppName=DafkeDD eID
AppVersion={#AppVersion}
AppVerName=DafkeDD eID {#AppVersion}
AppPublisher=DafkeDD
AppPublisherURL=https://github.com/DafkeDD/DafkeDD_EID
AppSupportURL=https://github.com/DafkeDD/DafkeDD_EID/blob/main/docs/installeren.md
VersionInfoVersion={#AppVersion}
VersionInfoProductName=DafkeDD eID
PrivilegesRequired=lowest
DefaultDirName={localappdata}\DafkeDD\eid
DisableDirPage=yes
UsePreviousAppDir=no
DisableProgramGroupPage=yes
DisableWelcomePage=yes
DisableReadyPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
OutputDir={#OutputDir}
OutputBaseFilename=dafke-eid-setup-windows-x64
UninstallDisplayName=DafkeDD eID
UninstallDisplayIcon={app}\dafke-eid.exe
; Het draaiende programma stoppen we zelf (PrepareToInstall), zonder Restart Manager-vraag.
CloseApplications=no
RestartApplications=no
; Geen logbestand standaard: de opdrachtregel (met /TOKEN) zou erin komen. Debuggen: /LOG="pad".
SetupLogging=no
ShowLanguageDialog=auto

[Languages]
Name: "nl"; MessagesFile: "compiler:Languages\Dutch.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"
Name: "de"; MessagesFile: "compiler:Languages\German.isl"

[CustomMessages]
nl.Starting=DafkeDD eID starten...
en.Starting=Starting DafkeDD eID...
fr.Starting=Démarrage de DafkeDD eID...
de.Starting=DafkeDD eID wird gestartet...
nl.OpenTestPage=Testpagina openen
en.OpenTestPage=Open the test page
fr.OpenTestPage=Ouvrir la page de test
de.OpenTestPage=Testseite öffnen
nl.NotRunning=DafkeDD eID is geïnstalleerd, maar start (nog) niet. Open later de snelkoppeling "DafkeDD eID testen" of kijk in %1.
en.NotRunning=DafkeDD eID is installed but does not respond (yet). Open the "DafkeDD eID testen" shortcut later or check %1.
fr.NotRunning=DafkeDD eID est installé mais ne répond pas (encore). Ouvrez plus tard le raccourci « DafkeDD eID testen » ou consultez %1.
de.NotRunning=DafkeDD eID ist installiert, antwortet aber (noch) nicht. Öffnen Sie später die Verknüpfung „DafkeDD eID testen“ oder prüfen Sie %1.

[Files]
Source: "{#SourceExe}"; DestDir: "{app}"; DestName: "dafke-eid.exe"; Flags: ignoreversion

[Run]
Filename: "{app}\dafke-eid.exe"; Parameters: "test"; Description: "{cm:OpenTestPage}"; Flags: postinstall skipifsilent runhidden nowait

[UninstallRun]
; Stopt het programma en haalt autostart en snelkoppeling weg; de bestanden verwijdert de setup.
Filename: "{app}\dafke-eid.exe"; Parameters: "uninstall --keep-files --silent"; Flags: runhidden waituntilterminated; RunOnceId: "DafkeEidUninstall"

[UninstallDelete]
; config.json, logbestand en starter zijn door het programma zelf gemaakt.
Type: filesandordirs; Name: "{app}"

[Code]
function HasSwitch(const Name: String): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), '/' + Name) = 0 then
      Result := True;
end;

function OptionArg(const Param, Flag: String): String;
var
  Value: String;
begin
  Value := ExpandConstant('{param:' + Param + '|}');
  if Value <> '' then
    Result := ' ' + Flag + ' ' + AddQuotes(Value)
  else
    Result := '';
end;

{ Instellingen van de opdrachtregel doorgeven aan `dafke-eid install` (bewaard in config.json). }
function InstallArgs: String;
begin
  Result := 'install --from-setup --silent' +
    OptionArg('ORIGINS', '--origin') +
    OptionArg('AUTHORIGINS', '--auth-origin') +
    OptionArg('TOKEN', '--token') +
    OptionArg('PORT', '--port');
  if HasSwitch('NOTESTPAGE') then
    Result := Result + ' --no-testpage';
end;

{ Een draaiend programma houdt dafke-eid.exe vast: eerst stoppen (alleen processen van deze gebruiker). }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM dafke-eid.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    WizardForm.StatusLabel.Caption := CustomMessage('Starting');
    if not Exec(ExpandConstant('{app}\dafke-eid.exe'), InstallArgs, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      ResultCode := -1;
    Log(Format('dafke-eid install: code %d', [ResultCode]));
    if (ResultCode <> 0) and not WizardSilent then
      MsgBox(FmtMessage(CustomMessage('NotRunning'), [ExpandConstant('{app}\dafke-eid.log')]), mbInformation, MB_OK);
  end;
end;
