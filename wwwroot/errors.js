// Maps Violation API failure reasons (status.description) to user-facing messages.
const ERROR_MESSAGES = {
  InvalidLogin: 'The login number is not valid',
  InvalidRelatedLogin: 'The related login is not valid or is the same as the login',
  InvalidPagination: 'The page number or page size is not valid',
  InvalidWindow: 'Seconds before/after must be between 0 and 120',
  InvalidVolumeTolerance: 'The volume tolerance must be between 0 and 100 percent',
  MinimumShareRequired: 'Enter a minimum share percentage or a minimum share count',
  RelatedAccountNotFound: 'No account was found for the related login',
  AccountNotFound: 'No account was found for this login',
  AccountSelectionAmbiguous: 'More than one account exists for this login',
  AccountTimeRangeNotReady: 'The data range of this account is not ready yet',
  AccountTimeRangeInvalid: 'The data range of this account is not valid',
  TypeRequired: 'Select a type (IP or CID)',
};

const TIMEOUT_STATUS_CODE = 601;
const TIMEOUT_MESSAGE = 'The request timed out. Narrow the filters and try again';

// Returns the message for a ResponseBase status; unknown reasons fall back to the raw description.
function translateStatus(status) {
  if (!status) return '';
  if (status.code === TIMEOUT_STATUS_CODE) return TIMEOUT_MESSAGE;
  return ERROR_MESSAGES[status.description] ?? status.description ?? status.value ?? '';
}
