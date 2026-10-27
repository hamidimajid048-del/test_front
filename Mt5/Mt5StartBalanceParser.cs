namespace Sgb.Trading.Violation.Panel.Mt5;

public static class Mt5StartBalanceParser
{
    public static double? Parse(string? comment)
    {
        if (string.IsNullOrWhiteSpace(comment))
            return null;

        var text = comment[(comment.LastIndexOf(':') + 1)..].Replace(",", string.Empty).Trim();
        return double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) && double.IsFinite(value) && value > 0
            ? value
            : null;
    }
}
