/// <summary>
/// The version of the pages served from <c>wwwroot</c>: a short hash of every file's path and content. It changes with
/// any edit, however small, and is the same on every machine that holds the same files, so the version shown on the
/// server can be compared with the one of the source. Recomputed when asked, at most once every few seconds.
/// </summary>
internal sealed class FrontendVersion(IFileProvider webRoot, TimeProvider time)
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(5);
    private readonly Lock gate = new();
    private (string Value, DateTimeOffset At)? cached;

    public string Current
    {
        get
        {
            lock (gate)
            {
                var now = time.GetUtcNow();
                if (cached is { } known && now - known.At < Lifetime)
                    return known.Value;

                cached = (Compute(), now);
                return cached.Value.Value;
            }
        }
    }

    private string Compute()
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var path in Files("").Order(StringComparer.Ordinal))
        {
            hash.AppendData(Encoding.UTF8.GetBytes(path));
            using var stream = webRoot.GetFileInfo(path).CreateReadStream();
            var buffer = new byte[8192];
            int read;
            while ((read = stream.Read(buffer)) > 0)
                hash.AppendData(buffer.AsSpan(0, read));
        }

        return Convert.ToHexString(hash.GetHashAndReset())[..8].ToLowerInvariant();
    }

    private IEnumerable<string> Files(string directory)
    {
        foreach (var entry in webRoot.GetDirectoryContents(directory))
        {
            var path = directory.Length == 0 ? entry.Name : $"{directory}/{entry.Name}";
            if (!entry.IsDirectory)
                yield return path;
            else
                foreach (var nested in Files(path))
                    yield return nested;
        }
    }
}
