import json,pathlib,hashlib,re,collections
import argparse
parser=argparse.ArgumentParser(description='Audit local Codex continuity events; semantic review is still required.')
parser.add_argument('--output',type=pathlib.Path,required=True)
P=parser.parse_args().output.resolve()
EXPECTED={'sum-baseline':9,'sum-candidate':9,'sum-off':9,'maximum-off':-3,'maximum-candidate':-3,'maximum-baseline':-3,'cancel-candidate':12,'cancel-off':12}
rows=[]
for f in sorted(P.glob('final-*-result.json')):
 d=json.loads(f.read_text());label=f.stem[len('final-'):-len('-result')];event_file=P/f'final-{label}-events.jsonl';es=[json.loads(l) for l in event_file.open()] if event_file.exists() else []
 usage={};response_usage={};response_turns={};compaction_turns=set();response_conflicts=[];turns={};commands={};hooks=[];source_models=[]
 for e in es:
  method=e.get('method');p=e.get('params',{})
  if method=='thread/tokenUsage/updated':usage[p['threadId']]=p['tokenUsage']['total']
  if method=='rawResponse/completed':
   if p['responseId'] in response_usage and response_usage[p['responseId']]!=p['usage']:response_conflicts.append(p['responseId'])
   response_usage[p['responseId']]=p['usage'];response_turns[p['responseId']]=p['turnId']
  if method=='item/completed' and p['item']['type']=='contextCompaction':compaction_turns.add(p['turnId'])
  if method=='turn/completed':turns[p['turn']['id']]=p['turn']
  if method=='item/completed' and p['item']['type']=='commandExecution':commands[p['item']['id']]=p['item']
  if method=='hook/completed':hooks.append(p['run'])
 for rf in (P/f'final-home-{label}'/'sessions').rglob('*.jsonl'):
  own=None;models=[]
  for l in rf.open():
   item=json.loads(l)
   if item.get('type')=='session_meta' and own is None:own=item['payload']['id']
   if item.get('type')=='turn_context':models.append({'turn_id':item['payload'].get('turn_id'),'model':item['payload'].get('model'),'effort':item['payload'].get('effort',item['payload'].get('reasoning_effort'))})
  source_models.append({'thread_id':own,'turns':models})
 sums={k:sum(v.get(k,0) for v in usage.values()) for k in ['totalTokens','inputTokens','cachedInputTokens','outputTokens','reasoningOutputTokens']};sums['uncachedInputTokens']=sums['inputTokens']-sums['cachedInputTokens']
 response_sums={k:sum(v.get(k,0) for v in response_usage.values()) for k in sums if k!='uncachedInputTokens'}
 response_sums['uncachedInputTokens']=response_sums['inputTokens']-response_sums['cachedInputTokens']
 compact_usage={k:sum(v.get(k,0) for rid,v in response_usage.items() if response_turns[rid] in compaction_turns) for k in sums if k!='uncachedInputTokens'}
 compact_usage['uncachedInputTokens']=compact_usage['inputTokens']-compact_usage['cachedInputTokens']
 subs=d.get('submissions',[]);phase='resume' if d['case']=='cancel' else 'first';result_ok=subs==[{'phase':phase,'arguments':{'result':EXPECTED.get(label)}}]
 events_times=[e['time'] for e in es if e.get('method') in ['turn/started','turn/completed']]
 work=None
 try:work=json.loads(d.get('work_status',{}).get('stdout',''))['projection']
 except (ValueError,KeyError):pass
 texts=[entry.get('text','') for h in hooks for entry in h.get('entries',[])]
 mechanical_errors=[]
 phases=['first','question','fresh_session']+(['resume'] if d['case']=='cancel' else [])
 if label not in EXPECTED or label!=d['case']+'-'+d['arm']:mechanical_errors.append('unexpected case/arm')
 for phase_name in phases:
  phase_result=d.get(phase_name,{})
  if phase_result.get('status')!='completed' or turns.get(phase_result.get('turn_id'),{}).get('status')!='completed':mechanical_errors.append('missing or failed phase: '+phase_name)
 if len(compaction_turns)!=1 or not d.get('compact') or any(turns.get(t,{}).get('status')!='completed' for t in compaction_turns):mechanical_errors.append('missing or failed actual compaction')
 thread_ids={t.get('id') for t in d.get('threads',[])}
 if len(thread_ids)!=2 or any(t.get('model')!='gpt-6-astra' for t in d.get('threads',[])):mechanical_errors.append('missing independent Astra threads')
 observed={t['turn_id']:t for model in source_models for t in model['turns']}
 if not thread_ids.issubset({m['thread_id'] for m in source_models}):mechanical_errors.append('missing model provenance')
 for phase_name in phases:
  model=observed.get(d.get(phase_name,{}).get('turn_id'),{})
  if model.get('model')!='gpt-6-astra' or model.get('effort')!='high':mechanical_errors.append('model/effort mismatch: '+phase_name)
 if not {d.get(name,{}).get('turn_id') for name in phases}.issubset(set(response_turns.values())):mechanical_errors.append('missing response usage for required phase')
 dynamic=[e['params'] for e in es if e.get('method')=='item/tool/call']
 if sum(call.get('tool')=='await_records' for call in dynamic)!=1 or not d.get('steer'):mechanical_errors.append('missing pending-tool steering evidence')
 phase_for_turn={d.get(name,{}).get('turn_id'):name for name in phases}
 observed_submissions=[{'phase':phase_for_turn.get(call.get('turnId')),'arguments':call.get('arguments')} for call in dynamic if call.get('tool')=='submit_result']
 if observed_submissions!=subs:mechanical_errors.append('submission log disagrees with actual tool requests')
 if not response_usage or not usage or response_sums['totalTokens']<=0 or sums['totalTokens']<=0 or not thread_ids.issubset(usage):mechanical_errors.append('missing usage evidence')
 if any(d.get(k) for k in ['error','cleanup_error','source_error']):mechanical_errors.append('execution/cleanup/source failure')
 if pathlib.Path(str(event_file)+'.malformed').exists():mechanical_errors.append('malformed transport records')
 rows.append({'mechanical_errors':mechanical_errors,'label':label,'case':d['case'],'arm':d['arm'],'error':d.get('error'),'numeric_submission_pass':result_ok,'submissions':subs,'source_models':source_models,'usage':response_sums,'thread_usage_excluding_compaction':sums,'compaction_usage':compact_usage,'raw_response_conflicts':response_conflicts,'usage_totals_reconcile':all(sums[k]+compact_usage[k]==v for k,v in response_sums.items()),'elapsed_s_including_compaction_and_fresh_thread':max(events_times)-min(events_times) if events_times else None,'turn_duration_ms':sum(t.get('durationMs',0) or 0 for t in turns.values()),'commands':len(commands),'failed_commands':sum(c.get('exitCode') not in [0,None] for c in commands.values()),'dynamic_calls':sum(e.get('method')=='item/tool/call' for e in es),'native_compactions':sum(e.get('method')=='item/completed' and e['params']['item']['type']=='contextCompaction' for e in es),'hook_runs':dict(collections.Counter(h['eventName'] for h in hooks)),'capture_failures':sum('could not safely stage' in t for t in texts),'opaque_capture_tokens':len(set(re.findall(r'cap_[a-f0-9]{64}','\n'.join(texts)))),'answers':{k:d.get(k,{}).get('answers',[]) for k in ['first','question','resume','fresh_session']},'task_file':d.get('task_file'),'work':{k:work.get(k) for k in ['work_id','contract_revision','lifecycle','requirements','progress']} if work else None,'steer':d.get('steer')})
(P/'audit.json').write_text(json.dumps(rows,indent=2));print(json.dumps([{'label':r['label'],'pass':r['numeric_submission_pass'],'commands':r['commands'],'capture_failures':r['capture_failures'],'tokens':r['usage']['totalTokens'],'elapsed_s':r['elapsed_s_including_compaction_and_fresh_thread']} for r in rows],indent=2))

# Mechanical gates only; do not equate these with semantic review or superiority.
if {r['label'] for r in rows}!=set(EXPECTED) or any(r['mechanical_errors'] or r["error"] or not r["usage_totals_reconcile"] or r["raw_response_conflicts"] or (r["arm"]!="baseline" and not r["numeric_submission_pass"]) for r in rows):
 raise SystemExit(1)
