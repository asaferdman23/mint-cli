import { z } from 'zod';

export interface ToolContext {
  cwd: string;
  projectRoot: string;
  abortSignal?: AbortSignal;
}

export interface ToolResult {
  success: boolean;
  output: string;
  tokensUsed?: number;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
  execute(params: z.infer<z.ZodObject<z.ZodRawShape>>, context: ToolContext): Promise<ToolResult>;
}

/** Shape expected by LLM provider APIs (OpenAI function-calling format). */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

/** Convert a Tool to the provider-facing ToolDefinition. */
export function toToolDefinition(tool: Tool): ToolDefinition {
  const jsonSchema = zodToJsonSchema(tool.parameters);
  return {
    name: tool.name,
    description: tool.description,
    input_schema: jsonSchema,
  };
}

/**
 * Minimal zod-to-JSON-Schema converter for flat object schemas.
 * Handles string, number, boolean, and optional fields.
 */
function zodToJsonSchema(schema: z.ZodObject<z.ZodRawShape>): ToolDefinition['input_schema'] {
  const shape = schema.shape;
  const properties: Record<string, { type: string; description?: string }> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const field = value as z.ZodTypeAny;
    const { type, description, isOptional } = extractZodMeta(field);
    properties[key] = { type, ...(description ? { description } : {}) };
    if (!isOptional) required.push(key);
  }

  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

function extractZodMeta(field: z.ZodTypeAny): { type: string; description?: string; isOptional: boolean } {
  let current = field;
  let isOptional = false;
  let description: string | undefined;

  // Unwrap optional/default/describe wrappers
  while (true) {
    if (current._def.description) {
      description = current._def.description;
    }
    if (current instanceof z.ZodOptional || current instanceof z.ZodDefault) {
      isOptional = true;
      current = current._def.innerType;
      continue;
    }
    if (current instanceof z.ZodNullable) {
      current = current._def.innerType;
      continue;
    }
    break;
  }

  let type = 'string';
  if (current instanceof z.ZodNumber) type = 'number';
  else if (current instanceof z.ZodBoolean) type = 'boolean';

  return { type, description, isOptional };
}
