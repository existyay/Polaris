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

export function registerPrimitive(ctx, { name, description, hint, skill, handler }) {
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
}
