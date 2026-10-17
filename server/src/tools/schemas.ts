import { z } from "zod";

/**
 * A JSON value with its types spelled out. Declaring `z.any()` produces an
 * untyped schema, and some MCP clients then send every value as a string
 * ("2" instead of 2). Listing the types makes them send real JSON values.
 */
export const JsonValue = z.union([
  z.number(),
  z.boolean(),
  z.string(),
  z.null(),
  z.array(z.any()),
  z.record(z.string(), z.any()),
]);

/** Property name -> value map for node_add / node_set. */
export const PropertyMap = z.record(z.string(), JsonValue);
