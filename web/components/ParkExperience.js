"use client";
import {useEffect,useRef} from 'react';

// Reuses the shared park workflow shipped with the static display. The old
// permissioned storyboard routes remain independent and retain their data layer.
export default function ParkExperience(){
 const root=useRef(null);
 useEffect(()=>{
  let cleanup,cancelled=false;
  const link=document.createElement('link');link.rel='stylesheet';link.href='/wildlife/shared/mobile.css';document.head.append(link);
  import(/* webpackIgnore: true */ '/wildlife/shared/mobile.js').then(async ({mount})=>{
   if(cancelled)return;
   const stop=await mount(root.current);
   if(cancelled)stop();else cleanup=stop;
  }).catch(()=>{if(root.current&&!cancelled)root.current.textContent='The park experience could not load. Please refresh and try again.';});
  return ()=>{cancelled=true;cleanup?.();link.remove();};
 },[]);
 return <div ref={root} aria-label="Fencepost park experience"><p>Loading local stories…</p></div>;
}
