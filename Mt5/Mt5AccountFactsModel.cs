namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5AccountFactsModel(
    Mt5AccountSourceEnum Source,
    string Name,
    string Group,
    string Email,
    string Comment,
    CIMTUser.EnUsersRights Rights,
    uint Leverage,
    DateTime? RegisteredAt,
    double Balance,
    double? Equity,
    double Credit);
