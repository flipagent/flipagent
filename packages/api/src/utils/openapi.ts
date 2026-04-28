/**
 * Helpers for wiring TypeBox schemas to hono-openapi route metadata.
 *
 *   - `tbCoerce`        — query/path validator that coerces strings to ints/numbers
 *                         (Hono yields raw strings; Value.Convert turns them typed).
 *                         hono-openapi's bundled validator skips coercion, hence this.
 *   - `paramsFor`       — expand a TypeBox object into OpenAPI parameter[] for
 *                         the given location, used inside describeRoute().
 *   - `errorResponse`   — shorthand for an `application/json` response that returns
 *                         the shared `ApiError` shape.
 *   - `jsonResponse`    — shorthand for an `application/json` response with a
 *                         resolved TypeBox schema body.
 */

import { ApiError } from "@flipagent/types";
import type { Static, TObject, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { ValidationTargets } from "hono";
import { validator as honoValidator } from "hono/validator";
import { validator as honoOpenApiValidator, resolver } from "hono-openapi/typebox";

export function tbCoerce<S extends TSchema>(target: "query" | "param", schema: S) {
	return honoValidator(target, (raw, c) => {
		const converted = Value.Convert(schema, raw);
		if (Value.Check(schema, converted)) return converted as Static<S>;
		return c.json(
			{
				error: "validation_failed" as const,
				details: [...Value.Errors(schema, converted)].map((e) => ({ path: e.path, message: e.message })),
			},
			400,
		);
	});
}

/**
 * `tbBody` wraps `hono-openapi/typebox` `validator("json", schema)` with the
 * shared `{ error: "validation_failed", details }` shape on failure, instead
 * of the default `{ success, errors }` shape.
 */
export function tbBody<S extends TSchema>(schema: S) {
	return honoOpenApiValidator("json" as keyof ValidationTargets, schema, (result, c) => {
		if (!result.success) {
			return c.json(
				{
					error: "validation_failed" as const,
					details: result.errors.map((e) => ({ path: e.path, message: e.message })),
				},
				400,
			);
		}
	});
}

export function paramsFor(location: "query" | "path", schema: TObject) {
	return Object.entries(schema.properties).map(([name, prop]) => ({
		in: location,
		name,
		required: location === "path" ? true : (schema.required?.includes(name) ?? false),
		schema: resolver(prop as TSchema),
	}));
}

export function jsonResponse(description: string, schema: TSchema) {
	return {
		description,
		content: {
			"application/json": { schema: resolver(schema) },
		},
	};
}

export function errorResponse(description: string) {
	return jsonResponse(description, ApiError);
}
