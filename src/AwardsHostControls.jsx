import React,{useEffect,useRef} from 'react';
import {ChevronLeft20Regular,ChevronRight20Regular,Play24Regular,Stop24Regular} from '@fluentui/react-icons';
import {getRounds,totals} from './awards-live-model.js';

export default function AwardsHostControls({state,api,category,onSelect}) {
  const initialized=useRef(false);
  useEffect(()=>{if(state.revision>=0&&!initialized.current){initialized.current=true;onSelect(state.active);}},[state.revision,state.active,onSelect]);
  const rounds=getRounds(state.categories),roundIndex=rounds.findIndex(r=>r.name===category.group),round=rounds[roundIndex];
  const index=state.categories.findIndex(c=>c.id===category.id);
  const current=state.categories.find(c=>c.id===state.active);
  const running=category.status==='open';
  const anotherRunning=current.id!==category.id&&['open','paused'].includes(current.status);
  const counts=totals(state,category),responses=counts.reduce((sum,n)=>sum+n.votes,0);
  const command=(type)=>void api.command({type,categoryId:category.id}).catch(()=>{});
  const allFinished=state.categories.every(c=>c.status==='locked');
  const status={waiting:'Ready to start',open:'Live for guests',paused:'Paused',locked:'Question finished'}[category.status]||'Question finished';
  return <div className="aw-simple-control">
    <div className="aw-control-summary"><p>{state.categories.filter(c=>c.status==='locked').length} of {state.categories.length} questions finished</p><p>{state.playerCount} participants</p></div>
    <nav className="aw-round-tabs" aria-label="Game rounds">{rounds.map((r,i)=><button key={r.id} className={round.id===r.id?'active':''} aria-current={round.id===r.id?'step':undefined} onClick={()=>onSelect((r.questions.find(c=>['open','paused'].includes(c.status))||r.questions.find(c=>c.status==='waiting')||r.questions[0]).id)}><span>Round {i+1}</span><b>{r.name}</b><small>{r.questions.length} questions</small></button>)}</nav>
    <div className="aw-round-intro-control"><div><b>{state.screen==='round'&&state.roundId===round.id?'Round introduction is showing':'Introduce '+round.name}</b><p>Shows the category name to all guests. Any open question will end and its selections will submit.</p></div><button className="aw-button aw-secondary" disabled={api.busy||state.finalPublished} onClick={()=>void api.command({type:'round',roundId:round.id}).catch(()=>{})}>Show round introduction</button></div>
    <section className="aw-question-desk" aria-label="Question controls">
      <nav className="aw-question-list" aria-label="Round questions">{round.questions.map((c,i)=><button key={c.id} onClick={()=>onSelect(c.id)} aria-current={c.id===category.id?'step':undefined} className={c.id===category.id?'selected':''}><span>Question {i+1}</span><b>{c.name}</b><small>{{waiting:'Ready',open:'Live',paused:'Paused',locked:'Finished'}[c.status]}</small></button>)}</nav>
      <div className="aw-question-work">
        <div className="aw-question-navigation"><button className="aw-button aw-secondary" disabled={index===0} onClick={()=>onSelect(state.categories[index-1].id)}><ChevronLeft20Regular/>Previous question</button><span>{index+1} / {state.categories.length}</span><button className="aw-button aw-secondary" disabled={index===state.categories.length-1} onClick={()=>onSelect(state.categories[index+1].id)}>Next question<ChevronRight20Regular/></button></div>
        <h2>{category.name}</h2>
        <div className="aw-desk-timer"><div><span className={`aw-status aw-status-${category.status}`}>{status}</span><p>{running?'Guests can choose until you end this question.':'Guests see this question when you start it.'}</p></div></div>
        {anotherRunning&&<p className="aw-other-question">{current.status==='paused'?'Paused':'Live'} now: <b>{current.name}</b>. Starting this question will submit selections and close that question. <button className="aw-text-button" onClick={()=>onSelect(current.id)}>Back to active question</button></p>}
        <div className="aw-desk-actions">
          {!running?<button className="aw-button" disabled={api.busy||state.finalPublished} onClick={()=>command('open')}><Play24Regular/>{category.status==='locked'?'Reopen question':'Start question'}</button>:<button className="aw-button" disabled={api.busy} onClick={()=>command('end')}><Stop24Regular/>End question</button>}
        </div>
        <p className="aw-desk-help">{state.finalPublished?'Game finalized. Use Game settings to clear the game before starting again.':running?'End question submits all saved selections and closes answering.':'Browse with Previous / Next, then press Start. Questions only change when you start them.'}</p>
        <div className="aw-answer-count">{running?state.draftCounts?.[category.id]||0:responses} <span>{running?'selections saved':'answers submitted'} · {category.nominees.length} nominees</span></div>
        <details className="aw-nominee-details"><summary>View nominees and answer totals</summary><div className="aw-desk-nominees">{counts.map(n=><div key={n.id}><img src={n.logo} alt={`${n.name} logo`}/><span>{n.name}</span><b>{n.votes} answers</b></div>)}</div></details>
      </div>
    </section>
    <div className="aw-end-game"><div><b>{state.finalPublished?'The game has ended':'End the game'}</b><p>{state.finalPublished?'Guests now see the closing page. Use Game settings to clear the game before starting again.':allFinished?'All questions are finished. Ending the game shows the closing page to every guest.':`Finish all ${state.categories.length} questions to end the game. ${state.categories.filter(c=>c.status==='locked').length} finished so far.`}</p></div><button className="aw-button" disabled={api.busy||state.finalPublished||!allFinished} onClick={()=>void api.command({type:'finalize'}).catch(()=>{})}>End the game</button></div>
  </div>;
}
