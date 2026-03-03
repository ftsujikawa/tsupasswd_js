using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Win32;

var host = new NativeMessagingHost();
await host.RunAsync();

internal sealed class NativeMessagingHost
{
    private const string RegistryPath = "Software\\HappyFactory\\PasskeyManager";
    private const string VaultLockedKey = "VaultLocked";
    private const string SilentOperationKey = "SilentOperation";
    private const string VaultUnlockMethodKey = "VaultUnlockMethod";
    private const string LastMakeCredentialStatusKey = "LastMakeCredentialStatus";
    private const string LastMakeCredentialSequenceKey = "LastMakeCredentialSequence";

    private const uint WebAuthnGetCredentialsOptionsCurrentVersion = 1;

    private readonly Stream _stdin = Console.OpenStandardInput();
    private readonly Stream _stdout = Console.OpenStandardOutput();

    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var message = await ReadMessageAsync(cancellationToken);
            if (message is null)
            {
                // Chrome closed the pipe.
                break;
            }

            var request = message.Value;

            object response;
            try
            {
                response = HandleMessage(request);
            }
            catch (Exception ex)
            {
                response = new
                {
                    ok = false,
                    error = "internal_error",
                    detail = ex.Message,
                    type = GetTypeOrDefault(request)
                };
            }

