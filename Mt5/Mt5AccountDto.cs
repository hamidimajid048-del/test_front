namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5AccountDto(
    ulong Login, Mt5AccountSourceEnum Source, string? Name, string? Group, string? Email, double? Balance);
