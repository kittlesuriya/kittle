type PolicyEffect = "allow" | "deny"

export interface TieredExpressionOps<TExpression> {
  alwaysTrue(): TExpression
  alwaysFalse(): TExpression
  and(expressions: TExpression[]): TExpression
  or(expressions: TExpression[]): TExpression
  not(expression: TExpression): TExpression
}

export function buildTieredPolicyOutcome<TPolicy, TExpression>(args: {
  policies: TPolicy[]
  getPriority(policy: TPolicy): number
  getEffect(policy: TPolicy): PolicyEffect
  getMatch(policy: TPolicy): TExpression
  ops: TieredExpressionOps<TExpression>
}): TExpression {
  if (args.policies.length === 0) return args.ops.alwaysFalse()

  const groupedByPriority = new Map<number, TPolicy[]>()
  for (const policy of args.policies) {
    const priority = args.getPriority(policy)
    const tier = groupedByPriority.get(priority)
    if (tier) tier.push(policy)
    else groupedByPriority.set(priority, [policy])
  }

  const sortedPriorities = Array.from(groupedByPriority.keys()).sort(
    (a, b) => b - a
  )
  const allowAtTierClauses: TExpression[] = []
  let noHigherTierMatched = args.ops.alwaysTrue()

  for (const priority of sortedPriorities) {
    const tierPolicies = groupedByPriority.get(priority) ?? []
    const all: TExpression[] = []
    const allows: TExpression[] = []
    const denies: TExpression[] = []
    for (const policy of tierPolicies) {
      const match = args.getMatch(policy)
      all.push(match)
      if (args.getEffect(policy) === "allow") allows.push(match)
      else denies.push(match)
    }
    const tierMatched = args.ops.or(all)
    const tierAllowMatched = args.ops.or(allows)
    const tierDenyMatched = args.ops.or(denies)

    allowAtTierClauses.push(
      args.ops.and([
        noHigherTierMatched,
        tierAllowMatched,
        args.ops.not(tierDenyMatched),
      ])
    )

    noHigherTierMatched = args.ops.and([
      noHigherTierMatched,
      args.ops.not(tierMatched),
    ])
  }

  return args.ops.or(allowAtTierClauses)
}
