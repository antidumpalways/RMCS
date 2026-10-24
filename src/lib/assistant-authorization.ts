import { AsyncLocalStorage } from 'node:async_hooks';

// Scope elevation to a single confirmed assistant action. This keeps the
// ordinary server actions owner-only when called directly from the UI.
const assistantAuthorization = new AsyncLocalStorage<boolean>();

export function withAssistantAuthorization<T>(run: () => Promise<T>) {
  return assistantAuthorization.run(true, run);
}

export function isAssistantAuthorized() {
  return assistantAuthorization.getStore() === true;
}
