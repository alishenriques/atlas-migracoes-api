import { EnvelopArmorPlugin } from "@escape.tech/graphql-armor";
import { GraphQLError, visit, type ASTVisitor, type ValidationContext, type ValidationRule } from "graphql";

/**
 * Limits on what one request may ask, so a public endpoint cannot be used to
 * exhaust the Gemini free tier, Wikimedia's goodwill or the Neon free compute.
 * The Atlas app's own operations stay well inside them (see limits.test.ts).
 */
export const QUERY_LIMITS = {
  /** Artist → works → exhibitions → works … is cyclic; the app goes 4 levels deep. */
  maxDepth: 8,
  maxAliases: 10,
  maxTokens: 2000,
  maxCost: 5000,
} as const;

/**
 * `research` calls the open sources and Gemini, so one operation may ask for
 * one artist only: aliases or fragments would otherwise fan a single request
 * out over the whole collection.
 */
export function oneResearchPerOperation(context: ValidationContext): ASTVisitor {
  return {
    OperationDefinition(operation) {
      const keys = new Set<string>();
      for (const node of [operation, ...context.getRecursivelyReferencedFragments(operation)]) {
        visit(node, {
          Field(field) {
            if (field.name.value === "research") keys.add(field.alias?.value ?? field.name.value);
          },
        });
      }
      if (keys.size > 1) {
        context.reportError(
          new GraphQLError("Ask for one artist's research per request.", {
            nodes: operation,
            extensions: { code: "BAD_USER_INPUT" },
          }),
        );
      }
    },
  };
}

export function queryLimits() {
  const armor = EnvelopArmorPlugin({
    maxDepth: { n: QUERY_LIMITS.maxDepth },
    maxAliases: { n: QUERY_LIMITS.maxAliases },
    maxTokens: { n: QUERY_LIMITS.maxTokens },
    costLimit: { maxCost: QUERY_LIMITS.maxCost },
  });
  return [
    armor,
    {
      onValidate({ addValidationRule }: { addValidationRule: (rule: ValidationRule) => void }) {
        addValidationRule(oneResearchPerOperation);
      },
    },
  ];
}
