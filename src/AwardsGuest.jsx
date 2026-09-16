import React,{useState,useRef,useEffect} from 'react';
import {ArrowRight24Regular,Checkmark24Regular} from '@fluentui/react-icons';
import {canPredict,getRounds} from './awards-live-model.js';
import {themeText,themeStyle,themeLogo} from './awards-theme.js';

const lines=(text)=>text.split('\n').map((line,i,all)=><React.Fragment key={i}>{line}{i<all.length-1&&<br/>}</React.Fragment>);

export default function AwardsGuest({state,api,embedded=false}) {
  const [name,setName]=useState(''),[tableNumber,setTableNumber]=useState('');
  const [choice,setChoice]=useState(null),[notice,setNotice]=useState(''),[saving,setSaving]=useState(false);
  const [previewPicks,setPreviewPicks]=useState({});
  const versions=useRef({});
  const player=embedded?{name:'Your preview',tableNumber:'1',picks:{},drafts:previewPicks,pickVersions:{}}:state.players[0];
  const selectedId=state.active;
  const category=state.categories.find(c=>c.id===selectedId)||state.categories[0];
  const rounds=getRounds(state.categories),roundIndex=rounds.findIndex(r=>r.name===category.group),round=rounds[roundIndex];
  const questionIndex=round.questions.findIndex(c=>c.id===category.id);
  const [justStarted,setJustStarted]=useState(false);
  useEffect(()=>{
    const now=state.serverNow&&state.receivedAt?state.serverNow+Date.now()-state.receivedAt:Date.now();
    const remaining=category.status==='open'&&category.startedAt?Math.max(0,Math.min(5000,5000-(now-category.startedAt))):0;
    setJustStarted(remaining>0);const timeout=setTimeout(()=>setJustStarted(false),remaining);return()=>clearTimeout(timeout);
  },[category.id,category.status,category.startedAt]);
  const saved=player?.picks[category.id],draft=player?.drafts?.[category.id];
  const picked=choice||draft||saved;
  const canChoose=canPredict(state,category)&&!saving;
  useEffect(()=>{setChoice(null);setNotice('');},[category.id,category.startedAt,category.status]);
  useEffect(()=>{versions.current={};setChoice(null);setNotice('');setPreviewPicks({});},[player?.id,state.epoch]);
  const theme=state.theme;
  const vars={name:player?.name?player.name.split(' ')[0]:'everyone',table:player?.tableNumber||'',round:roundIndex+1,rounds:rounds.length,question:questionIndex+1,total:round.questions.length,category:category.name};
  const t=(key)=>themeText(theme,key,vars);
  async function join(e){
    e.preventDefault();if(saving)return;setSaving(true);
    try{await api.join(name.trim(),tableNumber.trim());setNotice('');}catch(e){setNotice(e.message);}finally{setSaving(false);}
  }
  async function select(nomineeId){
    if(!canChoose)return;setChoice(nomineeId);setSaving(true);setNotice('');
    try{
      if(embedded)setPreviewPicks(p=>({...p,[category.id]:nomineeId}));
      else {const result=await api.vote(category.id,nomineeId,versions.current[category.id]??player.pickVersions?.[category.id]??0);versions.current[category.id]=result.player.pickVersions[category.id];}
      setNotice(embedded?'Preview selection saved.':t('noticeSaved'));
    }catch(e){setChoice(null);setNotice(e.message);await api.refresh();versions.current={};}finally{setSaving(false);}
  }
  const closed=category.status==='locked';
  const footer=<footer className="aw-guest-footer"><p>{t('footer')}</p>{embedded&&<small>Interactive preview · selections are not counted</small>}</footer>;
  return <section className={`aw-guest aw-artwork ${embedded?'aw-embedded':''}`} style={themeStyle(theme)}>
    <div className="aw-guest-brand aw-custom-brand"><img className="aw-logo" src={themeLogo(theme)} alt={t('logoAlt')}/></div>
    {state.finalPublished?<>
      <div className="aw-game-end" role="status">
        <p className="aw-game-end-kicker">{t('endKicker')}</p>
        <h1>{lines(t('endTitle'))}</h1>
        <p>{lines(t('endMessage'))}</p>
        <p className="aw-game-end-note">{lines(t('endNote'))}</p>
      </div>
      {footer}
    </>:!player||!player.tableNumber?<><div className="aw-join">
      <h1>{lines(t('joinTitle'))}</h1>
      <p>{lines(t('joinIntro'))}</p>
      <form onSubmit={join}>
        <label>{t('joinNameLabel')}<input value={name} onChange={e=>setName(e.target.value)} maxLength={60} autoComplete="name" placeholder={t('joinNamePlaceholder')} required/></label>
        <label>{t('joinTableLabel')}<input value={tableNumber} onChange={e=>setTableNumber(e.target.value)} inputMode="numeric" pattern="[1-9][0-9]{0,3}" maxLength={4} placeholder={t('joinTablePlaceholder')} required/></label>
        <button className="aw-button" type="submit" disabled={saving||!state.serverConnected}>{saving?t('joinButtonBusy'):t('joinButton')}<ArrowRight24Regular/></button>
      </form>
      <small role="status">{notice||t('joinNote')}</small>
    </div>{footer}</>:<>
      <div className="aw-guest-score"><span>{embedded?'Guest preview':t('greeting')}</span><span>{t('tableLabel')}</span></div>
      {state.screen==='round'?<div className="aw-round-separator" role="status"><p>{t('roundLabel')}</p><h1>{round.name}</h1><span>{t('roundQuestions')}</span><p>{lines(t('roundMessage'))}</p></div>:<div className="aw-ballot">
        {justStarted&&<div className="aw-category-announcement" role="status">{t('categoryStart')}</div>}
        <div className="aw-round-label">{t('roundLabel')} · {round.name}</div>
        <div className="aw-ballot-meta"><span>{t('questionLabel')}</span><span>{category.status==='waiting'?t('statusWaiting'):closed?t('statusClosed'):''}</span></div>
        <h1>{t('ballotTitle')}</h1><h2>{category.name}</h2>
        {(category.status==='waiting'||closed)&&<p className="aw-ballot-instruction">{lines(category.status==='waiting'?t('instructionWaiting'):t('instructionClosed'))}</p>}
        <div className="aw-nominees">{category.nominees.map(n=><button key={n.id} aria-pressed={picked===n.id} disabled={!canChoose} onClick={()=>select(n.id)} className={`aw-nominee ${picked===n.id?'selected':''}`}>
          <span className="aw-nominee-logo"><img className="aw-company-image" src={n.logo} alt={`${n.name} logo`}/></span>
          <span className="aw-nominee-label">{n.name}</span>
          <span className="aw-radio">{picked===n.id?<Checkmark24Regular/>:null}</span>
        </button>)}</div>
        <div className="aw-auto-submit" role="status">{saving?t('noticeSaving'):closed?(saved?t('noticeSubmitted'):embedded&&draft?'Preview complete — no vote counted.':t('noticeNone')):notice||(draft?t('noticeSaved'):category.status==='waiting'?t('noticeWaiting'):t('noticeChoose'))}</div>
      </div>}
      {footer}
    </>}
  </section>;
}
