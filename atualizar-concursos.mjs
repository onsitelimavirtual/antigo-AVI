/**
 * Atualização responsável de concursos públicos.
 * - Registros principais: curadoria manual de links oficiais. NÃO inventa novos editais.
 * - Descoberta: manchetes do Google Notícias (não editais confirmados) para revisão humana.
 * - Datas do cronograma só são alteradas pelo administrador após conferir retificações.
 * Node.js 20+ sem dependências adicionais.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const INPUT=path.join(ROOT,'data','concursos-curados.json');
const OUTPUT=path.join(ROOT,'data','concursos.json');
const INDEX=path.join(ROOT,'index.html');
const searches=[
  'site:cebraspe.org.br (concurso edital inscricoes abertura) when:7d',
  'site:gov.br ("concurso público" "inscrições") when:7d'
];
const hostAllowed=u=>{
 try{const x=new URL(u);const h=x.hostname.toLowerCase();return x.protocol==='https:'&&!x.username&&!x.password&&(h==='cebraspe.org.br'||h.endsWith('.cebraspe.org.br')||h==='gov.br'||h.endsWith('.gov.br'))}catch{return false}
};
export function validateContest(item){
 if(!item||typeof item!=='object'||Array.isArray(item))return false;
 for(const key of ['id','title','organ','begin','end','url'])if(typeof item[key]!=='string'||!item[key].trim()||item[key].length>1200)return false;
 const date=s=> /^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 if(!date(item.begin)||!date(item.end)||item.begin>item.end||!hostAllowed(item.url))return false;
 return true;
}
export function dueStatus(item,date){return date<item.begin?'futuro':date>item.end?'passado':'prazo'}
function entity(s){return String(s).replace(/&(?:amp|lt|gt|quot|apos|#39|#x27);/gi,a=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'",'&#x27;':"'"}[a.toLowerCase()]||a))}
function elem(xml,tag){const e=xml.match(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+tag+'>','i'));return e?entity(e[1].replace(/^<!\[CDATA\[/,'').replace(/\]\]>$/,'')).replace(/[\u0000-\u001f]/g,' ').trim():''}
function safeNews(link){try{const x=new URL(link);return x.protocol==='https:'&&x.hostname==='news.google.com'&&/^\/rss\/(articles|read)\//.test(x.pathname)}catch{return false}}
export function parseLeads(xml,now=new Date()){
 if(typeof xml!=='string'||!/<rss[\s>]/.test(xml)||xml.length>1300000)throw Error('Feed inválido');
 const list=xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi)||[];const leads=[];
 for(const entry of list.slice(0,60)){
  const source=entry.match(/<source\s+[^>]*url=["']([^"']+)["'][^>]*>/i);
  if(!source||!hostAllowed(entity(source[1])))continue;
  const url=elem(entry,'link'),title=elem(entry,'title').slice(0,175),pub=new Date(elem(entry,'pubDate'));
  if(!safeNews(url)||!/concurso|edital|inscri(c|ç|çõ|co)|certame|vagas?/i.test(title))continue;
  if(!Number.isFinite(pub.getTime())||pub.getTime()>now.getTime()+86400000||now.getTime()-pub.getTime()>9*86400000)continue;
  leads.push({id:'lead-'+crypto.createHash('sha256').update(url).digest('hex').slice(0,16),title,url,published:pub.toISOString().slice(0,10),source:entity(source[1])});
 }
 return leads;
}
async function syncEmbeddedFallback(indexFile,curated,records){
 if(!indexFile)return;
 const html=await fs.readFile(indexFile,'utf8');
 const pattern=/(<script type=[\"']application\/json[\"'] id=[\"']contestFallback[\"']>)[\s\S]*?(<\/script>)/i;
 if(!pattern.test(html))throw Error('Bloco contestFallback não encontrado no index.html; fallback offline não pode ser sincronizado.');
 const payload={schemaVersion:curated.schemaVersion||1,verifiedAt:curated.verifiedAt||null,curationNote:curated.curationNote||'',records};
 const safeJson=JSON.stringify(payload).replace(/</g,'\\u003c');
 const updated=html.replace(pattern,(_match,open,close)=>`${open}${safeJson}${close}`);
 if(updated!==html){
  const temp=indexFile+'.tmp-'+process.pid;
  await fs.writeFile(temp,updated,'utf8');
  await fs.rename(temp,indexFile);
 }
}
export async function updateContests({fetchFn=globalThis.fetch,now=new Date(),input=INPUT,output=OUTPUT,index=INDEX,log=console}={}){
 const curated=JSON.parse(await fs.readFile(input,'utf8'));
 if(!curated||!Array.isArray(curated.records)||curated.records.length>200)throw Error('Curadoria inválida');
 const valid=curated.records.filter(validateContest);
 if(valid.length!==curated.records.length)throw Error('Curadoria contém fonte ou dados inválidos; nenhuma alteração aplicada');
 if(new Set(valid.map(x=>x.id)).size!==valid.length)throw Error('IDs duplicados na curadoria');
 let previous=[];
 try{const old=JSON.parse(await fs.readFile(output,'utf8'));if(Array.isArray(old.leads))previous=old.leads;}catch{}
 let success=0;
 const fetched=await Promise.all(searches.map(async q=>{
  const url='https://news.google.com/rss/search?'+new URLSearchParams({q,hl:'pt-BR',gl:'BR',ceid:'BR:pt-419'});
  try{const r=await fetchFn(url,{signal:AbortSignal.timeout(15000),headers:{Accept:'application/rss+xml'}});if(!r.ok)throw Error('HTTP '+r.status);const leads=parseLeads(await r.text(),now);success++;return leads}
  catch(err){log.warn('Falha no índice de notícias: '+err.message);return []}
 }));
 const uniq=new Map();for(const lead of [...fetched.flat(),...previous]){
  if(lead&&safeNews(lead.url)&&typeof lead.published==='string'&&now.getTime()-Date.parse(lead.published+'T00:00:00Z')<10*86400000&&!uniq.has(lead.url))uniq.set(lead.url,lead);
 }
 const result={schemaVersion:1,verifiedAt:curated.verifiedAt||null,generatedAt:now.toISOString(),status:'curated_schedule',discoveryStatus:success===searches.length?'ok':success?'partial':'offline',curationNote:curated.curationNote||'',coverage:'Datas da curadoria oficial. Monitoramento de manchetes não é verificação de editais.',records:valid,leads:[...uniq.values()].sort((a,b)=>b.published.localeCompare(a.published)).slice(0,16)};
 await fs.mkdir(path.dirname(output),{recursive:true});const tmp=output+'.tmp-'+process.pid;
 await fs.writeFile(tmp,JSON.stringify(result,null,2)+'\n','utf8');await fs.rename(tmp,output);
 await syncEmbeddedFallback(index,curated,valid);
 return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 updateContests().then(x=>console.info(`Concursos catalogados: ${x.records.length}; manchetes a conferir: ${x.leads.length} (${x.discoveryStatus})`)).catch(e=>{console.error(e.message);process.exitCode=1})
}
