import { join } from "path";
import type { UnifiedMcpRegistryServer } from "./mcp-registry.js";

export const OWX_PLUGIN_MCP_COMMAND = "owx";
export const OWX_PLUGIN_MCP_SERVE_SUBCOMMAND = "mcp-serve";

type OmxFirstPartyMcpSpec = {
  name: string;
  title: string;
  entrypoint: string;
  pluginTarget: string;
  startupTimeoutSec: number;
};

const OWX_FIRST_PARTY_MCP_SPECS: readonly OmxFirstPartyMcpSpec[] = [
  {
    name: "owx_state",
    title: "# OWX State Management MCP Server",
    entrypoint: "state-server.js",
    pluginTarget: "state",
    startupTimeoutSec: 5,
  },
  {
    name: "owx_memory",
    title: "# OWX Project Memory MCP Server",
    entrypoint: "memory-server.js",
    pluginTarget: "memory",
    startupTimeoutSec: 5,
  },
  {
    name: "owx_code_intel",
    title: "# OWX Code Intelligence MCP Server (LSP diagnostics, AST search)",
    entrypoint: "code-intel-server.js",
    pluginTarget: "code-intel",
    startupTimeoutSec: 10,
  },
  {
    name: "owx_trace",
    title: "# OWX Trace MCP Server (agent flow timeline & statistics)",
    entrypoint: "trace-server.js",
    pluginTarget: "trace",
    startupTimeoutSec: 5,
  },
  {
    name: "owx_wiki",
    title: "# OWX Wiki MCP Server (persistent project knowledge base)",
    entrypoint: "wiki-server.js",
    pluginTarget: "wiki",
    startupTimeoutSec: 5,
  },
  {
    name: "owx_hermes",
    title: "# OWX Hermes Coordination MCP Server (safe dispatch/status/artifacts)",
    entrypoint: "hermes-server.js",
    pluginTarget: "hermes",
    startupTimeoutSec: 5,
  },
] as const;

export const OWX_FIRST_PARTY_MCP_SERVER_NAMES = OWX_FIRST_PARTY_MCP_SPECS.map(
  (spec) => spec.name,
);

export const OWX_FIRST_PARTY_MCP_ENTRYPOINTS = OWX_FIRST_PARTY_MCP_SPECS.map(
  (spec) => spec.entrypoint,
);

export const OWX_FIRST_PARTY_MCP_PLUGIN_TARGETS = OWX_FIRST_PARTY_MCP_SPECS.map(
  (spec) => spec.pluginTarget,
);

export function resolveOmxFirstPartyMcpEntrypointForPluginTarget(
  target: string | undefined,
): string | null {
  if (typeof target !== "string") return null;
  const normalized = target.trim().toLowerCase();
  if (!normalized) return null;
  const spec = OWX_FIRST_PARTY_MCP_SPECS.find(
    (candidate) =>
      candidate.pluginTarget === normalized ||
      candidate.entrypoint === normalized,
  );
  return spec?.entrypoint ?? null;
}

export function getCurrentNodeExecutablePath(): string {
  return process.execPath;
}

export function getOmxFirstPartySetupMcpServers(
  pkgRoot: string,
): Array<UnifiedMcpRegistryServer & { title: string }> {
  return OWX_FIRST_PARTY_MCP_SPECS.map((spec) => ({
    name: spec.name,
    title: spec.title,
    command: getCurrentNodeExecutablePath(),
    args: [join(pkgRoot, "dist", "mcp", spec.entrypoint)],
    enabled: true,
    startupTimeoutSec: spec.startupTimeoutSec,
  }));
}

export function buildOmxPluginMcpManifest(
  options: { enabled?: boolean } = {},
): {
  mcpServers: Record<
    string,
    {
      command: string;
      args: string[];
      enabled: boolean;
    }
  >;
} {
  return {
    mcpServers: Object.fromEntries(
      OWX_FIRST_PARTY_MCP_SPECS.map((spec) => [
        spec.name,
        {
          command: OWX_PLUGIN_MCP_COMMAND,
          args: [OWX_PLUGIN_MCP_SERVE_SUBCOMMAND, spec.pluginTarget],
          enabled: options.enabled === true,
        },
      ]),
    ),
  };
}
