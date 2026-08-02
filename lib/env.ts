import "server-only";

import {
  validateServerEnvironment,
  type ServerEnvironment,
} from "@/lib/validation/environment";

let cachedEnvironment: ServerEnvironment | undefined;

export function getServerEnvironment(): ServerEnvironment {
  cachedEnvironment ??= validateServerEnvironment(process.env);
  return cachedEnvironment;
}
