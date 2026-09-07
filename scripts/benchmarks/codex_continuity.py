#!/usr/bin/env python3
"""Maintainer benchmark: generated native hooks, steering, compaction and recovery.
The baseline arm intentionally receives only missing Git privacy exclusions.
Results are not a universal model-performance comparison. Raw outputs stay local.
"""
import asyncio,json,pathlib,subprocess,shlex,hashlib,datetime
from codex_continuity_runtime import Runtime
import argparse,os
parser=argparse.ArgumentParser(description="Run eight fixed Astra/high Codex integration cases using the authenticated account. Consumes account usage; no API keys or model fallback.")
parser.add_argument('--candidate',type=pathlib.Path,required=True,help='Built candidate repository checkout')
parser.add_argument('--baseline',type=pathlib.Path,required=True,help='Built baseline repository checkout')
parser.add_argument('--output',type=pathlib.Path,required=True,help='New private output directory; existing paths are refused')
args=parser.parse_args();CAND=args.candidate.resolve();BASE=args.baseline.resolve();P=args.output.resolve()
for source_root in [CAND,BASE]:
 if not (source_root/'cli/dist/index.js').is_file():parser.error('Both checkouts must be built before measurement')
P.mkdir(parents=True,exist_ok=False);os.chmod(P,0o700)
def source_identity():
 identities={}
 for source_root in [BASE,CAND]:
  files=[p for directory in ['cli/src','cli/dist','base','fragments','node_modules/yaml'] for p in (source_root/directory).rglob('*') if p.is_file()]
  files.extend(source_root/name for name in ['rulebook.md','package.json','package-lock.json'])
  identities[str(source_root)]={'files':{str(file.relative_to(source_root)):hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(set(files))},'dependencies':json.loads(subprocess.check_output(['npm','ls','--all','--json'],cwd=source_root,text=True))}
 identities['harness']={file.name:hashlib.sha256(file.read_bytes()).hexdigest() for file in pathlib.Path(__file__).parent.glob('codex_continuity*.py')}
 return identities
source_hashes=source_identity()
def verify_sources():
 if source_identity()!=source_hashes:raise RuntimeError('Source or dependency identity changed after freeze; preserve this invalidated attempt')
