import { badRequest } from '../lib/errors.js';

/**
 * Validates req[source] with a zod schema and replaces it with the parsed
 * value, so handlers only ever see server-validated data.
 */
export const validate = (schema, source = 'body') => (req, res, next) => {
  const parsed = schema.safeParse(req[source]);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      field: issue.path.join('.') || source,
      message: issue.message
    }));
    return next(badRequest('Some fields need attention', details));
  }
  if (source === 'query') req.validatedQuery = parsed.data;
  else req[source] = parsed.data;
  next();
};
