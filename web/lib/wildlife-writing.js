// Adapted from main's writerHelp and WriteItUp comparison flow. Never use neighbour chat here.
import {writerHelp,assistantIsLive} from './api.js';
import {writingVariant} from '../public/wildlife/shared/writer-port.js';
export const parkWritingMode=assistantIsLive?'legacy-live':'legacy-fixture';
export async function parkWritingHelp({text,signal,variant=0}){
 if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 // Species unknown avoids fact candidates. Media, private rescue fields and post IDs
 // are deliberately absent. The shared input preflight rejects identifying details.
 const response=await writerHelp('unknown',text,{signal});
 if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 // Only draft wording is reused. Fun-fact candidates and model advice never enter the park UI.
 return {tidied_story:assistantIsLive?response?.tidied_story:response?.tidied_story?writingVariant(text,response.tidied_story,variant):null,question:null,mode:parkWritingMode};
}
