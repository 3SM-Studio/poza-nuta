import {afterEach,it,expect,vi} from 'vitest';
import {fairEngine,insertQueue,proposeQueue} from '@/server/fair-queue-engine';
afterEach(()=>vi.unstubAllEnvs());
it('event pin survives a global v2 rollout; only legacy is an emergency override',()=>{
 vi.stubEnv('KUNESTU_FAIR_QUEUE_ENGINE',undefined);
 expect(fairEngine('rotation-v2')).toBe('rotation-v2');expect(fairEngine('legacy')).toBe('legacy');
 vi.stubEnv('KUNESTU_FAIR_QUEUE_ENGINE','rotation-v2');expect(fairEngine('legacy')).toBe('legacy');
 vi.stubEnv('KUNESTU_FAIR_QUEUE_ENGINE','legacy');expect(fairEngine('rotation-v2')).toBe('legacy');
 vi.stubEnv('KUNESTU_FAIR_QUEUE_ENGINE',undefined);expect(fairEngine('rotation-v2')).toBe('rotation-v2');
 expect(proposeQueue([],'rotation-v2').order).toEqual([]);
 expect(()=>insertQueue([],42,'legacy')).toThrow('Fair insertion requires an approved request');
});
it('unknown overrides fail closed instead of silently selecting an algorithm',()=>{vi.stubEnv('KUNESTU_FAIR_QUEUE_ENGINE','typo');expect(()=>fairEngine('rotation-v2')).toThrow('Unknown Fair Queue engine');});
