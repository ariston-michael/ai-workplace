import path from "node:path";
export function validateDeployment(env) {
  const errors = [];
  if (!env.PUBLIC_HOSTNAME || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(env.PUBLIC_HOSTNAME) || (!env.PUBLIC_HOSTNAME.includes(".") || !env.PUBLIC_HOSTNAME.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)))) errors.push("PUBLIC_HOSTNAME must be a public DNS hostname.");
  if (env.APP_BASE_URL !== `https://${env.PUBLIC_HOSTNAME}`) errors.push("APP_BASE_URL must match the public HTTPS hostname.");
  for (const name of ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET"]) if (!env[name] || /^(your-|replace-)/i.test(env[name])) errors.push(`${name} is missing or a placeholder.`);
  if (!/^[a-f0-9]{64}$/i.test(env.AUTH0_SECRET ?? "") || new Set(env.AUTH0_SECRET).size < 5) errors.push("AUTH0_SECRET must be 32 random bytes encoded as 64 hex characters.");
  if (env.PROCUREMENT_MODE !== "sample") errors.push("Public demo requires PROCUREMENT_MODE=sample.");
  if (env.SMS_MODE !== "simulated") errors.push("Public demo requires SMS_MODE=simulated.");
  if (!env.WORKPLACE_DB_PATH || !path.posix.normalize(env.WORKPLACE_DB_PATH).startsWith("/var/lib/ai-workplace/")) errors.push("WORKPLACE_DB_PATH must use the persistent data mount.");
  return errors;
}
if (process.argv[1]?.endsWith("validate-env.mjs")) {
  const errors = validateDeployment(process.env);
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
}
