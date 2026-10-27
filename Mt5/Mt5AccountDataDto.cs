namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5AccountDataDto(
    ulong Login,
    Mt5AccountSourceEnum Source,
    string Name,
    string Group,
    string Email,
    string Comment,
    bool IsEnabled,
    bool IsTradeEnabled,
    uint Leverage,
    DateTime? RegisteredAt,
    double? StartBalance,
    double Balance,
    double? Equity,
    double Credit,
    double NetProfit,
    double? GrowthPercent,
    double TotalDeposits,
    double TotalWithdrawals,
    int DealCount,
    IReadOnlyList<Mt5BalancePointDto> Chart);
