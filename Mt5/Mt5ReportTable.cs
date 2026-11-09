namespace Sgb.Trading.Violation.Panel.Mt5;

public static partial class Mt5ReportTable
{
    public const int MaxPageSize = 50_000;

    private static readonly ConcurrentDictionary<Type, IReadOnlyDictionary<string, PropertyInfo>> Properties = new();

    public static Mt5TradeReportDto Page(IReadOnlyList<object> rows, Mt5TradeReportInput input, string defaultSortItem)
    {
        var pageSize = Math.Clamp(input.PageSize, 1, MaxPageSize);
        if (rows.Count == 0)
            return Result([], 0, 1, pageSize);

        var columns = ColumnsOf(rows[0].GetType());
        IEnumerable<object> filtered = rows;
        foreach (var (key, text) in input.Filters)
        {
            if (columns.TryGetValue(key, out var property) && text.Trim() is { Length: > 0 } query)
                filtered = filtered.Where(row => Matches(property.GetValue(row), query));
        }

        var sortProperty = input.SortItem is { } item && columns.TryGetValue(item, out var chosen) ? chosen : columns[defaultSortItem];
        var comparer = new Mt5ReportValueComparer(input.SortDescending);
        var sorted = filtered.OrderBy(row => sortProperty.GetValue(row), comparer).ToList();

        var totalPages = Math.Max(1, (int)Math.Ceiling(sorted.Count / (double)pageSize));
        var page = Math.Clamp(input.CurrentPage, 1, totalPages);
        return Result([.. sorted.Skip((page - 1) * pageSize).Take(pageSize)], sorted.Count, page, pageSize);
    }

    private static Mt5TradeReportDto Result(IReadOnlyList<object> items, int total, int page, int pageSize) =>
        new(items, new Mt5ReportPagingDto(new Mt5PageDto(pageSize, page, Math.Max(1, (int)Math.Ceiling(total / (double)pageSize))), total));

    private static IReadOnlyDictionary<string, PropertyInfo> ColumnsOf(Type type) =>
        Properties.GetOrAdd(type, rowType => rowType.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .ToDictionary(property => JsonNamingPolicy.CamelCase.ConvertName(property.Name), StringComparer.OrdinalIgnoreCase));

    private static bool Matches(object? value, string query)
    {
        if (ComparisonPattern().Match(query) is { Success: true } comparison)
        {
            var operand = comparison.Groups[2].Value.Trim();
            var order = value switch
            {
                DateTime time when DateTime.TryParse(operand, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var limit) => (int?)time.CompareTo(limit),
                IConvertible number and not (string or Enum or bool or DateTime) when double.TryParse(operand, NumberStyles.Float, CultureInfo.InvariantCulture, out var limit) => Convert.ToDouble(number, CultureInfo.InvariantCulture).CompareTo(limit),
                _ => null
            };
            if (order is { } result)
                return comparison.Groups[1].Value switch
                {
                    ">" => result > 0,
                    "<" => result < 0,
                    ">=" => result >= 0,
                    "<=" => result <= 0,
                    _ => result == 0
                };
        }

        return Text(value).Contains(query.Replace('_', ' '), StringComparison.OrdinalIgnoreCase);
    }

    private static string Text(object? value) => value switch
    {
        null => string.Empty,
        DateTime time => time.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
        Enum item => item.ToString().Replace('_', ' '),
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? string.Empty
    };

    [GeneratedRegex(@"^(>=|<=|>|<|=)\s*(.+)$")]
    private static partial Regex ComparisonPattern();
}
