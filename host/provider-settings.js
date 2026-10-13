/** Server-owned connection settings; public projections never include credentials. */
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { conversationBase } from '@voicemesh/composer/server';
export async function createSettings(path, env = process.env) {
  let saved = {};
  try { saved = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Unable to read connection settings'); }
  const ids = ['openai', 'openai-live', 'xai', 'gemini'];
  const pipelineDefaults = { sttEngine: 'openai', sttModel: '', ttsEngine: 'openai',
    ttsModel: 'gpt-4o-mini-tts', ttsVoice: 'alloy', conversationalProvider: 'openai',
    conversationalModel: 'gpt-4o-mini', conversationalBaseUrl: '', vadSilenceSec: 1.1 };
  const classifierDefaults = { enabled: false, provider: 'jev', model: 'jev-latest' };
  const classifier = () => ['jev', 'openai'].includes(saved.classifier?.provider)
    ? { enabled: saved.classifier.enabled === true
        && (saved.classifier.provider !== 'openai' || saved.classifier.model === 'gpt-6-luna'),
      provider: saved.classifier.provider,
      model: saved.classifier.provider === 'openai' ? 'gpt-6-luna' : saved.classifier.model || 'jev-latest' }
    : { ...classifierDefaults };
  const classifierCredential = provider => provider === 'jev'
    ? saved.classifierKeys?.jev || env.TYPESAFE_API_KEY || ''
    : provider === 'openai' ? get('openai').key : '';
  const voiceMode = () => saved.voiceMode === 'pipeline' ? 'pipeline' : 'sts';
  const pipeline = () => ({ ...pipelineDefaults, ...saved.pipeline });
  const pipelineCredential = provider => {
    if (provider?.startsWith('endpoint:')) {
      const digest=createHash('sha256').update(conversationBase(provider.slice(9))).digest('hex');
      return saved.conversationKeys?.[digest] || '';
    }
    if (['openai', 'gemini', 'xai'].includes(provider)) return get(provider).key;
    if (!['deepgram', 'fish'].includes(provider)) return '';
    return saved.pipelineKeys?.[provider] || env[`${provider.toUpperCase()}_API_KEY`] || '';
  };
  const selectedProvider = () => ids.includes(saved.selectedProvider) ? saved.selectedProvider : 'openai-live';
  const plainLanguageSummaries = () => saved.plainLanguageSummaries === true
    || (saved.plainLanguageSummaries === undefined && ids.some(id => saved[id]?.plainLanguageSummaries === true));
  const get = id => {
    const prefix=id==='openai-live'?'OPENAI':id.toUpperCase();
    const fields = { model:env[`${prefix}_MODEL`] || '', voice:env[`${prefix}_VOICE`] || '', voiceStandbySec:30, statusSounds:true, assistantOrbEnabled:true,
      responseDetail:'concise', progressMode:'outcome', backchannelEnabled:false, endConversationEnabled:false,
      backendModel:'', transcriptionModel:id==='openai' ? env.OPENAI_TRANSCRIPTION_MODEL || '' : '', ...saved[id] };
    return { ...fields, plainLanguageSummaries: plainLanguageSummaries(), key: ['openai', 'openai-live'].includes(id)
      ? saved.openai?.key || saved['openai-live']?.key || env.OPENAI_API_KEY || ''
      : saved[id]?.key || env[`${prefix}_API_KEY`] || '' };
  };
  const publicSettings = () => ids.map(id => { const {key,...fields}=get(id); return {id,...fields,configured:!!key}; });
  let tail=Promise.resolve();
  async function persist(updated) {
    await mkdir(dirname(path),{recursive:true,mode:0o700});
    const temporary=join(dirname(path),`.settings-${randomUUID()}`);
    try { await writeFile(temporary,JSON.stringify(updated)+'\n',{mode:0o600,flag:'wx'}); await rename(temporary,path); }
    finally { await rm(temporary,{force:true}); }
    saved=updated;
  }
  function save(value) {
    const operation=tail.then(async()=>{
      if (!value || !ids.includes(value.id)) throw new Error('Select a supported provider');
      // Persist only explicit settings, never an environment or bootstrap key.
      const next={...(saved[value.id] ?? {})};
      for (const field of ['key','model','voice','transcriptionModel','backendModel']) {
        if (value[field] === undefined) continue;
        if (typeof value[field] !== 'string' || value[field].length>4096 || /[\r\n]/.test(value[field])) throw new Error('Invalid connection field');
        if (field === 'key' && value[field].trim() && !/^[\x21-\x7e]+$/.test(value[field].trim())) throw new Error('Invalid API key characters');
        if (field === 'key' && !value[field].trim()) delete next.key;
        else next[field]=value[field].trim();
      }
      if (value.voiceStandbySec !== undefined) {
        if (!Number.isInteger(value.voiceStandbySec) || value.voiceStandbySec < 0 || value.voiceStandbySec > 120) throw new Error('Invalid standby duration');
        next.voiceStandbySec = value.voiceStandbySec;
      }
      for (const field of ['statusSounds', 'assistantOrbEnabled', 'endConversationEnabled']) {
        if (value[field] === undefined) continue;
        if (typeof value[field] !== 'boolean') throw new Error(`Invalid ${field} setting`);
        next[field] = value[field];
      }
      if (value.responseDetail !== undefined) {
        if (!['concise', 'detailed'].includes(value.responseDetail)) throw new Error('Invalid speech verbosity');
        next.responseDetail = value.responseDetail;
      }
      if (value.progressMode !== undefined) {
        if (!['outcome', 'milestones'].includes(value.progressMode)) throw new Error('Invalid coding progress mode');
        next.progressMode = value.progressMode;
      }
      if (value.backchannelEnabled !== undefined) {
        if (typeof value.backchannelEnabled !== 'boolean') throw new Error('Invalid backchannel setting');
        next.backchannelEnabled = value.backchannelEnabled;
      }
      if (value.plainLanguageSummaries !== undefined && typeof value.plainLanguageSummaries !== 'boolean') throw new Error('Invalid plainLanguageSummaries setting');
      const updated={...saved,[value.id]:next,
        plainLanguageSummaries: value.plainLanguageSummaries ?? plainLanguageSummaries()};
      for (const id of ids) {
        if (updated[id]?.plainLanguageSummaries === undefined) continue;
        updated[id]={...updated[id]};
        delete updated[id].plainLanguageSummaries;
      }
      if (value.key !== undefined && ['openai', 'openai-live'].includes(value.id)) {
        const openai={...(updated.openai ?? {})};
        if (value.key.trim()) openai.key=value.key.trim();
        else delete openai.key;
        updated.openai=openai;
        if (updated['openai-live']) delete updated['openai-live'].key;
      }
      await persist(updated);
      return publicSettings();
    });
    tail=operation.catch(()=>{}); // A rejected save must not prevent a corrected submission.
    return operation;
  }
  function select(id) {
    const operation=tail.then(async()=>{
      if (!ids.includes(id)) throw new Error('Select a supported provider');
      await persist({...saved,selectedProvider:id});
      return selectedProvider();
    });
    tail=operation.catch(()=>{});
    return operation;
  }
  function selectVoiceMode(mode) {
    const operation=tail.then(async()=>{
      if (!['pipeline','sts'].includes(mode)) throw new Error('Invalid voice mode');
      await persist({...saved,voiceMode:mode});
      return voiceMode();
    });
    tail=operation.catch(()=>{});
    return operation;
  }
  function savePipeline(changes) {
    const operation=tail.then(async()=>{
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Invalid pipeline settings');
      const next=pipeline();
      const fields=['sttEngine','sttModel','ttsEngine','ttsModel','ttsVoice','conversationalProvider','conversationalModel'];
      for (const [field,value] of Object.entries(changes)) {
        if (field === 'vadSilenceSec') {
          if (!Number.isFinite(value) || value < .3 || value > 3) throw new Error('Invalid speech detection duration');
          next[field]=value;
        } else if (field === 'conversationalBaseUrl') {
          if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid conversation endpoint');
          next[field]=value.trim() ? conversationBase(value.trim()) : '';
        } else if (fields.includes(field)) {
          if (typeof value !== 'string' || value.length > 128 || /[\r\n]/.test(value)) throw new Error('Invalid pipeline field');
          next[field]=value.trim();
        } else throw new Error('Unknown pipeline field');
      }
      if (changes.sttEngine !== undefined && changes.sttEngine !== pipeline().sttEngine && changes.sttModel === undefined) next.sttModel='';
      if (changes.ttsEngine !== undefined && changes.ttsEngine !== pipeline().ttsEngine) {
        if (changes.ttsModel === undefined) next.ttsModel='';
        if (changes.ttsVoice === undefined) next.ttsVoice='';
      }
      if (changes.conversationalProvider !== undefined && changes.conversationalProvider !== pipeline().conversationalProvider
        && changes.conversationalModel === undefined) next.conversationalModel='';
      await persist({...saved,pipeline:next});
      return pipeline();
    });
    tail=operation.catch(()=>{});
    return operation;
  }
  function saveClassifier(changes) {
    const operation=tail.then(async()=>{
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Invalid classifier settings');
      const next=classifier();
      for (const [field,value] of Object.entries(changes)) {
        if (field === 'enabled') {
          if (typeof value !== 'boolean') throw new Error('Invalid classifier setting');
          next.enabled=value;
        } else if (field === 'provider' || field === 'model') {
          if (typeof value !== 'string' || value.length > 128 || /[\r\n]/.test(value)) throw new Error('Invalid classifier field');
          next[field]=value.trim();
        } else throw new Error('Unknown classifier field');
      }
      if (changes.provider !== undefined && changes.provider !== classifier().provider) {
        if (changes.model === undefined) next.model=next.provider === 'jev' ? 'jev-latest' : 'gpt-6-luna';
        // Do not carry an enabled selection to a different provider implicitly.
        // An explicit enable is allowed below only after its credential is checked.
        if (changes.enabled !== true) next.enabled=false;
      }
      if (!['jev', 'openai'].includes(next.provider)) throw new Error('Unsupported classifier provider');
      if (next.enabled) {
        if (!next.model) throw new Error('Choose a classifier model before enabling');
        if (next.provider === 'jev' && !next.model.startsWith('jev-')) throw new Error('Choose a Jev classifier model');
        if (next.provider === 'openai' && next.model !== 'gpt-6-luna') throw new Error('Unsupported OpenAI decision model');
        if (!classifierCredential(next.provider))
          throw new Error('Save the classifier provider key before enabling');
      }
      await persist({...saved,classifier:next});
      return classifier();
    });
    tail=operation.catch(()=>{});
    return operation;
  }
  function saveClassifierCredential(key) {
    const operation=tail.then(async()=>{
      if (typeof key !== 'string' || key.length > 4096 || /[\r\n]/.test(key)) throw new Error('Invalid classifier API key');
      const keys={...(saved.classifierKeys ?? {})};
      if (key.trim()) keys.jev=key.trim(); else delete keys.jev;
      await persist({...saved,classifierKeys:keys});
      return { configured: !!classifierCredential('jev') };
    });
    tail=operation.catch(()=>{});
    return operation;
  }
  function savePipelineCredential(provider, key) {
    const endpoint=typeof provider === 'string' && provider.startsWith('endpoint:') ? conversationBase(provider.slice(9)) : null;
    if (!endpoint && !['openai','gemini','xai','deepgram','fish'].includes(provider)) throw new Error('Unsupported pipeline credential');
    if (typeof key !== 'string' || key.length > 4096 || /[\r\n]/.test(key)) throw new Error('Invalid API key');
    if (endpoint) {
      const operation=tail.then(async()=>{
        const digest=createHash('sha256').update(endpoint).digest('hex');
        const keys={...(saved.conversationKeys ?? {})};
        if (key.trim()) keys[digest]=key.trim(); else delete keys[digest];
        await persist({...saved,conversationKeys:keys});
        return publicSettings();
      });
      tail=operation.catch(()=>{});
      return operation;
    }
    if (['openai','gemini','xai'].includes(provider)) return save({ id: provider, key });
    const operation=tail.then(async()=>{
      const next={...(saved.pipelineKeys ?? {})};
      if (key.trim()) next[provider]=key.trim();
      else delete next[provider];
      await persist({...saved,pipelineKeys:next});
      return publicSettings();
    });
    tail=operation.catch(()=>{});
    return operation;
  }
  return {get,publicSettings,save,selectedProvider,select,voiceMode,pipeline,classifier,classifierCredential,saveClassifier,saveClassifierCredential,selectVoiceMode,savePipeline,
    pipelineCredential,savePipelineCredential};
}
