class ApiError extends Error {
  constructor(statusCode, message, details = null, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;
  }

  static badRequest(message = 'Bad Request', details = null) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Forbidden') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Not Found') {
    return new ApiError(404, message);
  }

  static conflict(message = 'Conflict', code = null) {
    return new ApiError(409, message, null, code);
  }

  /** Regra de negócio / pré-condição não satisfeita (ex.: reconciliação sem divergência). */
  static unprocessable(message = 'Unprocessable', code = null) {
    return new ApiError(422, message, null, code);
  }

  static serviceUnavailable(message = 'Serviço indisponível', code = 'SERVICE_UNAVAILABLE') {
    return new ApiError(503, message, null, code);
  }
}

module.exports = ApiError;
