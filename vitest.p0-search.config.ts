import {defineConfig} from 'vitest/config';import {assertNoCloudEnvironmentFiles} from './scripts/local-environment-files.ts';assertNoCloudEnvironmentFiles();
export default defineConfig({test:{environment:'node',include:['tests/postgres/searchP0Catalog.integration.test.ts'],fileParallelism:false,testTimeout:600000}});
