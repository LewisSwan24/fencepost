import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parkWritingHelp,parkWritingMode} from '../lib/wildlife-writing.js';
test('park writing adapter reuses the existing fixture writer without exposing fact candidates',async()=>{
 const result=await parkWritingHelp({text:'saw a possible possum in the park'});
 assert.equal(result.tidied_story,'Saw a possible possum in the park.');assert.equal(result.mode,'legacy-fixture');assert.equal(result.fun_facts,undefined);assert.equal(result.question,null);assert.equal(parkWritingMode,'legacy-fixture');
});
test('cancelled park writing requests do not apply a suggestion',async()=>{
 const controller=new AbortController();controller.abort();await assert.rejects(parkWritingHelp({text:'An animal rested.',signal:controller.signal}),{name:'AbortError'});
});
test('fixture writer offers another labelled wording variant without adding facts',async()=>{
 const first=await parkWritingHelp({text:'saw a possible possum in the park',variant:0});const next=await parkWritingHelp({text:'saw a possible possum in the park',variant:1});assert.notEqual(first.tidied_story,next.tidied_story);assert.equal(next.tidied_story,'I noticed a possible possum in the park.');assert.equal(next.fun_facts,undefined);
});
