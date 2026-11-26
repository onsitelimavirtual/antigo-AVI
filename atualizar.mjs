/**
 * Painel de Oportunidades de Emprego — indexação de referências jornalísticas.
 * Não acessa páginas integrais, não extrai listagens de candidatos, não presume vagas ativas.
 * Google Notícias RSS é um índice intermediário; não é uma API oficial do Correio.
 * Node.js 20+, sem pacotes externos.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, 'data', 'atualizacoes.json');
const LIMIT_PER_FEED = 80;
const LIMIT_TOTAL = 120;
const AGE_DAYS = 14;
const MS_DAY = 86400000;
const FEEDS = Object.freeze([
  {source: 'Correio Braziliense', host: 'correiobraziliense.com.br', query: 'site:correiobraziliense.com.br (vagas OR emprego OR estágio OR trainee OR aprendiz) when:14d'},
  {source: 'CorreioWeb', host: 'correioweb.com.br', query: 'site:correioweb.com.br (vagas OR emprego OR estágio OR trainee OR aprendiz) when:14d'},
  {source: 'Classificados CB', host: 'classificadoscb.com.br', query: 'site:classificadoscb.com.br (vagas OR emprego OR estágio OR aprendiz) when:14d'}
]);
function feedUrl(query) {
  const u = new URL('https://news.google.com/rss/search');
  u.search = new URLSearchParams({q:query, hl:'pt-BR', gl:'BR', ceid:'BR:pt-419'}).toString();
  return u.href;
}
const ENTITY = Object.freeze({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',mdash:'—',ndash:'–'});
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (_,ent) => {
    if(ent[0]!=='#')return ENTITY[ent.toLowerCase()] ?? '&'+ent+';';
    const cp=ent.slice(1).toLowerCase().startsWith('x')?parseInt(ent.slice(2),16):parseInt(ent.slice(1),10);
    return cp>0&&cp<=0x10ffff&&!(cp>=0xd800&&cp<=0xdfff)?String.fromCodePoint(cp):'�';
  });
}
function stripCDATA(s) { return String(s).replace(/^<!\[CDATA\[/,'').replace(/\]\]>$/,''); }
function nodeText(xml,tag) {
  const found = xml.match(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+tag+'>','i'));
  return found ? decodeEntities(stripCDATA(found[1])).trim().replace(/[\u0000-\u001f]+/g,' ').slice(0,1200) : '';
}
function normalizeText(s){ return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
function category(title) {
  const t=normalizeText(title);
  if(/\btrainee\b/.test(t))return 'Trainee';
  if(/\bestagio(s)?\b|\bestagiari[oa]s?\b/.test(t))return 'Estágio';
  if(/\baprendi[zc]/.test(t))return 'Aprendiz';
  return 'Emprego';
}
function likelyOpportunity(title) {
  const t=normalizeText(title);
  const excluded = /\b(aulao|cursos?|qualificacao|vestibular|castrar|castracao|caes|gatos|concursos?|certames?|aposentadoria|emprego e renda|indice de emprego|desenvolvimento|entrevistas?|gravidez|planejamento familiar|jornada reduzida|lei do estagio|olimpic[oa]s?|pan de lima|contratada pela|contratado pela|contratada para fornecer)\b/;
  if (excluded.test(t)) return false;
  const opportunity = /\b(vagas?|empregos?|estagios?|estagiari[oa]s?|trainee|aprendi[zc]|recenseador|contrata-se)\b/;
  const hiringAction = /\b(abre|abrem|abriu|abertas?|aberto|abertos|oferece|oferecem|disponibiliza|disponibilizam|tem|esta com|estao com|selecao|processo seletivo|recrutamento|contrata-se|contratando|contrata)\b/;
  return opportunity.test(t) && hiringAction.test(t);
}
function expectedHost(raw,host) {
  try { const u=new URL(raw);const h=u.hostname.toLowerCase().replace(/^www\./,'');return u.protocol==='https:' && h===host; }
  catch {return false;}
}
function googleLink(link){
  try{const u=new URL(link);return u.protocol==='https:' && u.hostname==='news.google.com' && /^\/rss\/(articles|read)\//.test(u.pathname) && !u.username && !u.password;}
  catch{return false;}
}
function dateOnly(date){return date.toISOString().slice(0,10)}
export function extractReferences(xml,config,now=new Date()) {
  if(typeof xml!=='string'||xml.length>1_500_000||!/<rss\b/i.test(xml))throw Error('RSS inválido, vazio ou grande demais');
  const items=xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)||[];
  const parsed=[];
  for(const item of items.slice(0,LIMIT_PER_FEED)) {
    const sourceTag=item.match(/<source\s+[^>]*url\s*=\s*["']([^"']+)["'][^>]*>/i);
    const sourceUrl=sourceTag?decodeEntities(sourceTag[1]):'';
    if(!expectedHost(sourceUrl,config.host))continue; // evita atribuição falsa do portal
    let title=nodeText(item,'title');const link=nodeText(item,'link'), pub=nodeText(item,'pubDate');
    if(!title||!googleLink(link))continue;
    title=title.replace(new RegExp('\\s+-\\s+(?:'+config.source.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')\\s*$','i'),'').slice(0,150).trim();
    if(!likelyOpportunity(title))continue;
    const d=new Date(pub);
    if(!Number.isFinite(d.getTime())||d.getTime()>now.getTime()+MS_DAY||now.getTime()-d.getTime()>AGE_DAYS*MS_DAY)continue;
    const key=crypto.createHash('sha256').update(link).digest('hex').slice(0,20);
    parsed.push({
      id:'auto-'+key,
      title,
      type:category(title),
      source:config.source,
      location:'Não informada',
      published:dateOnly(d),
      deadline:'',
      url:link,
      description:'Referência encontrada no Google Notícias. Consulte a publicação e confirme prazos e disponibilidade.',
      origin:'automatico'
    });
  }
  return parsed;
}
export async function updateCatalog({fetchFn=globalThis.fetch,now=new Date(),dest=DEST,log=console}={}){
  const groups=await Promise.all(FEEDS.map(async config=>{
    try{
      const response=await fetchFn(feedUrl(config.query),{headers:{'Accept':'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8','User-Agent':'PainelOportunidadesReferencias/2.0'},signal:AbortSignal.timeout(18000)});
      if(!response.ok)throw Error('HTTP '+response.status);
      const raw=await response.text();
      const items=extractReferences(raw,config,now);
      log.info(`${config.source}: ${items.length} referências indexadas`);
      return {ok:true,config,items};
    }catch(e){log.error(`${config.source}: falha na consulta (${String(e.message).slice(0,160)})`);return {ok:false,config,items:[]}}
  }));
  const successful=groups.filter(x=>x.ok).length;
  if(!successful)throw Error('Todas as consultas falharam. O arquivo anterior permanece inalterado.');
  // Manter referências válidas anteriores, inclusive quando uma fonte não retorna resultados.
  let previous=[];
  try { const content=JSON.parse(await fs.readFile(dest,'utf8')); if(Array.isArray(content.records))previous=content.records; } catch {}
  const seen=new Set();
  const records=[...groups.flatMap(x=>x.items),...previous]
    .filter(x => {
      if(!x || x.origin!=='automatico'||typeof x.url!=='string'||typeof x.published!=='string'||typeof x.title!=='string')return false;
      if(!likelyOpportunity(x.title))return false;
      const dt=new Date(x.published+'T00:00:00Z');
      if(!Number.isFinite(dt.getTime())||now.getTime()-dt.getTime()>AGE_DAYS*MS_DAY)return false;
      if(!googleLink(x.url)||seen.has(x.url))return false;
      const expected=FEEDS.find(f=>f.source===x.source);
      if(!expected)return false;
      seen.add(x.url);return true;
    })
    .sort((a,b)=>b.published.localeCompare(a.published)||a.id.localeCompare(b.id))
    .slice(0,LIMIT_TOTAL);
  const result={
    generatedAt:now.toISOString(),
    status:successful===FEEDS.length?'ok':'partial',
    provider:'Google Notícias RSS (índice intermediário; não API oficial do Correio)',
    coverage:'Apenas manchetes indexadas. Não há confirmação de inscrição aberta ou cobertura completa.',
    feedsConsulted:FEEDS.length,
    feedsSucceeded:successful,
    records
  };
  await fs.mkdir(path.dirname(dest),{recursive:true});
  const tmp=dest+'.tmp-'+process.pid;
  await fs.writeFile(tmp,JSON.stringify(result,null,2)+'\n','utf8');
  await fs.rename(tmp,dest);
  return result;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  updateCatalog().then(c=>console.info(`Catálogo salvo: ${c.records.length} notícias relacionadas a oportunidades; situação ${c.status}`)).catch(e=>{console.error(e.message);process.exitCode=1});
}
