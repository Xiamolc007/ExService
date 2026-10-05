param([Parameter(Mandatory=$true)][string]$SpecificationBase64)
$ErrorActionPreference = 'Stop'
# A private non-inheritable Job handle is the lifetime authority for all descendants.
# Create the root suspended, assign it before its first instruction, then resume.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
public static class ExWebsiteOwnedProcess {
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters {
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {
    public BasicLimit BasicLimitInformation;
    public IoCounters IoInfo;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct StartupInfo {
    public uint cb; public string lpReserved, lpDesktop, lpTitle;
    public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public ushort wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInformation { public IntPtr hProcess, hThread; public uint processId, threadId; }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
    public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimit info, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfo startup, out ProcessInformation process);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int type, out Accounting information, uint length, IntPtr returnedLength);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static string Quote(string value) {
    var result = new StringBuilder("\""); int slashes = 0;
    foreach (char character in value) {
      if (character == '\\') { slashes++; continue; }
      if (character == '"') result.Append('\\', slashes * 2 + 1).Append('"');
      else result.Append('\\', slashes).Append(character);
      slashes = 0;
    }
    return result.Append('\\', slashes * 2).Append('"').ToString();
  }
  public static int Run(string executable, string[] arguments, string cwd) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null); ProcessInformation process = new ProcessInformation(); bool assigned = false;
    if (job == IntPtr.Zero) throw new Win32Exception();
    try {
      var limits = new ExtendedLimit(); limits.BasicLimitInformation.LimitFlags = 0x2000;
      if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits))) throw new Win32Exception();
      var startup = new StartupInfo(); startup.cb = (uint)Marshal.SizeOf(startup); startup.dwFlags = 0x100;
      // stdin belongs exclusively to the parent/helper lifetime protocol. The
      // application never inherits it, so EOF is an unforgeable spawn capability.
      startup.hStdInput = IntPtr.Zero; startup.hStdOutput = GetStdHandle(-11); startup.hStdError = GetStdHandle(-12);
      var command = new StringBuilder(Quote(executable)); foreach (string argument in arguments) command.Append(' ').Append(Quote(argument));
      if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x4 | 0x08000000, IntPtr.Zero, cwd, ref startup, out process)) throw new Win32Exception();
      if (!AssignProcessToJobObject(job, process.hProcess)) throw new Win32Exception(); assigned = true;
      if (ResumeThread(process.hThread) == 0xffffffff) throw new Win32Exception();
      var parentClosed = Task.Run(() => Console.In.ReadToEnd());
      while (WaitForSingleObject(process.hProcess, 100) == 0x102) {
        if (parentClosed.IsCompleted) {
          if (!TerminateJobObject(job, 1)) throw new Win32Exception();
          WaitForSingleObject(process.hProcess, 0xffffffff); break;
        }
      }
      uint code; if (!GetExitCodeProcess(process.hProcess, out code)) throw new Win32Exception();
      // Root completion may leave descendants. Wait for the complete private
      // job to become empty before reporting helper exit to the supervisor.
      if (!TerminateJobObject(job, 1)) throw new Win32Exception();
      Accounting accounting;
      do {
        if (!QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero)) throw new Win32Exception();
        if (accounting.ActiveProcesses != 0) System.Threading.Thread.Sleep(20);
      } while (accounting.ActiveProcesses != 0);
      return unchecked((int)code);
    } finally {
      if (!assigned && process.hProcess != IntPtr.Zero) TerminateProcess(process.hProcess, 1);
      CloseHandle(job);
      if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
      if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
    }
  }
}
'@
try {
  $specification = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($SpecificationBase64)) | ConvertFrom-Json
  $childCode = [ExWebsiteOwnedProcess]::Run([string]$specification.command, [string[]]$specification.args, [string]$specification.cwd)
  exit $childCode
} catch { [Console]::Error.WriteLine('OWNED_PROCESS_LAUNCH_FAILED'); exit 1 }