            await WriteMessageAsync(response, cancellationToken);
        }
    }

    private async Task<JsonElement?> ReadMessageAsync(CancellationToken cancellationToken)
    {
        var lengthBytes = new byte[4];
        var read = await ReadExactAsync(_stdin, lengthBytes, cancellationToken);
        if (read == 0)
        {
            return null;
        }

        if (read < 4)
        {
            throw new EndOfStreamException("Failed to read native message length.");
        }

        var length = BitConverter.ToInt32(lengthBytes, 0);
        if (length <= 0)
        {
            return null;
        }

        var payload = new byte[length];
        var payloadRead = await ReadExactAsync(_stdin, payload, cancellationToken);
        if (payloadRead < length)
        {
            throw new EndOfStreamException("Failed to read full native message payload.");
        }

        using var document = JsonDocument.Parse(payload);
        return document.RootElement.Clone();
    }

    private async Task<int> ReadExactAsync(Stream stream, byte[] buffer, CancellationToken cancellationToken)
    {
        var total = 0;
        while (total < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(total, buffer.Length - total), cancellationToken);
            if (read == 0)
            {
                return total;
            }

            total += read;
        }

        return total;
    }

    private object HandleMessage(JsonElement message)
    {
        var type = GetTypeOrDefault(message);
        var requestId = GetOptionalString(message, "requestId");

        if (string.Equals(type, "ping", StringComparison.OrdinalIgnoreCase))
        {
            return new
            {
                ok = true,
                type = "pong",
                requestId,
                timestampUtc = DateTimeOffset.UtcNow
            };
        }

        if (string.Equals(type, "get_status", StringComparison.OrdinalIgnoreCase))
        {
            return BuildStatusResponse(requestId);
        }

        if (string.Equals(type, "set_vault_locked", StringComparison.OrdinalIgnoreCase))
        {
            if (!TryGetBool(message, "value", out var value))
            {
                return BuildInvalidArgumentResponse(type, requestId, "value(bool) is required.");
            }

            SetRegistryDword(VaultLockedKey, value ? 1 : 0);
            return new { ok = true, type, requestId, value };
        }

        if (string.Equals(type, "set_silent_operation", StringComparison.OrdinalIgnoreCase))
        {
            if (!TryGetBool(message, "value", out var value))
            {
                return BuildInvalidArgumentResponse(type, requestId, "value(bool) is required.");
            }

            SetRegistryDword(SilentOperationKey, value ? 1 : 0);
            return new { ok = true, type, requestId, value };
        }

        if (string.Equals(type, "set_vault_unlock_method", StringComparison.OrdinalIgnoreCase))
        {
            if (!TryGetInt(message, "value", out var value))
            {
                return BuildInvalidArgumentResponse(type, requestId, "value(int) is required.");
            }

            SetRegistryDword(VaultUnlockMethodKey, value);
            return new { ok = true, type, requestId, value };
        }

        if (string.Equals(type, "launch_app", StringComparison.OrdinalIgnoreCase))
        {
            return LaunchApp(message, requestId);
        }

        if (string.Equals(type, "register_plugin", StringComparison.OrdinalIgnoreCase))
        {
            return HandlePluginLifecycleAction(message, requestId, "register_plugin");
        }

        if (string.Equals(type, "update_plugin", StringComparison.OrdinalIgnoreCase))
        {
            return HandlePluginLifecycleAction(message, requestId, "update_plugin");
        }

        if (string.Equals(type, "list_passkeys", StringComparison.OrdinalIgnoreCase))
        {
            var rpId = GetOptionalString(message, "rpId");
            var coreOk = TryReadCorePasskeys(rpId, out var corePasskeys, out var coreError, out var coreDetail);
            var windowsOk = TryReadWindowsHelloPasskeys(rpId, out var windowsPasskeys, out var windowsError, out var windowsDetail);

            if (!coreOk && !windowsOk)
            {
                return new
                {
                    ok = false,
                    error = "all_sources_failed",
                    detail = $"core={coreError}:{coreDetail}; windows_hello={windowsError}:{windowsDetail}",
                    type,
                    requestId
                };
            }

            var passkeys = MergePasskeys(corePasskeys, windowsPasskeys);

            return new
            {
                ok = true,
                type,
                requestId,
                source = "combined",
                sources = new
                {
                    core = new { ok = coreOk, error = coreError, detail = coreDetail, count = corePasskeys.Length },
                    windows_hello = new { ok = windowsOk, error = windowsError, detail = windowsDetail, count = windowsPasskeys.Length }
                },
                passkeys
            };
        }

        if (string.Equals(type, "add_passkey", StringComparison.OrdinalIgnoreCase))
        {
            return new
            {
                ok = false,
                type,
                requestId,
                error = "not_supported",
                detail = "Windows Hello credentials cannot be created from this bridge. Use OS/browser passkey creation flow."
            };
        }

        if (string.Equals(type, "remove_passkey", StringComparison.OrdinalIgnoreCase))
        {
            return new
            {
                ok = false,
                type,
                requestId,
                error = "not_supported",
                detail = "Windows Hello credentials cannot be removed from this bridge. Remove them from OS/browser settings."
            };
        }

        if (string.Equals(type, "clear_passkeys", StringComparison.OrdinalIgnoreCase))
        {
            return new
            {
                ok = false,
                type,
                requestId,
                error = "not_supported",
                detail = "Windows Hello credentials cannot be cleared from this bridge."
            };
        }

        return new
        {
            ok = false,
            error = "not_implemented",
            detail = "Unsupported message type.",
            type,
            requestId
        };
    }

    private static object HandlePluginLifecycleAction(JsonElement message, string? requestId, string action)
    {
        var executablePath = GetOptionalString(message, "executablePath")
            ?? Environment.GetEnvironmentVariable("TSUPASSWD_APP_PATH");
        var arguments = GetOptionalString(message, "arguments") ?? string.Empty;

        if (string.IsNullOrWhiteSpace(executablePath))
        {
            return BuildInvalidArgumentResponse(
                action,
                requestId,
                "executablePath is required (or set TSUPASSWD_APP_PATH environment variable).");
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = executablePath,
            Arguments = arguments,
            UseShellExecute = true
        };
        var process = Process.Start(startInfo);

        return new
        {
            ok = true,
            type = action,
            requestId,
            trigger = "launch_app",
            detail = "PasskeyManager launch triggers ensure_plugin_registration flow on MainPage navigation.",
            executablePath,
            arguments,
            processId = process?.Id
        };
    }

    private static object BuildStatusResponse(string? requestId)
    {
        var vaultLocked = TryGetRegistryDword(VaultLockedKey);
        var silentOperation = TryGetRegistryDword(SilentOperationKey);
        var vaultUnlockMethod = TryGetRegistryDword(VaultUnlockMethodKey);
        var lastMakeCredentialStatus = TryGetRegistryDword(LastMakeCredentialStatusKey);
        var lastMakeCredentialSequence = TryGetRegistryDword(LastMakeCredentialSequenceKey);

        return new
        {
            ok = true,
            type = "get_status",
            requestId,
            registryPath = RegistryPath,
            status = new
            {
                vaultLocked = vaultLocked.HasValue ? (bool?)(vaultLocked.Value != 0) : null,
                silentOperation = silentOperation.HasValue ? (bool?)(silentOperation.Value != 0) : null,
                vaultUnlockMethod,
                lastMakeCredentialStatus,
                lastMakeCredentialSequence
            }
        };
    }

    private static object LaunchApp(JsonElement message, string? requestId)
    {
        var executablePath = GetOptionalString(message, "executablePath")
            ?? Environment.GetEnvironmentVariable("TSUPASSWD_APP_PATH");
        var arguments = GetOptionalString(message, "arguments") ?? string.Empty;

        if (string.IsNullOrWhiteSpace(executablePath))
        {
            return BuildInvalidArgumentResponse(
                "launch_app",
                requestId,
                "executablePath is required (or set TSUPASSWD_APP_PATH environment variable).");
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = executablePath,
            Arguments = arguments,
            UseShellExecute = true
        };

        var process = Process.Start(startInfo);
        return new
        {
            ok = true,
            type = "launch_app",
            requestId,
            executablePath,
            arguments,
            processId = process?.Id
        };
    }

    private static object BuildInvalidArgumentResponse(string? type, string? requestId, string detail)
    {
        return new
        {
            ok = false,
            error = "invalid_argument",
            detail,
            type,
            requestId
        };
    }

    private static string? GetTypeOrDefault(JsonElement message)
    {
        return GetOptionalString(message, "type");
    }

    private static string? GetOptionalString(JsonElement message, string propertyName)
    {
        if (!message.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return value.GetString();
    }

    private static bool TryGetBool(JsonElement message, string propertyName, out bool value)
    {
        value = false;
        if (!message.TryGetProperty(propertyName, out var element))
        {
            return false;
        }

        if (element.ValueKind == JsonValueKind.True || element.ValueKind == JsonValueKind.False)
        {
            value = element.GetBoolean();
            return true;
        }

        if (element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out var num))
        {
            value = num != 0;
            return true;
        }

        return false;
    }

    private static bool TryGetInt(JsonElement message, string propertyName, out int value)
    {
        value = 0;
        return message.TryGetProperty(propertyName, out var element)
            && element.ValueKind == JsonValueKind.Number
            && element.TryGetInt32(out value);
    }

    private static bool TryGetOptionalBool(JsonElement message, string propertyName, out bool value)
    {
        value = false;
        if (!message.TryGetProperty(propertyName, out var element))
        {
            return false;
        }

        if (element.ValueKind == JsonValueKind.True || element.ValueKind == JsonValueKind.False)
        {
            value = element.GetBoolean();
            return true;
        }

        if (element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out var num))
        {
            value = num != 0;
            return true;
        }

        if (element.ValueKind == JsonValueKind.String && bool.TryParse(element.GetString(), out var parsed))
        {
            value = parsed;
            return true;
        }

        return false;
    }

    private static int? TryGetRegistryDword(string keyName)
    {
        using var key = Registry.CurrentUser.OpenSubKey(RegistryPath, false);
        if (key is null)
        {
            return null;
        }

        var value = key.GetValue(keyName);
        if (value is int intValue)
        {
            return intValue;
        }

        if (value is null)
        {
            return null;
        }

        return Convert.ToInt32(value);
    }

    private static void SetRegistryDword(string keyName, int value)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RegistryPath, true);
        if (key is null)
        {
            throw new InvalidOperationException("Failed to open registry key for writing.");
        }

        key.SetValue(keyName, value, RegistryValueKind.DWord);
    }

    private static PasskeyItem[] MergePasskeys(PasskeyItem[] corePasskeys, PasskeyItem[] windowsPasskeys)
    {
        var merged = new List<PasskeyItem>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        static string BuildKey(PasskeyItem p)
        {
            return $"{p.source}|{p.id}|{p.rpId}|{p.user}";
        }

        void AddRange(IEnumerable<PasskeyItem> source)
        {
            foreach (var p in source)
            {
                var key = BuildKey(p);
                if (!seen.Add(key))
                {
                    continue;
                }
                merged.Add(p);
            }
        }

        AddRange(corePasskeys);
        AddRange(windowsPasskeys);
        return merged.ToArray();
    }

    private static bool TryReadCorePasskeys(string? rpIdFilter, out PasskeyItem[] passkeys, out string error, out string detail)
    {
        passkeys = Array.Empty<PasskeyItem>();
        error = "not_configured";
        detail = "tsupasswd_core passkeys file is not configured.";

        var path = ResolveCorePasskeysFilePath();
        if (string.IsNullOrWhiteSpace(path))
        {
            return false;
        }

        if (!File.Exists(path))
        {
            error = "core_file_not_found";
            detail = $"Core passkeys file not found: {path}";
            return false;
        }

        try
        {
            var json = File.ReadAllText(path);
            using var doc = JsonDocument.Parse(json);

            JsonElement passkeysElement;
            if (doc.RootElement.ValueKind == JsonValueKind.Array)
            {
                passkeysElement = doc.RootElement;
            }
            else if (doc.RootElement.ValueKind == JsonValueKind.Object
                     && doc.RootElement.TryGetProperty("passkeys", out var nested)
                     && nested.ValueKind == JsonValueKind.Array)
            {
                passkeysElement = nested;
            }
            else
            {
                error = "core_invalid_format";
                detail = "Expected JSON array or object with passkeys array.";
                return false;
            }

            var items = new List<PasskeyItem>();
            foreach (var entry in passkeysElement.EnumerateArray())
            {
                if (!TryParseCorePasskeyItem(entry, out var item))
                {
                    continue;
                }

                if (!string.IsNullOrWhiteSpace(rpIdFilter) && !RpIdMatches(item.rpId, rpIdFilter))
                {
                    continue;
                }

                item.source = "tsupasswd_core";
                items.Add(item);
            }

            passkeys = items.ToArray();
            error = string.Empty;
            detail = string.Empty;
            return true;
        }
        catch (Exception ex)
        {
            error = "core_read_failed";
            detail = ex.Message;
            return false;
        }
    }

    private static string? ResolveCorePasskeysFilePath()
    {
        var env = Environment.GetEnvironmentVariable("TSUPASSWD_CORE_PASSKEYS_PATH");
        if (!string.IsNullOrWhiteSpace(env))
        {
            return env;
        }

        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(localAppData))
        {
            return null;
        }

        return Path.Combine(localAppData, "tsupasswd", "core-passkeys.json");
    }

    private static bool TryParseCorePasskeyItem(JsonElement entry, out PasskeyItem item)
    {
        item = new PasskeyItem();
        if (entry.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        item.id = GetOptionalString(entry, "id");
        item.title = GetOptionalString(entry, "title");
        item.rpId = GetOptionalString(entry, "rpId");
        item.user = GetOptionalString(entry, "user");
        item.displayName = GetOptionalString(entry, "displayName");
        if (TryGetOptionalBool(entry, "backedUp", out var backedUp))
        {
            item.backedUp = backedUp;
        }
        if (TryGetOptionalBool(entry, "removable", out var removable))
        {
            item.removable = removable;
        }

        return !string.IsNullOrWhiteSpace(item.id)
               || !string.IsNullOrWhiteSpace(item.user)
               || !string.IsNullOrWhiteSpace(item.rpId)
               || !string.IsNullOrWhiteSpace(item.title);
    }

    private static bool RpIdMatches(string? valueRpId, string? filterRpId)
    {
        var value = (valueRpId ?? string.Empty).Trim().ToLowerInvariant();
        var filter = (filterRpId ?? string.Empty).Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(value) || string.IsNullOrWhiteSpace(filter))
        {
            return false;
        }

        return value == filter || value.EndsWith($".{filter}", StringComparison.OrdinalIgnoreCase)
               || filter.EndsWith($".{value}", StringComparison.OrdinalIgnoreCase);
    }

    private static bool TryReadWindowsHelloPasskeys(string? rpIdFilter, out PasskeyItem[] passkeys, out string error, out string detail)
    {
        passkeys = Array.Empty<PasskeyItem>();
        error = "internal_error";
        detail = "Unknown error.";

        IntPtr rpIdPtr = IntPtr.Zero;
        IntPtr listPtr = IntPtr.Zero;
        try
        {
            if (!string.IsNullOrWhiteSpace(rpIdFilter))
            {
                rpIdPtr = Marshal.StringToCoTaskMemUni(rpIdFilter);
            }

            var options = new WEBAUTHN_GET_CREDENTIALS_OPTIONS
            {
                dwVersion = WebAuthnGetCredentialsOptionsCurrentVersion,
                pwszRpId = rpIdPtr,
                bBrowserInPrivateMode = false
            };

            var hr = WebAuthnNative.WebAuthNGetPlatformCredentialList(ref options, out listPtr);
            if (hr < 0)
            {
                error = "platform_query_failed";
                detail = $"WebAuthNGetPlatformCredentialList failed: 0x{hr:X8}";
                return false;
            }

            var list = Marshal.PtrToStructure<WEBAUTHN_CREDENTIAL_DETAILS_LIST>(listPtr);
            var items = new List<PasskeyItem>((int)list.cCredentialDetails);
            for (var i = 0; i < list.cCredentialDetails; i++)
            {
                var pDetail = Marshal.ReadIntPtr(list.ppCredentialDetails, i * IntPtr.Size);
                if (pDetail == IntPtr.Zero)
                {
                    continue;
                }

                var detailStruct = Marshal.PtrToStructure<WEBAUTHN_CREDENTIAL_DETAILS>(pDetail);

                var credentialId = string.Empty;
                if (detailStruct.cbCredentialID > 0 && detailStruct.pbCredentialID != IntPtr.Zero)
                {
                    var bytes = new byte[detailStruct.cbCredentialID];
                    Marshal.Copy(detailStruct.pbCredentialID, bytes, 0, (int)detailStruct.cbCredentialID);
                    credentialId = Convert.ToBase64String(bytes);
                }

                var rpId = string.Empty;
                var rpName = string.Empty;
                if (detailStruct.pRpInformation != IntPtr.Zero)
                {
                    var rp = Marshal.PtrToStructure<WEBAUTHN_RP_ENTITY_INFORMATION>(detailStruct.pRpInformation);
                    rpId = Marshal.PtrToStringUni(rp.pwszId) ?? string.Empty;
                    rpName = Marshal.PtrToStringUni(rp.pwszName) ?? string.Empty;
                }

                var userName = string.Empty;
                var displayName = string.Empty;
                if (detailStruct.pUserInformation != IntPtr.Zero)
                {
                    var user = Marshal.PtrToStructure<WEBAUTHN_USER_ENTITY_INFORMATION>(detailStruct.pUserInformation);
                    userName = Marshal.PtrToStringUni(user.pwszName) ?? string.Empty;
                    displayName = Marshal.PtrToStringUni(user.pwszDisplayName) ?? string.Empty;
                }

                items.Add(new PasskeyItem
                {
                    id = credentialId,
                    title = !string.IsNullOrWhiteSpace(rpName) ? rpName : rpId,
                    rpId = rpId,
                    user = !string.IsNullOrWhiteSpace(userName) ? userName : displayName,
                    displayName = displayName,
                    backedUp = detailStruct.bBackedUp,
                    removable = detailStruct.bRemovable,
                    source = "windows_hello"
                });
            }

            passkeys = items.ToArray();
            error = string.Empty;
            detail = string.Empty;
            return true;
        }
        catch (EntryPointNotFoundException ex)
        {
            error = "not_supported";
            detail = $"Platform credential API is unavailable on this OS build: {ex.Message}";
            return false;
        }
        catch (DllNotFoundException ex)
        {
            error = "not_supported";
            detail = $"webauthn.dll not found: {ex.Message}";
            return false;
        }
        catch (Exception ex)
        {
            error = "platform_query_failed";
            detail = ex.Message;
            return false;
        }
        finally
        {
            if (listPtr != IntPtr.Zero)
            {
                try { WebAuthnNative.WebAuthNFreePlatformCredentialList(listPtr); } catch { }
            }

            if (rpIdPtr != IntPtr.Zero)
            {
                Marshal.FreeCoTaskMem(rpIdPtr);
            }
        }
    }

    private async Task WriteMessageAsync(object payload, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(payload);
        var length = BitConverter.GetBytes(json.Length);

        await _stdout.WriteAsync(length.AsMemory(0, 4), cancellationToken);
        await _stdout.WriteAsync(json.AsMemory(0, json.Length), cancellationToken);
        await _stdout.FlushAsync(cancellationToken);
    }
}

