namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed class Mt5DealerSink : CIMTDealerSink
{
    private readonly TaskCompletionSource<Mt5DealerAnswerModel> _answer = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public Task<Mt5DealerAnswerModel> Answer => _answer.Task;

    public override void OnDealerAnswer(CIMTRequest request) =>
        _answer.TrySetResult(new Mt5DealerAnswerModel(request.ResultRetcode(), request.ResultDeal(), request.ResultPrice()));

    public override void OnDealerResult(CIMTConfirm result)
    {
        var code = result.Retcode();
        if (code is not (MTRetCode.MT_RET_OK or MTRetCode.MT_RET_REQUEST_INWAY or MTRetCode.MT_RET_REQUEST_ACCEPTED
            or MTRetCode.MT_RET_REQUEST_PROCESS or MTRetCode.MT_RET_REQUEST_PLACED or MTRetCode.MT_RET_REQUEST_DONE
            or MTRetCode.MT_RET_REQUEST_DONE_PARTIAL))
            _answer.TrySetResult(new Mt5DealerAnswerModel(code, 0, 0));
    }
}
