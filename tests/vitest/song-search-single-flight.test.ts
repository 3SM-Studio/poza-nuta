import { expect, test, vi } from "vitest";
import { createSongSearchSingleFlight } from "../../src/server/song-search-single-flight";

test("identical in-flight catalog queries share SQL, distinct cursors/databases do not, no completed result is cached", async () => {
  const coalesceSongSearch = createSongSearchSingleFlight<{items: number[]}>();
  const database = {}, other = {};
  const load = vi.fn(async () => ({ items: [1] }));
  const results = await Promise.all(Array.from({ length: 20 }, () => coalesceSongSearch(database, '[2,"queen",null]', load)));
  expect(load).toHaveBeenCalledTimes(1); expect(results).toHaveLength(20);
  await coalesceSongSearch(database, '[2,"queen",null]', load); expect(load).toHaveBeenCalledTimes(2);
  await Promise.all([coalesceSongSearch(other, 'a', load), coalesceSongSearch(database, 'a', load), coalesceSongSearch(database, 'b', load)]);
  expect(load).toHaveBeenCalledTimes(5);
});

test("coalesced errors reach every caller and permit a fresh subsequent attempt", async () => {
  const coalesceSongSearch = createSongSearchSingleFlight<number>();
  const database = {}, error = new Error("statement timeout");
  const load = vi.fn(async () => { throw error; });
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => coalesceSongSearch(database, 'q', load)));
  expect(load).toHaveBeenCalledTimes(1);
  expect(results.every(r => r.status === 'rejected' && r.reason === error)).toBe(true);
  expect(await coalesceSongSearch(database, 'q', async () => 8)).toBe(8);
});

test("pending distinct queries are bounded, duplicates join at capacity and capacity recovers",async()=>{
  const coalesce=createSongSearchSingleFlight<number>(), database={};
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const load=vi.fn(async()=>{await gate;return 1;});
  const pending=Array.from({length:128},(_,i)=>coalesce(database,String(i),load));
  const duplicate=coalesce(database,'0',load);
  await expect(coalesce(database,'overflow',load)).rejects.toMatchObject({status:503,code:'SERVICE_UNAVAILABLE'});
  release();expect(await duplicate).toBe(1);await Promise.all(pending);
  expect(load).toHaveBeenCalledTimes(128);
  expect(await coalesce(database,'after',async()=>2)).toBe(2);
});
