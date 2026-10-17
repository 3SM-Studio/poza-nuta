import {defineConfig} from 'vitest/config';
import {assertNoCloudEnvironmentFiles} from './scripts/local-environment-files.ts';
assertNoCloudEnvironmentFiles();
export default defineConfig({test:{environment:'node',include:['tests/postgres/realtimeQueueScope.integration.test.ts','tests/postgres/releaseMigrationWindow.integration.test.ts'],testTimeout:180000,hookTimeout:180000,fileParallelism:false}});
