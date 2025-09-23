const { ZodError } = require("zod");

function formatZodIssues(issues) {
  return issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}

function parseWithSchema(schema, data) {
  const parsed = schema.safeParse(data);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  return {
    ok: false,
    issues: formatZodIssues(parsed.error.issues),
  };
}

function handleZodError(res, error, message = "Invalid request data") {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: message,
      details: formatZodIssues(error.issues),
    });
  }
  return null;
}

module.exports = {
  formatZodIssues,
  parseWithSchema,
  handleZodError,
};
