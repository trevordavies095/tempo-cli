/**
 * Read an optional process env var, treating blank and unsubstituted MCPB
 * `user_config` placeholders as unset.
 *
 * Claude Desktop injects `${user_config.*}` literally into the child env when
 * optional install-dialog fields are left blank. Those strings must not win
 * over config.toml.
 */
export function readOptionalEnv(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  if (/^\$\{user_config\.[^}]+\}$/.test(raw)) return undefined;
  return raw;
}
