namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed class Mt5ReportValueComparer(bool descending) : IComparer<object?>
{
    public int Compare(object? x, object? y)
    {
        if (x is null || y is null)
            return (x is null).CompareTo(y is null);

        var order = x is string text && y is string other
            ? string.Compare(text, other, StringComparison.OrdinalIgnoreCase)
            : Comparer<object>.Default.Compare(x, y);
        return descending ? -order : order;
    }
}
