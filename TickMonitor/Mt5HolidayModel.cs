namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record Mt5HolidayModel(int Year, int Month, int Day, int WorkFromMinutes, int WorkToMinutes, string[] SymbolMasks)
{
    public bool WholeDay => WorkFromMinutes == WorkToMinutes;

    public bool AppliesTo(DateOnly date, string symbol, string path) =>
        (Year == 0 || Year == date.Year) && Month == date.Month && Day == date.Day &&
        SymbolMasks.Any(mask => Matches(mask, symbol) || Matches(mask, path));

    private static bool Matches(string mask, string value)
    {
        if (mask.Length == 0 || mask == "*")
            return true;
        var pattern = "^" + Regex.Escape(mask).Replace(@"\*", ".*").Replace(@"\?", ".") + "$";
        return Regex.IsMatch(value, pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }
}