internal sealed class PasskeyItem
{
    public string? id { get; set; }

    public string? source { get; set; }

    public string? title { get; set; }

    public string? rpId { get; set; }

    public string? user { get; set; }

    public string? displayName { get; set; }

    public bool backedUp { get; set; }

    public bool removable { get; set; }
}

[StructLayout(LayoutKind.Sequential)]
internal struct WEBAUTHN_GET_CREDENTIALS_OPTIONS
{
    public uint dwVersion;
    public IntPtr pwszRpId;
    [MarshalAs(UnmanagedType.Bool)]
    public bool bBrowserInPrivateMode;
}

[StructLayout(LayoutKind.Sequential)]
internal struct WEBAUTHN_CREDENTIAL_DETAILS_LIST
{
    public uint cCredentialDetails;
    public IntPtr ppCredentialDetails;
}

[StructLayout(LayoutKind.Sequential)]
internal struct WEBAUTHN_CREDENTIAL_DETAILS
{
    public uint dwVersion;
    public uint cbCredentialID;
    public IntPtr pbCredentialID;
    public IntPtr pRpInformation;
    public IntPtr pUserInformation;
    [MarshalAs(UnmanagedType.Bool)]
    public bool bRemovable;
    [MarshalAs(UnmanagedType.Bool)]
    public bool bBackedUp;
}

[StructLayout(LayoutKind.Sequential)]
internal struct WEBAUTHN_RP_ENTITY_INFORMATION
{
    public uint dwVersion;
    public IntPtr pwszId;
    public IntPtr pwszName;
    public IntPtr pwszIcon;
}

[StructLayout(LayoutKind.Sequential)]
internal struct WEBAUTHN_USER_ENTITY_INFORMATION
{
    public uint dwVersion;
    public uint cbId;
    public IntPtr pbId;
    public IntPtr pwszName;
    public IntPtr pwszIcon;
    public IntPtr pwszDisplayName;
}

internal static class WebAuthnNative
{
    [DllImport("webauthn.dll", EntryPoint = "WebAuthNGetPlatformCredentialList")]
    internal static extern int WebAuthNGetPlatformCredentialList(
        ref WEBAUTHN_GET_CREDENTIALS_OPTIONS pGetCredentialsOptions,
        out IntPtr ppCredentialDetailsList);

    [DllImport("webauthn.dll", EntryPoint = "WebAuthNFreePlatformCredentialList")]
    internal static extern void WebAuthNFreePlatformCredentialList(IntPtr pCredentialDetailsList);
}
