import {useEffect,useState} from 'react';
export function useRoundClock(state,category) {
  const [tick,setTick]=useState(Date.now());
  useEffect(()=>{const id=setInterval(()=>setTick(Date.now()),200);return()=>clearInterval(id);},[]);
  const now=state.serverNow && state.receivedAt ? state.serverNow+tick-state.receivedAt : tick;
  return {now,seconds:category.status==='paused'?Math.max(0,Math.ceil((category.remainingMs??60000)/1000)):category.status==='locked'?0:category.endsAt?Math.max(0,Math.ceil((category.endsAt-now)/1000)):category.durationSeconds||60};
}
