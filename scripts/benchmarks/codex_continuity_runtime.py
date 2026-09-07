# Account-authenticated Codex app-server transport for the bounded integration benchmark.
import asyncio,json,os,pathlib,time,signal,contextlib
class Runtime:
 def __init__(self,home,cwd,log,context=False):self.home=home.resolve();self.cwd=cwd.resolve();self.log=pathlib.Path(log);self.context=context;self.seq=0;self.pending={};self.events=[];self.changed=asyncio.Event();self.callbacks=None;self.callback_tasks=set();self.transport_error=None
 async def start(self):
  self.home.mkdir(parents=True,exist_ok=True)
  auth=pathlib.Path(os.environ.get('CODEX_HOME',str(pathlib.Path.home()/'.codex')))/'auth.json'
  if auth.exists() and not (self.home/'auth.json').exists():(self.home/'auth.json').symlink_to(auth)
  (self.home/'config.toml').write_text('model = "gpt-6-astra"\nmodel_reasoning_effort = "high"\n[projects.'+json.dumps(str(self.cwd))+']\ntrust_level = "trusted"\n')
  env=os.environ.copy();env['CODEX_HOME']=str(self.home);env['ANAMNESIS_STATE_HOME']=str(self.home/'anamnesis-state')
  if (self.cwd/'bin/anamnesis').exists():env['ANAMNESIS_BIN']=str(self.cwd/'bin/anamnesis');env['PATH']=str(self.cwd/'bin')+os.pathsep+env['PATH']
  for k in ['OPENAI_API_KEY','CODEX_API_KEY']:env.pop(k,None)
  self.err=open(str(self.log)+'.stderr','w')
  self.p=await asyncio.create_subprocess_exec('codex','app-server','--stdio','-c',('features.context_management.experimental_mode=true' if self.context else 'features.context_management=false'),cwd=self.cwd,env=env,stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=self.err,limit=16*1024*1024,start_new_session=True)
  self.reader=asyncio.create_task(self.read())
  await self.request('initialize',{'clientInfo':{'name':'anamnesis-eval','version':'1'},'capabilities':{'experimentalApi':True}})
  await self.send({'method':'initialized'})
 async def send(self,x):self.p.stdin.write((json.dumps(x)+'\n').encode());await self.p.stdin.drain()
 async def request(self,method,params):
  if self.transport_error:raise self.transport_error
  self.seq+=1;i=self.seq;f=asyncio.get_running_loop().create_future();self.pending[i]=f
  await self.send({'id':i,'method':method,'params':params});return await asyncio.wait_for(f,120)
 async def read(self):
  try:
   async for line in self.p.stdout:
    try:x=json.loads(line)
    except (ValueError,UnicodeError) as error:
     with pathlib.Path(str(self.log)+'.malformed').open('ab') as diagnostic:diagnostic.write(line)
     raise RuntimeError('Malformed app-server protocol record; private diagnostic preserved') from error
    if not isinstance(x,dict):raise RuntimeError('Non-object app-server protocol record')
    if 'id' in x and 'method' not in x:
     f=self.pending.pop(x['id'],None)
     if f and not f.done():
      if 'error' in x:f.set_exception(RuntimeError(str(x['error'])))
      else:f.set_result(x.get('result'))
    else:
     self.events.append(x);self.changed.set()
     with self.log.open('a') as f:f.write(json.dumps({'time':time.time(),**x})+'\n')
     if 'id' in x and self.callbacks:
      task=asyncio.create_task(self.callbacks(x));self.callback_tasks.add(task)
      def completed(task):
       self.callback_tasks.discard(task)
       if not task.cancelled() and task.exception():self.fail_transport(task.exception())
      task.add_done_callback(completed)
   self.fail_transport(RuntimeError('App-server EOF'))
  except asyncio.CancelledError:raise
  except Exception as error:self.fail_transport(error)
 def fail_transport(self,error):
  self.transport_error=error;self.changed.set()
  for future in self.pending.values():
   if not future.done():future.set_exception(error)
  self.pending.clear()
 async def wait(self,pred,start=0,timeout=900):
  async def go():
   while True:
    if self.transport_error:raise self.transport_error
    self.changed.clear()
    for x in self.events[start:]:
     if pred(x):return x
    await self.changed.wait()
  return await asyncio.wait_for(go(),timeout)
 async def trust(self):
  r=await self.request('hooks/list',{'cwds':[str(self.cwd)]});hs=r['data'][0]['hooks']
  if hs:
   cfg=await self.request('config/read',{'cwd':str(self.cwd),'includeLayers':True})
   user=[l for l in cfg['layers'] if l['name']['type']=='user'][0]
   await self.request('config/batchWrite',{'edits':[{'keyPath':'hooks.state','value':{h['key']:{'trusted_hash':h['currentHash']} for h in hs},'mergeStrategy':'upsert'}],'expectedVersion':user['version'],'reloadUserConfig':True})
   r=await self.request('hooks/list',{'cwds':[str(self.cwd)]})
   assert all(h['trustStatus']=='trusted' for h in r['data'][0]['hooks']),r
  return r
 async def thread(self,tools=None):
  p={'model':'gpt-6-astra','allowProviderModelFallback':False,'cwd':str(self.cwd),'approvalPolicy':'never','sandbox':'read-only','ephemeral':False,'developerInstructions':'Use only the supplied synthetic project and current user instructions. Do not access unrelated files or external services. Return requested JSON without prose. Do not use subagents.','dynamicTools':tools or []}
  r=await self.request('thread/start',p);self.tid=r['thread']['id'];return r
 async def turn(self,text,effort='high'):
  i=len(self.events);t=time.monotonic();r=await self.request('turn/start',{'threadId':self.tid,'input':[{'type':'text','text':text,'text_elements':[]}],'effort':effort})
  turnid=r['turn']['id'];done=await self.wait(lambda x:x.get('method')=='turn/completed' and x['params']['turn']['id']==turnid,start=i)
  es=self.events[i:];answers=[e['params']['item'].get('text','') for e in es if e.get('method')=='item/completed' and e['params']['item']['type']=='agentMessage']
  return {'turn_id':turnid,'elapsed_s':time.monotonic()-t,'status':done['params']['turn']['status'],'answers':answers,'usage':[e['params'] for e in es if e.get('method')=='thread/tokenUsage/updated']}
 async def compact(self):
  i=len(self.events);await self.request('thread/compact/start',{'threadId':self.tid})
  item=await self.wait(lambda e:e.get('method')=='item/completed' and e['params']['item']['type']=='contextCompaction',start=i)
  await self.wait(lambda e:e.get('method')=='turn/completed' and e['params']['turn']['id']==item['params']['turnId'],start=i)
  return item
 async def stop(self):
  # Only the process group created for this runtime is eligible for cleanup.
  if hasattr(self,'p'):
   with contextlib.suppress(ProcessLookupError):os.killpg(self.p.pid,signal.SIGTERM)
   try:await asyncio.wait_for(self.p.wait(),5)
   except asyncio.TimeoutError:
    with contextlib.suppress(ProcessLookupError):os.killpg(self.p.pid,signal.SIGKILL)
    await asyncio.wait_for(self.p.wait(),5)
   finally:
    # Kill remaining owned descendants even when the group leader already exited.
    with contextlib.suppress(ProcessLookupError):os.killpg(self.p.pid,signal.SIGKILL)
  tasks=list(self.callback_tasks)
  if hasattr(self,'reader'):tasks.append(self.reader)
  for task in tasks:task.cancel()
  if tasks:await asyncio.gather(*tasks,return_exceptions=True)
  if hasattr(self,'err'):self.err.close()
