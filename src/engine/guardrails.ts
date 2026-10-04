import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const hookCommand = "powershell -NoProfile -ExecutionPolicy Bypass -File .cursor/hooks/swarmy-guard.ps1";

const hooksConfig = {
  version: 1,
  hooks: {
    preToolUse: [{ command: hookCommand, failClosed: true }],
    beforeShellExecution: [{ command: hookCommand, failClosed: true }],
  },
};

const guardScript = `
$ErrorActionPreference = "Stop"
$denied = $false
$reason = ""

function Deny([string]$why) {
  if ($script:denied) { return }
  $script:denied = $true
  $script:reason = $why
}

function Get-CommandText($hook) {
  if ($null -ne $hook.tool_input -and $hook.tool_input.command -is [string]) {
    return [string]$hook.tool_input.command
  }
  if ($hook.command -is [string]) {
    return [string]$hook.command
  }
  return ""
}

function Split-Segments([string]$command) {
  return $command -split '&&|;|\\|'
}

function Test-DeniedPush([string]$command) {
  foreach ($part in (Split-Segments $command)) {
    if ($part -match '(^|[^\\w])git(\\.exe)?\\s+push\\b' -and $part -match '(^|\\s)--force(-with-lease)?(?=\\s|$)') {
      return $true
    }
  }
  return $false
}

function Get-RemoveTarget([string]$part) {
  $tokens = $part.Trim() -split '\\s+'
  $skipNext = $false
  $valueSwitches = @("-path", "-literalpath", "-include", "-exclude", "-filter", "-erroraction", "-warningaction", "-informationaction", "-credential")
  $paths = @()
  foreach ($token in $tokens) {
    if ($skipNext) {
      $skipNext = $false
      $paths += $token.Trim([char]34).Trim([char]39)
      continue
    }
    $lower = $token.ToLowerInvariant()
    if ($lower -eq "remove-item" -or $lower -eq "ri") { continue }
    if ($lower -match "^-[a-z]") {
      $name = ($lower -split ":")[0]
      if ($lower.Contains(":")) {
        $paths += $token.Substring($token.IndexOf(":") + 1).Trim([char]34).Trim([char]39)
        continue
      }
      if ($valueSwitches -contains $name) {
        $skipNext = $true
        continue
      }
      continue
    }
    $paths += $token.Trim([char]34).Trim([char]39)
  }
  if ($paths.Count -eq 0) { return "" }
  return [string]$paths[0]
}

function Test-IsWorkspaceRoot([string]$target, [string]$root) {
  if ([string]::IsNullOrWhiteSpace($target)) { return $false }
  $trimmed = $target.Trim().TrimEnd("\\", "/")
  if ($trimmed -eq "." -or $trimmed -eq "") { return $true }
  $fullRoot = [System.IO.Path]::GetFullPath($root).TrimEnd("\\")
  try {
    if ([System.IO.Path]::IsPathRooted($target)) {
      $full = [System.IO.Path]::GetFullPath($target)
    } else {
      $full = [System.IO.Path]::GetFullPath((Join-Path $root $target))
    }
  } catch {
    return $true
  }
  return $full.TrimEnd("\\") -eq $fullRoot
}

function Test-DeniedRemove([string]$command, [string]$root) {
  foreach ($part in (Split-Segments $command)) {
    if ($part -notmatch '\\bRemove-Item\\b') { continue }
    if ($part -notmatch '(^|\\s)-Recurse(?=\\s|$)') { continue }
    if (Test-IsWorkspaceRoot (Get-RemoveTarget $part) $root) { return $true }
  }
  return $false
}

function Test-WriteTool([string]$name) {
  $normalized = $name.ToLowerInvariant()
  $writes = @("write", "edit", "delete", "strreplace", "applypatch", "applyagentdiff", "notebookedit", "search_replace")
  return $writes -contains $normalized
}

function Get-WritePath($hook) {
  $toolInput = $hook.tool_input
  if ($toolInput -is [string] -and $toolInput.Trim().Length -gt 0) {
    try { $toolInput = $toolInput | ConvertFrom-Json } catch { return "" }
  }
  if ($null -eq $toolInput) { return "" }
  foreach ($key in @("path", "file_path", "filePath", "target_file", "uri")) {
    $value = $toolInput.$key
    if ($value -is [string] -and $value.Trim().Length -gt 0) { return $value.Trim() }
  }
  return ""
}

function Resolve-WorkspaceRelative([string]$path, [string]$root) {
  $base = [System.IO.Path]::GetFullPath($root)
  if (-not $base.EndsWith("\\")) { $base = $base + "\\" }
  try {
    if ([System.IO.Path]::IsPathRooted($path)) {
      $candidate = [System.IO.Path]::GetFullPath($path)
    } else {
      $candidate = [System.IO.Path]::GetFullPath((Join-Path $root $path))
    }
  } catch {
    return $null
  }
  $rootTrim = $base.TrimEnd("\\")
  if ($candidate.TrimEnd("\\") -eq $rootTrim) { return "" }
  if (-not $candidate.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
  return $candidate.Substring($base.Length).TrimStart("\\")
}

function Test-UnderAllowed([string]$relative, [string]$allowed) {
  $rel = ($relative -replace "/", "\\").Trim("\\")
  $allow = ($allowed -replace "/", "\\").Trim("\\")
  if ($allow.Length -eq 0) { return $false }
  if ($rel.Equals($allow, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
  return $rel.StartsWith($allow + "\\", [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-WriteAllowed([string]$path, [string]$root, $writePaths) {
  $relative = Resolve-WorkspaceRelative $path $root
  if ($null -eq $relative) { return $false }
  $normalized = ($relative -replace "/", "\\")
  if ($normalized.Equals(".cursor", [System.StringComparison]::OrdinalIgnoreCase) -or $normalized.StartsWith(".cursor\\", [System.StringComparison]::OrdinalIgnoreCase)) {
    return $false
  }
  $allowed = @()
  if ($null -ne $writePaths) { $allowed = @($writePaths) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } }
  if ($allowed.Count -eq 0) { return $true }
  foreach ($entry in $allowed) {
    if (Test-UnderAllowed $normalized ([string]$entry)) { return $true }
  }
  return $false
}

try {
  $reader = New-Object System.IO.StreamReader ([Console]::OpenStandardInput())
  $raw = $reader.ReadToEnd()
  if ($null -eq $raw) { $raw = "" }
  if ($raw.Length -gt 0 -and [int]$raw[0] -eq 0xFEFF) { $raw = $raw.Substring(1) }
  $raw = $raw.Trim()
  if ($raw.Length -eq 0) { Deny "Denied by Swarmy guardrails: empty hook payload." }
  else {
    $scopePath = Join-Path $PSScriptRoot "swarmy-scope.json"
    if (-not (Test-Path -LiteralPath $scopePath)) {
      Deny "Denied by Swarmy guardrails: scope file is missing."
    } else {
      $scope = Get-Content -LiteralPath $scopePath -Raw | ConvertFrom-Json
      $root = [string]$scope.workspaceRoot
      if ([string]::IsNullOrWhiteSpace($root)) {
        Deny "Denied by Swarmy guardrails: workspace root is missing."
      } else {
        $hook = $raw | ConvertFrom-Json
        $command = Get-CommandText $hook
        if (-not [string]::IsNullOrWhiteSpace($command)) {
          if (Test-DeniedPush $command) {
            Deny "Denied by Swarmy guardrails: git push --force is not allowed."
          } elseif (Test-DeniedRemove $command $root) {
            Deny "Denied by Swarmy guardrails: Remove-Item -Recurse on the workspace root is not allowed."
          }
        }
        if (-not $denied) {
          $toolName = ""
          if ($null -ne $hook.tool_name) { $toolName = [string]$hook.tool_name }
          if (Test-WriteTool $toolName) {
            $writePath = Get-WritePath $hook
            if ([string]::IsNullOrWhiteSpace($writePath)) {
              Deny "Denied by Swarmy guardrails: write has no path."
            } elseif (-not (Test-WriteAllowed $writePath $root $scope.writePaths)) {
              Deny "Denied by Swarmy guardrails: write is outside the allowed paths."
            }
          }
        }
      }
    }
  }
} catch {
  Deny "Denied by Swarmy guardrails: hook failed closed."
}

if ($denied) {
  $payload = @{ permission = "deny"; user_message = $reason; agent_message = $reason } | ConvertTo-Json -Compress
  Write-Output $payload
  exit 2
}
Write-Output '{"permission":"allow"}'
exit 0
`.trimStart();

