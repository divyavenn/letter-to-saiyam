// Shared by the Playwright config, the test server and the tests.
import { tmpdir } from "node:os";
import path from "node:path";

export const PORT = 5181;
export const E2E_ROOT = path.join(tmpdir(), "letters-e2e");
