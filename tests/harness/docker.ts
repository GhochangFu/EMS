import { getContainerRuntimeClient } from "testcontainers";

/**
 * `F4.5` — does a container runtime answer? Only the answer feeds `testInfraMode`; what to do
 * without one (skip locally, refuse under `CI`) is decided there, not here.
 */
export async function dockerAnswers(): Promise<boolean> {
  try {
    await getContainerRuntimeClient();
    return true;
  } catch {
    return false;
  }
}
