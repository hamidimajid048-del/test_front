namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5EmailSearchDto(IReadOnlyList<Mt5AccountDto> Accounts, bool ArchiveAvailable);
