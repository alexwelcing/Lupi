export const EXPO_GO_EXECUTION_ENVIRONMENT = "storeClient";

export function canEnterNativeArRoute(
  executionEnvironment: string | null | undefined,
): boolean {
  return executionEnvironment !== EXPO_GO_EXECUTION_ENVIRONMENT;
}
