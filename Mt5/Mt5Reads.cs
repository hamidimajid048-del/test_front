namespace Sgb.Trading.Violation.Panel.Mt5;

public static class Mt5Reads
{
    public static void EnsureRead(MTRetCode result)
    {
        if (result is not (MTRetCode.MT_RET_OK or MTRetCode.MT_RET_OK_NONE or MTRetCode.MT_RET_ERR_NOTFOUND))
            throw new Mt5UnavailableException($"MetaTrader returned {result}.");
    }

    public static DateTime FromUnix(long seconds) => DateTimeOffset.FromUnixTimeSeconds(seconds).UtcDateTime;

    public static DateTime? FromUnixOrNull(long seconds) => seconds > 0 ? FromUnix(seconds) : null;
}
