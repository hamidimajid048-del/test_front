namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed class Mt5AccountBalanceWriter(Mt5ConnectionService mt5)
{
    public (MTRetCode Code, ulong DealId) Apply(ulong login, Mt5BalanceKindEnum kind, decimal amount, string comment) => mt5.RunManager(manager =>
    {
        var signed = (double)(kind == Mt5BalanceKindEnum.Deposit ? amount : -amount);
        var code = manager.DealerBalance(login, signed, (uint)CIMTDeal.EnDealAction.DEAL_BALANCE, comment, out var dealId);
        return (code, dealId);
    });
}
