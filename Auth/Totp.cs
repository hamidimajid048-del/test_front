using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace Sgb.Trading.Violation.Panel.Auth;

/// <summary>Time-based one-time codes (RFC 6238: HMAC-SHA1, 6 digits, 30-second steps), as authenticator apps use.</summary>
public static class Totp
{
    private const int Digits = 6;
    private const int StepSeconds = 30;
    // Accepts the previous and next step as well, for clock drift between the server and the phone.
    private const int AllowedDriftSteps = 1;
    private const string Base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    /// <summary>The name authenticator apps show for the panel's accounts.</summary>
    public const string Issuer = "Violation Panel";

    public static string GenerateSecret() => ToBase32(RandomNumberGenerator.GetBytes(20));

    /// <summary>The secret in groups of four, as it is easier to type into an app.</summary>
    public static string FormatSecret(string secret) => string.Join(' ', secret.Chunk(4).Select(chunk => new string(chunk)));

    public static string ProvisioningUri(string account, string secret) =>
        $"otpauth://totp/{Uri.EscapeDataString(Issuer)}:{Uri.EscapeDataString(account)}" +
        $"?secret={secret}&issuer={Uri.EscapeDataString(Issuer)}&algorithm=SHA1&digits={Digits}&period={StepSeconds}";

    /// <summary>
    /// Returns the time step the code belongs to, or null for a wrong code. Steps up to <paramref name="lastUsedStep"/>
    /// are refused, so a code cannot be used twice.
    /// </summary>
    public static long? Verify(string secret, string code, DateTimeOffset now, long lastUsedStep)
    {
        if (code.Length != Digits || !code.All(char.IsAsciiDigit))
            return null;

        var key = FromBase32(secret);
        var currentStep = now.ToUnixTimeSeconds() / StepSeconds;
        long? matchedStep = null;
        // Every step is checked, so the time taken does not tell which one matched.
        for (var step = currentStep - AllowedDriftSteps; step <= currentStep + AllowedDriftSteps; step++)
        {
            var expected = Encoding.ASCII.GetBytes(Compute(key, step));
            if (CryptographicOperations.FixedTimeEquals(expected, Encoding.ASCII.GetBytes(code)) && step > lastUsedStep)
                matchedStep ??= step;
        }

        return matchedStep;
    }

    internal static string Compute(byte[] key, long step)
    {
        Span<byte> counter = stackalloc byte[8];
        BinaryPrimitives.WriteInt64BigEndian(counter, step);
        var hash = HMACSHA1.HashData(key, counter);
        var offset = hash[^1] & 0x0F;
        var value = (BinaryPrimitives.ReadInt32BigEndian(hash.AsSpan(offset)) & 0x7FFFFFFF) % 1_000_000;
        return value.ToString("D6");
    }

    private static string ToBase32(byte[] data)
    {
        var builder = new StringBuilder((data.Length * 8 + 4) / 5);
        int buffer = 0, bits = 0;
        foreach (var value in data)
        {
            buffer = (buffer << 8) | value;
            bits += 8;
            while (bits >= 5)
            {
                builder.Append(Base32Alphabet[(buffer >> (bits - 5)) & 31]);
                bits -= 5;
            }

            buffer &= (1 << bits) - 1;
        }

        if (bits > 0)
            builder.Append(Base32Alphabet[(buffer << (5 - bits)) & 31]);
        return builder.ToString();
    }

    private static byte[] FromBase32(string text)
    {
        var bytes = new List<byte>(text.Length * 5 / 8);
        int buffer = 0, bits = 0;
        foreach (var character in text.TrimEnd('=').ToUpperInvariant())
        {
            var index = Base32Alphabet.IndexOf(character);
            if (index < 0)
                throw new FormatException("The one-time code secret is not valid Base32.");

            buffer = (buffer << 5) | index;
            bits += 5;
            if (bits >= 8)
            {
                bytes.Add((byte)(buffer >> (bits - 8)));
                bits -= 8;
                buffer &= (1 << bits) - 1;
            }
        }

        return [.. bytes];
    }
}
