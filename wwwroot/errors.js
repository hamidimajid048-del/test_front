const ACCESS_MESSAGE = 'These reports are available to admins only';

// Maps Violation API failure reasons (status.description) to user-facing messages.
const ERROR_MESSAGES = {
  AdminRequired: ACCESS_MESSAGE,
  InvalidLogin: 'The login number is not valid',
  InvalidLogins: 'Send 1 to 100 valid login numbers',
  InvalidOtherLogins: 'Send 1 to 100 valid login numbers for the second email',
  OverlappingLogins: 'A login belongs to both emails, so they cannot be compared',
  InvalidRelatedLogin: 'The related login is not valid or is the same as the login',
  InvalidKind: 'The report kind is not valid',
  InvalidWindow: 'The time window is outside the allowed range',
  InvalidMatchLevel: 'The match level is not valid',
  InvalidVolumeTolerance: 'The volume tolerance must be between 0 and 100 percent',
  MinimumShareRequired: 'Enter a minimum share percentage or a minimum share count',
  InvalidMinimumShare: 'The minimum share percentage must be 0 to 100 and the minimum count at least 1',
  InvalidMinimum: 'Minimum filters cannot be negative',
  TypeRequired: 'Select a type (IP or CID)',
  InvalidType: 'The type is not valid',
  InvalidDirection: 'The direction is not valid',
  InvalidSignalSeverity: 'The signal severity is not valid',
  FilterTooLong: 'A filter is too long (200 characters at most)',
  TimeRangeIncomplete: 'Enter both the start and the end of the range, or neither',
  TimeRangeNotUtc: 'The range must be in UTC',
  TimeRangeReversed: 'The start of the range must not be after its end',
  InvalidPage: 'The page number is not valid',
  InvalidPageSize: 'The page size must be between 1 and 2000',
  InvalidSortBy: 'The sort column is not valid',
  InvalidSortDirection: 'The sort direction is not valid',
  RelatedAccountNotFound: 'No account was found for the related login',
  AccountNotFound: 'No account was found for this login',
  AccountSelectionAmbiguous: 'More than one account exists for this login',
  AccountTimeRangeNotReady: 'The data range of this account is not ready yet',
  AccountTimeRangeInvalid: 'The data range of this account is not valid',
};

const TIMEOUT_STATUS_CODE = 601;
const TIMEOUT_MESSAGE = 'The request timed out. Narrow the filters and try again';
// NotAllowed: the access check of the service or of the foundation's admin-only filter.
const NOT_ALLOWED_STATUS_CODE = 500;

// Returns the message for a ResponseBase status; unknown reasons fall back to the raw description.
function translateStatus(status) {
  if (!status) return '';
  if (status.code === TIMEOUT_STATUS_CODE) return TIMEOUT_MESSAGE;
  if (status.code === NOT_ALLOWED_STATUS_CODE) return ACCESS_MESSAGE;
  return ERROR_MESSAGES[status.description] ?? status.description ?? status.value ?? '';
}
