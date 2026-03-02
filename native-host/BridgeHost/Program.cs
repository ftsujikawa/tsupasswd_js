using System.Diagnostics;
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

    private async Task WriteMessageAsync(object payload, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(payload);
        var length = BitConverter.GetBytes(json.Length);

        await _stdout.WriteAsync(length.AsMemory(0, 4), cancellationToken);
        await _stdout.WriteAsync(json.AsMemory(0, json.Length), cancellationToken);
        await _stdout.FlushAsync(cancellationToken);
    }
}
