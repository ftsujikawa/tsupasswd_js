using System.Text.Json;

var host = new NativeMessagingVaultHost();
await host.RunAsync();

internal sealed class NativeMessagingVaultHost
{
    private const string DefaultAppDirName = "tsupasswd";
    private const string DefaultStoreFileName = "vault-store.json";

    private readonly Stream _stdin = Console.OpenStandardInput();
    private readonly Stream _stdout = Console.OpenStandardOutput();

    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var message = await ReadMessageAsync(cancellationToken);
            if (message is null)
            {
                break;
            }

            var request = message.Value;
            object response;
            try
            {
                response = HandleRequest(request);
            }
            catch (Exception ex)
            {
                response = new
                {
                    ok = false,
                    error = "internal_error",
                    detail = ex.Message,
                    id = GetOptionalString(request, "id"),
                    command = GetOptionalString(request, "command")
                };
            }

            await WriteMessageAsync(response, cancellationToken);
        }
    }

    private object HandleRequest(JsonElement request)
    {
        var id = GetOptionalString(request, "id") ?? GetOptionalString(request, "requestId") ?? string.Empty;
        var command = GetOptionalString(request, "command") ?? string.Empty;
        var payload = request.TryGetProperty("payload", out var payloadEl) ? payloadEl : default;

        if (string.Equals(command, "vault.status.get", StringComparison.OrdinalIgnoreCase))
        {
            return new
            {
                ok = true,
                id,
                command,
                result = new
                {
                    storePath = ResolveStorePath(),
                    nowUtc = DateTimeOffset.UtcNow
                }
            };
        }

        if (string.Equals(command, "vault.sync.resync", StringComparison.OrdinalIgnoreCase))
        {
            // For this scaffold, resync is a no-op.
            return new { ok = true, id, command, result = new { resync = true } };
        }

        if (string.Equals(command, "vault.login.list", StringComparison.OrdinalIgnoreCase))
        {
            var includeDeleted = GetOptionalBool(payload, "includeDeleted") ?? false;
            var store = LoadStore();
            var items = includeDeleted ? store.items : store.items.Where(i => !i.deleted).ToArray();
            return new { ok = true, id, command, result = new { items } };
        }

        if (string.Equals(command, "vault.login.save", StringComparison.OrdinalIgnoreCase))
        {
            var title = GetOptionalString(payload, "title") ?? string.Empty;
            var username = GetOptionalString(payload, "username") ?? string.Empty;
            var password = GetOptionalString(payload, "password") ?? string.Empty;
            var url = GetOptionalString(payload, "url") ?? string.Empty;
            var notes = GetOptionalString(payload, "notes") ?? string.Empty;

            var store = LoadStore();
            var now = DateTimeOffset.UtcNow;
            var item = new VaultItem
            {
                itemId = Guid.NewGuid().ToString("N"),
                title = title,
                username = username,
                password = password,
                url = url,
                notes = notes,
                createdAt = now,
                updatedAt = now,
                deleted = false
            };
            store.items = store.items.Append(item).ToArray();
            SaveStore(store);
            return new { ok = true, id, command, result = new { itemId = item.itemId } };
        }

        if (string.Equals(command, "vault.login.update", StringComparison.OrdinalIgnoreCase))
        {
            var itemId = GetOptionalString(payload, "itemId") ?? string.Empty;
            if (string.IsNullOrWhiteSpace(itemId))
            {
                return new { ok = false, id, command, error = "invalid_argument", detail = "itemId is required." };
            }

            var store = LoadStore();
            var index = Array.FindIndex(store.items, i => string.Equals(i.itemId, itemId, StringComparison.OrdinalIgnoreCase));
            if (index < 0)
            {
                return new { ok = false, id, command, error = "not_found", detail = "itemId was not found." };
            }

            var now = DateTimeOffset.UtcNow;
            var existing = store.items[index];
            existing.title = GetOptionalString(payload, "title") ?? existing.title;
            existing.username = GetOptionalString(payload, "username") ?? existing.username;
            existing.password = GetOptionalString(payload, "password") ?? existing.password;
            existing.url = GetOptionalString(payload, "url") ?? existing.url;
            existing.notes = GetOptionalString(payload, "notes") ?? existing.notes;
            existing.updatedAt = now;
            store.items[index] = existing;
            SaveStore(store);
            return new { ok = true, id, command, result = new { itemId = existing.itemId } };
        }

        if (string.Equals(command, "vault.login.delete", StringComparison.OrdinalIgnoreCase))
        {
            var itemId = GetOptionalString(payload, "itemId") ?? string.Empty;
            if (string.IsNullOrWhiteSpace(itemId))
            {
                return new { ok = false, id, command, error = "invalid_argument", detail = "itemId is required." };
            }

            var store = LoadStore();
            var index = Array.FindIndex(store.items, i => string.Equals(i.itemId, itemId, StringComparison.OrdinalIgnoreCase));
            if (index < 0)
            {
                return new { ok = false, id, command, error = "not_found", detail = "itemId was not found." };
            }

            var existing = store.items[index];
            existing.deleted = true;
            existing.updatedAt = DateTimeOffset.UtcNow;
            store.items[index] = existing;
            SaveStore(store);
            return new { ok = true, id, command, result = new { itemId = existing.itemId } };
        }

        return new { ok = false, id, command, error = "not_implemented", detail = "Unsupported command." };
    }

    private VaultStore LoadStore()
    {
        var path = ResolveStorePath();
        if (!File.Exists(path))
        {
            return new VaultStore { items = Array.Empty<VaultItem>() };
        }

        var json = File.ReadAllText(path);
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("items", out var itemsEl) && itemsEl.ValueKind == JsonValueKind.Array)
        {
            var items = new List<VaultItem>();
            foreach (var el in itemsEl.EnumerateArray())
            {
                if (el.ValueKind != JsonValueKind.Object) continue;
                items.Add(VaultItem.FromJson(el));
            }
            return new VaultStore { items = items.ToArray() };
        }

        return new VaultStore { items = Array.Empty<VaultItem>() };
    }

    private void SaveStore(VaultStore store)
    {
        var path = ResolveStorePath();
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrWhiteSpace(dir))
        {
            Directory.CreateDirectory(dir);
        }

        var payload = new
        {
            version = 1,
            updatedAtUtc = DateTimeOffset.UtcNow,
            items = store.items
        };
        var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(path, json);
    }

    private sealed class VaultStore
    {
        public VaultItem[] items { get; set; } = Array.Empty<VaultItem>();
    }

    private static string ResolveStorePath()
    {
        var env = Environment.GetEnvironmentVariable("TSUPASSWD_VAULT_STORE_PATH");
        if (!string.IsNullOrWhiteSpace(env))
        {
            return env;
        }

        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return Path.Combine(localAppData, DefaultAppDirName, DefaultStoreFileName);
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

    private static async Task<int> ReadExactAsync(Stream stream, byte[] buffer, CancellationToken cancellationToken)
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

    private async Task WriteMessageAsync(object payload, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(payload);
        var length = BitConverter.GetBytes(json.Length);

        await _stdout.WriteAsync(length.AsMemory(0, 4), cancellationToken);
        await _stdout.WriteAsync(json.AsMemory(0, json.Length), cancellationToken);
        await _stdout.FlushAsync(cancellationToken);
    }

    private static string? GetOptionalString(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object) return null;
        if (!element.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.String)
        {
            return null;
        }
        return value.GetString();
    }

    private static bool? GetOptionalBool(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object) return null;
        if (!element.TryGetProperty(propertyName, out var value))
        {
            return null;
        }

        if (value.ValueKind == JsonValueKind.True || value.ValueKind == JsonValueKind.False)
        {
            return value.GetBoolean();
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var num))
        {
            return num != 0;
        }

        return null;
    }

    private struct VaultItem
    {
        public string itemId { get; set; }
        public string title { get; set; }
        public string username { get; set; }
        public string password { get; set; }
        public string url { get; set; }
        public string notes { get; set; }
        public DateTimeOffset createdAt { get; set; }
        public DateTimeOffset updatedAt { get; set; }
        public bool deleted { get; set; }

        public static VaultItem FromJson(JsonElement el)
        {
            var item = new VaultItem
            {
                itemId = GetString(el, "itemId"),
                title = GetString(el, "title"),
                username = GetString(el, "username"),
                password = GetString(el, "password"),
                url = GetString(el, "url"),
                notes = GetString(el, "notes"),
                deleted = GetBool(el, "deleted")
            };

            item.createdAt = GetDate(el, "createdAt");
            item.updatedAt = GetDate(el, "updatedAt");
            return item;
        }

        private static string GetString(JsonElement el, string name)
        {
            if (el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
            {
                return v.GetString() ?? string.Empty;
            }
            return string.Empty;
        }

        private static bool GetBool(JsonElement el, string name)
        {
            if (el.TryGetProperty(name, out var v))
            {
                if (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False) return v.GetBoolean();
                if (v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var num)) return num != 0;
            }
            return false;
        }

        private static DateTimeOffset GetDate(JsonElement el, string name)
        {
            if (el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String && DateTimeOffset.TryParse(v.GetString(), out var dt))
            {
                return dt;
            }
            return DateTimeOffset.MinValue;
        }
    }
}
