import pathlib, subprocess, json, os, time, hashlib, concurrent.futures, statistics, signal
ROOT=pathlib.Path(os.environ.get('ANAMNESIS_BENCHMARK_OUTPUT','/private/tmp/anamnesis-policy-benchmark'))
ROOT.mkdir(parents=True,exist_ok=True)
REPO=pathlib.Path(os.environ.get('ANAMNESIS_BENCHMARK_REPO', str(pathlib.Path(__file__).resolve().parents[3])))
HOME=ROOT/'codex-home'; HOME.mkdir(exist_ok=True)
auth=pathlib.Path(os.environ.get('CODEX_HOME',str(pathlib.Path.home()/'.codex')))/'auth.json'
if not (HOME/'auth.json').exists(): (HOME/'auth.json').symlink_to(auth)
ENV=dict(os.environ,CODEX_HOME=str(HOME))
MODEL='gpt-6-astra'
versions=['1.24.2','1.24.3']
policies={v:subprocess.check_output(['git','show',f'v{v}:base/content/agents.snippet.md'],cwd=REPO,text=True) for v in versions}
SCHEMA={'type':'object','properties':{'ttl':{'type':'integer'}},'required':['ttl'],'additionalProperties':False}
(ROOT/'schema.json').write_text(json.dumps(SCHEMA))
manifest={'model':MODEL,'reasoning_effort':'high','repetitions':2,'conditions':versions,'policy_sha256':{v:hashlib.sha256(p.encode()).hexdigest() for v,p in policies.items()},'scope':'Baseline AGENTS instruction change only; real anamnesis 1.24.3 retrieval engine held constant; no native hooks; isolated synthetic fixtures, no user instructions/MCP; cold sessions; not end-to-end version or startup-hook benchmark','scenarios':['known-read','known-edit','missing-evidence'],'order':'round 1 old then new, round 2 new then old; scenarios parallel up to 2; independent fixtures'}
(ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2))
def write(root,name,data):
 p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(data)
def run(scenario,rep,version):
 name=f'{scenario}-r{rep}-{version}';root=ROOT/'fixtures'/name;root.mkdir(parents=True,exist_ok=True)
 write(root,'AGENTS.md',policies[version])
 write(root,'Agentfile','version: 1\nproject: { name: policy-benchmark }\ntools: [codex]\nfragments:\n  - id: base\n    version: 28\n')
 write(root,'.anamnesis/ontology/base.yaml','entities:\n  cache:\n    description: Synthetic cache settings.\ninvariants:\n  - Keep retries unchanged.\n')
 write(root,'config.json','{"ttl": 10, "retries": 3}\n')
 marker='CACHE_POLICY_CURRENT_V1'
 expected=45
 if scenario=='missing-evidence':
  write(root,'docs/legacy.md','# Cache policy (obsolete)\nThis document is obsolete. It does not establish the current TTL. Retrieve the current cache policy before editing.\nLegacy TTL was 20.\n')
  write(root,'docs/cache-policy.md',f'# Current cache policy\n{marker}\nThe current authoritative cache TTL is 90 seconds. Preserve retries.\n')
  prompt='Update config.json to the current cache TTL. docs/legacy.md is an old starting pointer and may be stale. Preserve retries. Return the resulting TTL as JSON.'
  expected=90
 else:
  write(root,'docs/cache-policy.md',f'# Current cache policy\n{marker}\nThe current authoritative cache TTL is 45 seconds. Preserve retries.\n')
  prompt=('Read docs/cache-policy.md and return its current cache TTL as JSON. Do not modify files.' if scenario=='known-read' else 'Update config.json TTL to match the current authoritative specification in docs/cache-policy.md. Preserve retries. Return the resulting TTL as JSON.')
 prompt+=' Work only in this synthetic fixture. Do not use the network or delegate. Use the installed anamnesis CLI if your project instructions require retrieval. Do not change AGENTS.md, Agentfile, or source documents.'
 cmd=['codex','exec','--json','--ephemeral','--ignore-user-config','--ignore-rules','--sandbox','workspace-write','--skip-git-repo-check','--model',MODEL,'-c','model_reasoning_effort="high"','--output-schema',str(ROOT/'schema.json'),'-C',str(root),'-']
 start=time.monotonic();p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV,start_new_session=True)
 timedout=False
 try: stdout,stderr=p.communicate(prompt,timeout=180)
 except subprocess.TimeoutExpired:
  timedout=True;os.killpg(p.pid,signal.SIGTERM);stdout,stderr=p.communicate(timeout=15)
 elapsed=round(time.monotonic()-start,3)
 events=[]
 for line in stdout.splitlines():
  try: events.append(json.loads(line))
  except ValueError: pass
 commands=[];usage={};answer=None
 for e in events:
  if e.get('type')=='turn.completed':usage=e.get('usage',{})
  item=e.get('item',{})
  if e.get('type')=='item.completed' and item.get('type')=='command_execution':commands.append({'command':item.get('command',''),'exit_code':item.get('exit_code'),'output':item.get('aggregated_output','')})
  if e.get('type')=='item.completed' and item.get('type')=='agent_message':
   try:answer=json.loads(item.get('text',''))
   except ValueError:pass
 queries=[c for c in commands if 'anamnesis context query' in c['command']]
 reads=[i for i,c in enumerate(commands) if marker in c['output'] and 'anamnesis context query' not in c['command']]
 config=json.loads((root/'config.json').read_text())
 correct=answer=={'ttl':expected} and config==({'ttl':10,'retries':3} if scenario=='known-read' else {'ttl':expected,'retries':3})
 protected=(root/'AGENTS.md').read_text()==policies[version]
 result={'id':name,'scenario':scenario,'repetition':rep,'version':version,'exit_code':p.returncode,'timeout':timedout,'elapsed_seconds':elapsed,'usage':usage,'answer':answer,'config':config,'task_correct':correct,'original_source_observed':bool(reads),'protected_policy_unchanged':protected,'query_calls':len(queries),'tool_calls':len(commands),'source_output_occurrences':len(reads),'commands':commands,'errors':[e for e in events if e.get('type') in ['error','turn.failed']],'stderr_tail':stderr[-1500:] if p.returncode else ''}
 write(ROOT,'results/'+name+'.json',json.dumps(result,indent=2,ensure_ascii=False))
 print(json.dumps({k:v for k,v in result.items() if k not in ['commands','stderr_tail','errors']},ensure_ascii=False),flush=True)
 return result

def series(s):
 results=[]
 for rep in [1,2]:
  for v in (versions if rep==1 else list(reversed(versions))):results.append(run(s,rep,v))
 return results
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  results=sum(list(pool.map(series,manifest['scenarios'])),[])
 write(ROOT,'results.json',json.dumps(results,indent=2,ensure_ascii=False))
 print('DONE',len(results),flush=True)
