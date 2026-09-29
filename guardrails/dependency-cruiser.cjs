/**
 * ActionDesk architecture import rules. LOCKED — see docs/architecture.md §5–6.
 * Run: npx depcruise --config guardrails/dependency-cruiser.cjs src
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'R2-anthropic-sdk-only-in-llm',
      comment: 'ADR-0002: the Anthropic SDK may only be imported in src/lib/llm/.',
      severity: 'error',
      from: { pathNot: '^src/lib/llm/' },
      to: { path: '@anthropic-ai/sdk' },
    },
    {
      name: 'R3-admin-client-restricted',
      comment: 'ADR-0001/0003: the service-role client may only be imported from src/lib/admin/.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/lib/admin/|^src/lib/supabase/admin\\.ts$' },
      to: { path: '^src/lib/supabase/admin\\.ts$' },
    },
    {
      name: 'R6-no-server-code-in-components',
      comment: 'ADR-0002/0004: components never import the LLM module or admin code.',
      severity: 'error',
      from: { path: '^src/components/' },
      to: { path: '^src/lib/(llm|admin)/|^src/lib/supabase/admin\\.ts$' },
    },
    {
      name: 'no-circular',
      comment: 'Circular dependencies make the layering meaningless.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  required: [
    {
      name: 'server-only-in-llm-and-admin',
      comment: 'ADR-0002: server modules must import "server-only" so the Next.js build fails if a client component pulls them in.',
      severity: 'error',
      module: {
        path: '^src/lib/(llm|admin)/[^/]+\\.ts$|^src/lib/supabase/admin\\.ts$',
        pathNot: '\\.(test|spec)\\.ts$',
      },
      to: { path: 'server-only' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
