import {defineConfig} from 'vitest/config';
import {assertNoCloudEnvironmentFiles} from './scripts/local-environment-files.ts';
assertNoCloudEnvironmentFiles();
export default defineConfig({test:{environment:'node',include:['tests/postgres/queueSyncLatency.integration.test.ts'],testTimeout:240000,fileParallelism:false}});
