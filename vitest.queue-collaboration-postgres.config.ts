import { defineConfig } from 'vitest/config';
import { assertNoCloudEnvironmentFiles } from './scripts/local-environment-files.ts';
assertNoCloudEnvironmentFiles();
export default defineConfig({test:{environment:'node',include:['tests/postgres/queueCollaboration.integration.test.ts','tests/postgres/participantPresentationMigration.integration.test.ts','tests/postgres/eventFairQueueEngine.integration.test.ts'],testTimeout:120000,hookTimeout:180000,fileParallelism:false}});