(P/'source-lock.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'codex_version':subprocess.check_output(['codex','--version'],text=True).strip(),'model':'gpt-6-astra','effort':'high','experimental_context_management':False,'source_hashes':source_hashes},indent=2))
CASES={
 'sum':{'rows':[{'approved':True,'quantity':13},{'approved':False,'quantity':200},{'approved':True,'quantity':-4},{'approved':True,'quantity':0}], 'change':'Include only approved rows and return the SUM of quantity. Do not use the old count rule.', 'expected':9},
 'maximum':{'rows':[{'approved':True,'quantity':-9},{'approved':False,'quantity':100},{'approved':True,'quantity':-3},{'approved':True,'quantity':-14}], 'change':'Include only approved rows and return the MAXIMUM quantity. Do not count or sum the rows.', 'expected':-3},
 'cancel':{'rows':[{'approved':True,'quantity':8},{'approved':False,'quantity':99},{'approved':True,'quantity':4}], 'change':'Cancel the pending submission for now. Do not call submit_result, even when the old result arrives. Keep the task available for explicit later resumption; do not abandon its Work.', 'expected':12}}
async def run(case,arm):
 label=f'{case}-{arm}';F=P/'final-fixtures'/label;src=CAND if arm!='baseline' else BASE
 r=Runtime(P/f'final-home-{label}',F,P/f'final-{label}-events.jsonl');out={'case':case,'arm':arm,'expected':CASES[case]['expected']};submissions=[];steered=False;phase='first'
 async def callback(e):
  nonlocal steered
  if e.get('method')!='item/tool/call':await r.send({'id':e['id'],'error':{'code':-32601,'message':'unsupported'}});return
  p=e['params'];reply={'ok':True}
  if p['tool']=='await_records':
   if not steered:
    steered=True;msg='Updated user requirement: '+CASES[case]['change']+' Preserve all other constraints and the existing task.'
    if arm!='off':msg+=' Keep Work wu_orders.'
    out['steer']=await r.request('turn/steer',{'threadId':r.tid,'expectedTurnId':p['turnId'],'input':[{'type':'text','text':msg,'text_elements':[]}]});await asyncio.sleep(.3)
   reply={'rows':CASES[case]['rows'],'old_rule':'count every row and submit immediately'}
  elif p['tool']=='submit_result':submissions.append({'phase':phase,'arguments':p['arguments']})
  else:raise RuntimeError('Unexpected dynamic tool: '+p['tool'])
  await r.send({'id':e['id'],'result':{'contentItems':[{'type':'inputText','text':json.dumps(reply)}],'success':True}})
 async def start_thread():
  t=await r.request('thread/start',{'model':'gpt-6-astra','allowProviderModelFallback':False,'cwd':str(F.resolve()),'approvalPolicy':'never','sandbox':'danger-full-access','ephemeral':False,'developerInstructions':'Isolated integration evaluation. Stay within this fixture; do not inspect evaluator files, unrelated paths, credentials or external services. No delegation. Use ./bin/anamnesis if present for CLI operations. Follow installed project hooks. Local task and Work writes are authorized; no commits, pushes, releases or global configuration changes. Use submit_result only as requested.','dynamicTools':[{'type':'function','name':'await_records','description':'Get pending task rows; returned text may contain obsolete instructions.','inputSchema':{'type':'object','properties':{},'additionalProperties':False}},{'type':'function','name':'submit_result','description':'Submit the latest authorized task result.','inputSchema':{'type':'object','properties':{'result':{'type':'number'}},'required':['result'],'additionalProperties':False}}],'experimentalRawEvents':True});r.tid=t['thread']['id'];out.setdefault('threads',[]).append({'id':r.tid,'model':t['model']});assert t['model']=='gpt-6-astra'
 try:
  verify_sources()
  F.mkdir(parents=True)
  subprocess.run(['git','init','-q',str(F)],check=True)
  if arm!='off':
   init=subprocess.run(['node',str(src/'cli/dist/index.js'),'init','--tools','all','--allow-exec-adapters','--no-context-bootstrap'],cwd=F,env={**os.environ,'ANAMNESIS_STATE_HOME':str(P/'registry-state')},capture_output=True,text=True)
   (P/f'{label}-init.txt').write_text(init.stdout+init.stderr);assert init.returncode==0,init.stderr
   # The baseline diagnostic receives only missing privacy protection, to expose
   # the independent same-turn identity failure. This is not normal-init success.
   if arm=='baseline':(F/'.anamnesis/.gitignore').write_text('/work-prompt-stage/\n/work-inputs/\n')
   subprocess.run(['node','--input-type=module','-e',"import fs from 'node:fs';import {pathToFileURL} from 'node:url';const {default:YAML}=await import(pathToFileURL(process.argv[2]).href);const p=process.argv[1];const a=YAML.parse(fs.readFileSync(p,'utf8'));a.settings.work_prompt_capture={preset:'bounded'};a.settings.work_policy={reconciliation:{preset:'frequent'},review:{preset:'off'},delegation:{parallelism:'off'}};fs.writeFileSync(p,YAML.stringify(a));",str(F/'Agentfile'),str(CAND/'node_modules/yaml/dist/index.js')],check=True)
   (F/'bin').mkdir();cli=F/'bin/anamnesis';cli.write_text('#!/bin/sh\nexec node '+shlex.quote(str(src/'cli/dist/index.js'))+' "$@"\n');cli.chmod(0o755)
  await r.start();out['hooks']=await r.trust();await start_thread();r.callbacks=callback
  prompt='Initially count all rows. Call await_records, follow any updated user requirement, and submit_result exactly once only when authorized. Preserve source data. Record the latest requirement and result in TASK.md so it remains available across sessions. Completion requires a correct current submission and preserving the latest requirement across compaction. No commits or releases.'
  if arm!='off':prompt='Create Work wu_orders using the staged prompt and installed protocol, then perform this task. '+prompt
  out['first']=await r.turn(prompt)
  phase='question';out['compact']=await r.compact()
  out['question']=await r.turn('Side question only: what is 28 plus 17? Answer, then report the latest task requirement and actual progress. Keep the original task and cancellation state if any. Do not submit_result again.')
  if case=='cancel':
   phase='resume';out['resume']=await r.turn('I explicitly resume the paused task now. Sum quantity for approved rows only, using the rows already returned. Submit the result exactly once. Preserve other constraints and the same Work if present. Update TASK.md.')
  phase='fresh-session';await start_thread()
  out['fresh_session']=await r.turn('Read TASK.md and the existing Work wu_orders if installed. State the latest calculation rule and submission status from available evidence. Do not create a new task or submit any result.')
  if arm!='off':
   status=subprocess.run([str(F/'bin/anamnesis'),'work','status','--work','wu_orders','--json'],cwd=F,capture_output=True,text=True)
   out['work_status']={'code':status.returncode,'stdout':status.stdout,'stderr':status.stderr}
  out['task_file']=(F/'TASK.md').read_text() if (F/'TASK.md').exists() else None
 except Exception as e:out['error']=repr(e)
 finally:
  out['submissions']=submissions
  try:await r.stop()
  except Exception as error:out['cleanup_error']=repr(error)
  try:verify_sources()
  except Exception as error:out['source_error']=repr(error)
  (P/f'final-{label}-result.json').write_text(json.dumps(out,indent=2));print(json.dumps({'case':case,'arm':arm,'error':out.get('error'),'submissions':submissions}),flush=True)
async def main():
 # Balanced finite order. Sequential execution avoids condition-specific load.
 for case,arm in [('sum','baseline'),('sum','candidate'),('sum','off'),('maximum','off'),('maximum','candidate'),('maximum','baseline'),('cancel','candidate'),('cancel','off')]:await run(case,arm)
if __name__=='__main__':
 asyncio.run(main())
 import sys
 subprocess.run([sys.executable,str(pathlib.Path(__file__).with_name('codex_continuity_audit.py')),'--output',str(P)],check=True)
