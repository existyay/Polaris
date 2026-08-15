/**
 * Shared registration helper for 北极星 atomic primitive plugins.
 */

export function tokenize(rawInput) {
  const tokens = []
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = regex.exec(rawInput ?? '')) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3])
  }
  return tokens
}

export function registerPrimitive(ctx, { name, description, hint, skill, handler, tool }) {
  ctx.commands.register({
    name,
    description,
    input: { hint },
    handler: async (invocation) => {
      try {
        return await handler(invocation)
      } catch (error) {
        return { kind: 'error', text: `${name} failed: ${error?.message ?? error}` }
      }
    },
  })

  ctx.skills.register({
    name,
    description,
    content: skill,
  })

  if (tool !== undefined) {
    ctx.tools.register(tool)
  }
}

export function textTool(name, description, properties, execute) {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          report: { type: 'string' },
          ok: { type: 'boolean' },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: String(value.report ?? '') }]
      },
    },
    async execute(args) {
      const result = await execute(args ?? {})
      return {
        report: String(result.report ?? ''),
        ok: result.ok !== false,
      }
    },
  }
}
