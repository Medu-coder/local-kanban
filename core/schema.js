import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { DomainError } from "./errors.js";

export const schemaNames = Object.freeze([
  "project",
  "epic",
  "story",
  "criterion",
  "block",
  "evidence",
]);

const schemaDirectory = fileURLToPath(new URL("../schemas/v1/", import.meta.url));
const schemas = Object.fromEntries(
  schemaNames.map((name) => {
    const raw = fs.readFileSync(`${schemaDirectory}${name}.schema.json`, "utf8");
    return [name, JSON.parse(raw)];
  })
);

const ajv = new Ajv({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
  strict: true,
});

for (const schema of Object.values(schemas)) {
  ajv.addSchema(schema);
}

const validators = Object.fromEntries(
  schemaNames.map((name) => [name, ajv.getSchema(schemas[name].$id)])
);

function formatErrors(errors = []) {
  return errors.map((error) => ({
    path: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message ?? "invalid value",
    params: error.params,
  }));
}

export function validateSchema(schemaName, value) {
  const validate = validators[schemaName];

  if (!validate) {
    throw new DomainError("schema_unknown", `Unknown schema: ${schemaName}`, {
      details: { schema: schemaName, available: schemaNames },
      status: 500,
    });
  }

  if (!validate(value)) {
    throw new DomainError("schema_invalid", `Invalid ${schemaName} document.`, {
      details: {
        schema: schemaName,
        errors: formatErrors(validate.errors),
      },
    });
  }

  return value;
}

export const validateProject = (value) => validateSchema("project", value);
export const validateEpic = (value) => validateSchema("epic", value);
export const validateStory = (value) => validateSchema("story", value);
export const validateCriterion = (value) => validateSchema("criterion", value);
export const validateBlock = (value) => validateSchema("block", value);
export const validateEvidence = (value) => validateSchema("evidence", value);
