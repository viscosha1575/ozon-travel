function getMaxErrorStatus(error) {
  return error?.response?.status ?? error?.status ?? null;
}

function getMaxErrorCode(error) {
  return error?.response?.code ?? error?.code ?? '';
}

function getMaxErrorMessage(error) {
  return [
    error?.message,
    error?.response?.message,
    error?.response?.data?.message,
  ]
    .filter(Boolean)
    .join(' ');
}

function isChatDeniedError(error) {
  const status = getMaxErrorStatus(error);
  const code = getMaxErrorCode(error);
  const message = getMaxErrorMessage(error);

  return status === 403 && (
    code === 'chat.denied' ||
    message.includes('chat.denied') ||
    message.includes('error.dialog.suspended')
  );
}

export {
  getMaxErrorStatus,
  getMaxErrorCode,
  getMaxErrorMessage,
  isChatDeniedError,
};
