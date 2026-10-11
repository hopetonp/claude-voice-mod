Option Explicit
Dim shell, files, root, command, env, candidate, candidates
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
Set env = shell.Environment("PROCESS")
env("PATH") = root & "\runtime;" & env("PATH")
If env("VOICE_MEDIA_BROWSER") = "" Then
  candidates = Array( _
    env("ProgramFiles") & "\Google\Chrome\Application\chrome.exe", _
    env("ProgramFiles(x86)") & "\Google\Chrome\Application\chrome.exe", _
    env("LOCALAPPDATA") & "\Google\Chrome\Application\chrome.exe")
  env("VOICE_MEDIA_BROWSER") = "chrome.exe"
  For Each candidate In candidates
    If files.FileExists(candidate) Then
      env("VOICE_MEDIA_BROWSER") = candidate
      Exit For
    End If
  Next
End If
shell.CurrentDirectory = root & "\app"
command = Chr(34) & root & "\runtime\node.exe" & Chr(34) & " " & Chr(34) & root & "\app\scripts\launch-host.js" & Chr(34)
shell.Run command, 0, False