export function guardrailPromptNote(writePaths: readonly string[]): string {
  const paths = writePaths.map((path) => path.trim()).filter((path) => path.length > 0);
  const scope =
    paths.length > 0
      ? `You may write only these relative paths: ${paths.join(", ")}.`
      : "You may write only inside this workspace.";
  return `${scope} Do not run git push --force, git push --force-with-lease, or Remove-Item -Recurse on the workspace root. A hook will deny those.`;
}

export async function installGuardrails(
  workspaceRoot: string,
  options: { writePaths: readonly string[] },
): Promise<void> {
  const root = resolve(workspaceRoot);
  const hooksDir = join(root, ".cursor", "hooks");
  await mkdir(hooksDir, { recursive: true });
  await writeFile(join(root, ".cursor", "hooks.json"), `${JSON.stringify(hooksConfig, null, 2)}\n`, "utf8");
  await writeFile(join(hooksDir, "swarmy-guard.ps1"), guardScript, "utf8");
  const writePaths = options.writePaths.map((path) => path.trim()).filter((path) => path.length > 0);
  await writeFile(
    join(hooksDir, "swarmy-scope.json"),
    `${JSON.stringify({ workspaceRoot: root, writePaths }, null, 2)}\n`,
    "utf8",
  );
  await excludeGuardrailFiles(root);
}

async function excludeGuardrailFiles(cwd: string): Promise<void> {
  const gitPath = await gitExcludePath(cwd);
  if (gitPath.length === 0) return;
  const full = isAbsolute(gitPath) ? gitPath : resolve(cwd, gitPath);
  await mkdir(resolve(full, ".."), { recursive: true });
  let current = "";
  try {
    current = await readFile(full, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") return;
  }
  const lines = new Set(current.split(/\r?\n/));
  const missing = [".cursor/hooks.json", ".cursor/hooks/"].filter((line) => !lines.has(line));
  if (missing.length === 0) return;
  const prefix = current.length === 0 || current.endsWith("\n") ? current : `${current}\n`;
  await writeFile(full, `${prefix}${missing.join("\n")}\n`, "utf8");
}

async function gitExcludePath(cwd: string): Promise<string> {
  try {
    return (await git(cwd, ["rev-parse", "--git-path", "info/exclude"])).trim();
  } catch {
    return "";
  }
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn("git", ["--no-pager", ...args], {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveOutput(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `git ${args.join(" ")} failed`));
    });
  });
}
