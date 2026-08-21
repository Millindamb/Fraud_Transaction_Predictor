export default class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }

  static badRequest(msg = 'The request could not be understood.', details) {
    return new ApiError(400, msg, details);
  }
  static unauthorized(msg = 'Sign in to continue.') {
    return new ApiError(401, msg);
  }
  static forbidden(msg = 'This action needs a higher access level.') {
    return new ApiError(403, msg);
  }
  static notFound(msg = 'That record does not exist.') {
    return new ApiError(404, msg);
  }
}
