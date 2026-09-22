export const loggerOptions = {
  redact: {
    censor: "[REDACTED]",
    paths: [
      "req.headers.authorization",
      "req.headers.x-api-key",
      "request.headers.authorization",
      "request.headers.x-api-key",
      "*.apiKey",
      "*.messages",
      "*.input",
      "*.toolArguments",
      "*.toolResult",
    ],
  },
};
