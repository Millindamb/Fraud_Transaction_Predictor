// Keeps every controller free of try/catch — rejections land in errorHandler
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
