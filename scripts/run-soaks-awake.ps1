# Temporary native execution-state request and a kill-on-close job for owned descendants.
# The C# guard is reused verbatim from the retained RC6 run-full-soaks-awake.ps1.
param(
  [string]$ReleaseDirectory,
  [string]$EnvironmentDirectory,
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [ValidatePattern('^[a-f0-9]{64}$')][string]$ManifestSha256,
  [ValidateSet('short','full')][string]$Phase='short',
  [string]$Hosts='browser,qt,jupyter',
  [string]$ShortEvidence,
  [ValidateRange(1,128)][double]$MinFreeGiB=2,
  [ValidateRange(0,10)][int]$SmokeSeconds=0
)
$ErrorActionPreference='Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows execution-state guard is unavailable on this platform.' }
if (-not $SmokeSeconds -and (-not $ManifestSha256 -or -not $ReleaseDirectory -or -not $EnvironmentDirectory)) { throw 'ReleaseDirectory, EnvironmentDirectory and ManifestSha256 are required.' }
$runOutput=[IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $runOutput) { throw 'Choose a new evidence directory; existing runs are never overwritten.' }
New-Item -ItemType Directory -Path $runOutput | Out-Null
$nodePath=(Get-Command node -CommandType Application | Select-Object -First 1).Source
$controllerPath=Join-Path $PSScriptRoot 'run-soaks-sequential.mjs'
$guardLog=Join-Path $runOutput 'power-guard.jsonl'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public static class VesoraSoakPowerGuard {
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint SetThreadExecutionState(uint flags);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref JobInfo info,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool DuplicateHandle(IntPtr sourceProcess,IntPtr source,IntPtr targetProcess,out IntPtr target,uint access,bool inherit,uint options);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr environment,string directory,ref StartupInfo startup,out ProcessInfo process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long ProcessTime,JobTime; public uint Flags; public UIntPtr MinWorking,MaxWorking; public uint ActiveLimit; public UIntPtr Affinity; public uint Priority,Scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct JobInfo { public BasicLimit Basic; public IoCounters Io; public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct StartupInfo { public uint Size; public string Reserved,Desktop,Title; public uint X,Y,XSize,YSize,XChars,YChars,Fill,Flags; public ushort Show,Reserved2Size; public IntPtr Reserved2,Input,Output,Error; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process,Thread; public uint ProcessId,ThreadId; }
  static void Check(bool result,string operation) { if(!result){int code=Marshal.GetLastWin32Error();throw new Win32Exception(code,operation+" (Win32 error "+code+")");} }
  static string Quote(string arg) { StringBuilder text=new StringBuilder("\"");int slashes=0;foreach(char value in arg){if(value=='\\'){slashes++;continue;}text.Append('\\',value=='"'?slashes*2+1:slashes).Append(value);slashes=0;}return text.Append('\\',slashes*2).Append('"').ToString(); }
  static void Log(string path,string fields) { File.AppendAllText(path,"{\"atUtc\":\""+DateTime.UtcNow.ToString("o")+"\",\"pid\":"+Process.GetCurrentProcess().Id+","+fields+"}\n",new UTF8Encoding(false)); }
  public static int Run(string node,string[] args,string directory,string log) {
    IntPtr job=IntPtr.Zero; ProcessInfo child=new ProcessInfo(); IntPtr[] streams=new IntPtr[3]; bool acquired=false,assigned=false,cancelled=false;
    ConsoleCancelEventHandler handler=(sender,eventArgs)=>{eventArgs.Cancel=true;cancelled=true;};
    Console.CancelKeyPress+=handler;
    try {
      uint previous=SetThreadExecutionState(0x80000003);Check(previous!=0,"SetThreadExecutionState(SYSTEM_REQUIRED|DISPLAY_REQUIRED|CONTINUOUS)");acquired=true;
      Log(log,"\"event\":\"acquired\",\"flags\":\"0x80000003\",\"limitation\":\"Idle prevention only; keep lid open and power connected. Explicit sleep or lid closure is not blocked.\"");
      job=CreateJobObject(IntPtr.Zero,null);Check(job!=IntPtr.Zero,"CreateJobObject");
      JobInfo limits=new JobInfo();limits.Basic.Flags=0x2000;Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(JobInfo))),"Configure kill-on-job-close");
      IntPtr own=GetCurrentProcess(); for(int i=0;i<3;i++)Check(DuplicateHandle(own,GetStdHandle(-10-i),own,out streams[i],0,true,2),"Duplicate owned standard stream");
      StartupInfo startup=new StartupInfo();startup.Size=(uint)Marshal.SizeOf(typeof(StartupInfo));startup.Flags=0x100;startup.Input=streams[0];startup.Output=streams[1];startup.Error=streams[2];
      StringBuilder command=new StringBuilder(Quote(node));foreach(string arg in args){if(arg.IndexOf('\0')>=0)throw new ArgumentException("NUL in child argument");command.Append(' ').Append(Quote(arg));}
      Check(CreateProcess(node,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,directory,ref startup,out child),"Create hidden suspended controller");
      Check(AssignProcessToJobObject(job,child.Process),"Assign only-owned child to job");assigned=true;
      Log(log,"\"event\":\"child-started\",\"childPid\":"+child.ProcessId+",\"ownedJobKillOnClose\":true");
      Check(ResumeThread(child.Thread)!=0xffffffff,"Resume owned controller");
      while(true){uint wait=WaitForSingleObject(child.Process,1000);if(wait==0)break;Check(wait==258,"Wait for owned controller");if(cancelled){TerminateJobObject(job,1223);throw new OperationCanceledException("Guard interrupted; owned controller job terminated.");}}
      uint code;Check(GetExitCodeProcess(child.Process,out code),"Read owned controller exit");Log(log,"\"event\":\"child-exited\",\"exitCode\":"+code);return unchecked((int)code);
    } finally {
      if(child.Process!=IntPtr.Zero&&!assigned)TerminateProcess(child.Process,125);
      if(job!=IntPtr.Zero){TerminateJobObject(job,125);CloseHandle(job);}
      if(child.Thread!=IntPtr.Zero)CloseHandle(child.Thread);if(child.Process!=IntPtr.Zero)CloseHandle(child.Process);
      foreach(IntPtr stream in streams)if(stream!=IntPtr.Zero)CloseHandle(stream);
      Console.CancelKeyPress-=handler;
      if(acquired){uint result=SetThreadExecutionState(0x80000000);Log(log,"\"event\":\"released\",\"success\":"+(result!=0?"true":"false"));Check(result!=0,"Release execution-state guard");}
    }
  }
}
'@
$oldPid=$env:VESORA_POWER_GUARD_PID
$oldLog=$env:VESORA_POWER_GUARD_LOG
$env:VESORA_POWER_GUARD_PID=[string]$PID
$env:VESORA_POWER_GUARD_LOG=$guardLog
try {
  Write-Output "POWER_GUARD_LOG=$guardLog"
  if($SmokeSeconds){$childArguments=@('--eval',"setTimeout(()=>process.exit(0), $($SmokeSeconds*1000))")}
  else{
    $childArguments=@($controllerPath,'--release',[IO.Path]::GetFullPath($ReleaseDirectory),'--env',[IO.Path]::GetFullPath($EnvironmentDirectory),'--output',$runOutput,'--expected-manifest-sha256',$ManifestSha256,'--phase',$Phase,'--hosts',$Hosts,'--min-free-gib',$MinFreeGiB.ToString([Globalization.CultureInfo]::InvariantCulture))
    if($ShortEvidence){$childArguments+=@('--short-evidence',[IO.Path]::GetFullPath($ShortEvidence))}
  }
  $result=[VesoraSoakPowerGuard]::Run($nodePath,$childArguments,(Get-Location).Path,$guardLog)
} finally {
  $env:VESORA_POWER_GUARD_PID=$oldPid
  $env:VESORA_POWER_GUARD_LOG=$oldLog
}
exit $result
