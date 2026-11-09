namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed class Mt5BulkBalanceService(
    Mt5ConnectionService mt5, Mt5AccountBalanceWriter writer, Mt5ChangeLog changeLog, TimeProvider timeProvider)
{
    public const int MaxRows = 5000;
    public const int MaxRowsPerApply = 100;
    private static readonly TimeSpan AttemptLifetime = TimeSpan.FromDays(1);

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly ConcurrentDictionary<string, (ulong Deal, DateTimeOffset At)> _attempts = new();

    public IReadOnlyList<Mt5BulkBalanceRowDto> Check(IReadOnlyList<Mt5BulkBalanceRowInput> rows) => mt5.RunManager(manager =>
    {
        using var user = manager.UserCreate();
        Dictionary<(ulong, Mt5BalanceKindEnum, decimal), int> firstRows = [];
        List<Mt5BulkBalanceRowDto> result = [];
        foreach (var row in rows)
        {
            if (Validate(row, out var login, out var kind, out var amount, out var comment) is { } error)
            {
                result.Add(Result(row, null, null, Mt5BulkBalanceStatusEnum.Invalid, null, error));
                continue;
            }

            if (manager.UserGet(login, user) != MTRetCode.MT_RET_OK && manager.UserRequest(login, user) != MTRetCode.MT_RET_OK)
            {
                result.Add(Result(row, kind, amount, Mt5BulkBalanceStatusEnum.Invalid, null, "No live account was found for this number."));
                continue;
            }

            var balance = Math.Round(user.Balance(), 2);
            var message = firstRows.TryGetValue((login, kind, amount), out var first)
                ? $"Same account, operation and amount as row {first}."
                : kind == Mt5BalanceKindEnum.Withdrawal && (double)amount > balance
                    ? "The withdrawal is more than the balance."
                    : string.Empty;
            firstRows.TryAdd((login, kind, amount), row.Row);
            result.Add(Result(row, kind, amount, Mt5BulkBalanceStatusEnum.Ready, null, message) with
            {
                Name = user.Name(),
                Group = user.Group(),
                Balance = balance,
                Comment = comment
            });
        }

        return result;
    });

    public async Task<IReadOnlyList<Mt5BulkBalanceRowDto>> ApplyAsync(
        Guid batchId, IReadOnlyList<Mt5BulkBalanceRowInput> rows, HttpContext context, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var now = timeProvider.GetUtcNow();
            foreach (var (key, attempt) in _attempts)
                if (now - attempt.At > AttemptLifetime)
                    _attempts.TryRemove(key, out _);

            List<Mt5BulkBalanceRowDto> result = [];
            foreach (var row in rows)
                result.Add(await ApplyRowAsync(batchId, row, context, now));
            return result;
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<Mt5BulkBalanceRowDto> ApplyRowAsync(Guid batchId, Mt5BulkBalanceRowInput row, HttpContext context, DateTimeOffset now)
    {
        if (Validate(row, out var login, out var kind, out var amount, out var comment) is { } error)
            return Result(row, null, null, Mt5BulkBalanceStatusEnum.Invalid, null, error);

        var key = $"{batchId:N}:{row.Row}";
        if (_attempts.TryGetValue(key, out var earlier))
            return earlier.Deal == 0
                ? Result(row, kind, amount, Mt5BulkBalanceStatusEnum.AlreadySent, null, "Already sent in this batch with no answer from MetaTrader. Check the account before sending it again.")
                : Result(row, kind, amount, Mt5BulkBalanceStatusEnum.AlreadySent, earlier.Deal, "Already done in this batch.");

        var action = kind.ToString().ToLowerInvariant();
        var reference = $"bulk {batchId.ToString("N")[..8]} row {row.Row}";
        try
        {
            var (code, deal) = writer.Apply(login, kind, amount, comment);
            var succeeded = code is MTRetCode.MT_RET_OK or MTRetCode.MT_RET_REQUEST_DONE;
            var uncertain = code is MTRetCode.MT_RET_ERR_TIMEOUT or MTRetCode.MT_RET_ERR_NETWORK or MTRetCode.MT_RET_ERR_CONNECTION;
            if (succeeded || uncertain)
                _attempts[key] = (succeeded ? deal : 0, now);

            await changeLog.RecordAsync(login, action, succeeded,
                succeeded ? $"{amount:0.00}, deal {deal}, {comment}, {reference}" : $"{amount:0.00}, MetaTrader returned {code}, {comment}, {reference}", context);

            if (succeeded)
                return Result(row, kind, amount, Mt5BulkBalanceStatusEnum.Done, deal, "Done.");

            return uncertain
                ? Result(row, kind, amount, Mt5BulkBalanceStatusEnum.Unknown, null, $"MetaTrader did not answer ({code}). Check the account's deals before sending it again.")
                : Result(row, kind, amount, Mt5BulkBalanceStatusEnum.Failed, null, FailureMessage(code, action));
        }
        catch (Mt5UnavailableException exception)
        {
            await changeLog.RecordAsync(login, action, false, $"{exception.Message} {reference}", context);
            return Result(row, kind, amount, Mt5BulkBalanceStatusEnum.Failed, null, exception.Message);
        }
    }

    private static string FailureMessage(MTRetCode code, string action) => code switch
    {
        MTRetCode.MT_RET_ERR_NOTFOUND => "No live account was found for this number.",
        MTRetCode.MT_RET_REQUEST_NO_MONEY => "Not enough money on the account.",
        _ => $"MetaTrader did not accept the {action} ({code})."
    };

    private static Mt5BulkBalanceRowDto Result(
        Mt5BulkBalanceRowInput row, Mt5BalanceKindEnum? kind, decimal? amount, Mt5BulkBalanceStatusEnum status, ulong? deal, string message) =>
        new(row.Row, row.Login?.Trim() ?? string.Empty, row.Amount?.Trim() ?? string.Empty, row.Comment?.Trim() ?? string.Empty,
            kind, amount, null, null, null, status, deal, message);

    private static string? Validate(
        Mt5BulkBalanceRowInput row, out ulong login, out Mt5BalanceKindEnum kind, out decimal amount, out string comment)
    {
        kind = Mt5BalanceKindEnum.Deposit;
        amount = 0;
        comment = row.Comment?.Trim() ?? string.Empty;
        if (!ulong.TryParse(row.Login?.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out login) || login == 0)
            return "The login is not a valid account number.";

        var text = row.Amount?.Trim() ?? string.Empty;
        if (text.Contains(',') || text.Contains(' '))
            return "Write the amount without thousands separators, with a dot for decimals (for example 1000.50).";

        if (!decimal.TryParse(text, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var signed)
            || signed == 0 || decimal.Round(signed, 2) != signed || Math.Abs(signed) > Mt5AccountBalanceEndpoints.MaximumAmount)
            return "The amount must be a number other than zero with at most two decimals (negative for a withdrawal).";

        if (comment.Length is 0 or > Mt5AccountBalanceEndpoints.MaximumCommentLength)
            return $"A comment of 1 to {Mt5AccountBalanceEndpoints.MaximumCommentLength} characters is required.";

        kind = signed > 0 ? Mt5BalanceKindEnum.Deposit : Mt5BalanceKindEnum.Withdrawal;
        amount = Math.Abs(signed);
        return null;
    }
}
