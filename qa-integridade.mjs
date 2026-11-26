/**
 * Motor de QA de integridade — Painel de Oportunidades de Emprego.
 * Valida a consistência interna dos catálogos antes da publicação.
 * Não substitui a conferência humana de editais nem confirma vagas abertas.
 * Node.js 20+, sem dependências externas.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContest } from './atualizar-concursos.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JOB_SOURCES = Object.freeze({
  'Correio Braziliense': 'correiobraziliense.com.br',
  'CorreioWeb': 'correioweb.com.br',
  'Classificados CB': 'classificadoscb.com.br'
});
const JOB_TYPES = new Set(['Emprego', 'Estágio', 'Aprendiz', 'Trainee']);
const MAX_GENERATION_AGE_MS = 8 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

function validDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function validIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) && d.toISOString() === value;
}
function googleNewsUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'news.google.com' &&
      /^\/rss\/(?:articles|read)\//.test(u.pathname) && !u.username && !u.password;
  } catch { return false; }
}
function officialSourceUrl(value) {
  try {
    const u = new URL(value);
    const h = u.hostname.toLowerCase();
    return u.protocol === 'https:' && !u.username && !u.password &&
      (h === 'cebraspe.org.br' || h.endsWith('.cebraspe.org.br') || h === 'gov.br' || h.endsWith('.gov.br'));
  } catch { return false; }
}
function brazilToday(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function ageInDays(date, now) {
  return Math.floor((Date.parse(`${brazilToday(now)}T12:00:00.000Z`) - Date.parse(`${date}T12:00:00.000Z`)) / DAY);
}
function safeHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch { return false; }
}
async function readJson(root, relative, errors) {
  const file = path.join(root, relative);
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('arquivo ausente, inválido ou maior que 5 MB');
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    errors.push({ code: 'JSON_UNAVAILABLE', file: relative, message: `Não foi possível ler ${relative}: ${error.message}` });
    return null;
  }
}

export async function runIntegrityQA({ root = ROOT, now = new Date(), writeReport = true } = {}) {
  const errors = [];
  const warnings = [];
  const checks = [];
  const check = (name, passed, detail) => {
    checks.push({ name, passed: Boolean(passed), detail });
    if (!passed) errors.push({ code: 'CHECK_FAILED', check: name, message: detail });
  };
  const warn = (code, message) => warnings.push({ code, message });

  const jobs = await readJson(root, 'data/atualizacoes.json', errors);
  const curated = await readJson(root, 'data/concursos-curados.json', errors);
  const contests = await readJson(root, 'data/concursos.json', errors);
  const projects = await readJson(root, 'projetos-autorais.json', errors);

  // 1. Referências de emprego.
  if (jobs) {
    const generated = validIsoTimestamp(jobs.generatedAt);
    check('empregos_timestamp_iso', generated, 'data/atualizacoes.json deve possuir generatedAt ISO válido.');
    if (generated) {
      const age = now.getTime() - Date.parse(jobs.generatedAt);
      check('empregos_atualizacao_recente', age <= MAX_GENERATION_AGE_MS && age >= -MAX_FUTURE_SKEW_MS,
        'O catálogo de empregos deve ter sido gerado nas últimas 8 horas e não pode estar no futuro.');
    }
    check('empregos_status', ['ok', 'partial'].includes(jobs.status), 'Status de empregos deve ser ok ou partial após a rotina de atualização.');
    check('empregos_feed_contadores', Number.isInteger(jobs.feedsConsulted) && jobs.feedsConsulted === 3 &&
      Number.isInteger(jobs.feedsSucceeded) && jobs.feedsSucceeded >= 1 && jobs.feedsSucceeded <= jobs.feedsConsulted,
      'Os contadores dos três feeds devem ser coerentes e pelo menos uma fonte deve responder.');
    check('empregos_status_coerente', jobs.status === (jobs.feedsSucceeded === jobs.feedsConsulted ? 'ok' : 'partial'),
      'O status do catálogo deve corresponder à quantidade de feeds consultados com sucesso.');
    check('empregos_registros_array', Array.isArray(jobs.records) && jobs.records.length <= 120,
      'O catálogo de empregos deve ser uma lista com até 120 registros.');
    if (Array.isArray(jobs.records)) {
      const ids = new Set();
      const urls = new Set();
      for (const [i, item] of jobs.records.entries()) {
        const valid = item && typeof item === 'object' && !Array.isArray(item) &&
          typeof item.id === 'string' && item.id.startsWith('auto-') && item.id.length <= 80 &&
          typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 150 &&
          JOB_TYPES.has(item.type) && Object.hasOwn(JOB_SOURCES, item.source) &&
          item.origin === 'automatico' && typeof item.location === 'string' &&
          validDateOnly(item.published) && (item.deadline === '' || validDateOnly(item.deadline)) &&
          typeof item.description === 'string' && item.description.length <= 250 && googleNewsUrl(item.url);
        if (!valid) errors.push({ code: 'JOB_RECORD_INVALID', record: i, message: `Registro de emprego ${i + 1} possui campos, data, fonte ou URL inválidos.` });
        if (item && typeof item.id === 'string') {
          if (ids.has(item.id)) errors.push({ code: 'JOB_ID_DUPLICATE', record: i, message: `ID duplicado no catálogo de empregos: ${item.id}` });
          ids.add(item.id);
        }
        if (item && typeof item.url === 'string') {
          if (urls.has(item.url)) errors.push({ code: 'JOB_URL_DUPLICATE', record: i, message: `URL duplicada no catálogo de empregos: ${item.url}` });
          urls.add(item.url);
        }
        if (item && validDateOnly(item.published)) {
          const age = ageInDays(item.published, now);
          if (age < -1 || age > 46) errors.push({ code: 'JOB_DATE_OUT_OF_RANGE', record: i, message: `Data de publicação fora da janela esperada no registro ${item.id || i + 1}.` });
        }
      }
      check('empregos_registros_consistentes', errors.every(x => !['JOB_RECORD_INVALID', 'JOB_ID_DUPLICATE', 'JOB_URL_DUPLICATE', 'JOB_DATE_OUT_OF_RANGE'].includes(x.code)),
        'Cada referência deve ter ID e URL únicos, fonte conhecida, link Google Notícias HTTPS e data coerente.');
      if (jobs.records.length === 0) warn('NO_JOB_REFERENCES', 'Nenhuma manchete de oportunidade foi indexada nesta execução; o painel preserva os dados cadastrados manualmente.');
    }
    if (jobs.status === 'partial') warn('JOB_FEED_PARTIAL', 'Uma ou mais fontes de notícias falharam. O catálogo foi gerado parcialmente.');
  }

  // 2. Concursos: o catálogo público deve reproduzir exatamente a curadoria validada.
  if (curated) {
    check('concursos_curadoria_data', validDateOnly(curated.verifiedAt), 'A curadoria de concursos deve informar a data da última conferência humana.');
    check('concursos_curadoria_array', Array.isArray(curated.records) && curated.records.length > 0 && curated.records.length <= 200,
      'A curadoria deve conter entre 1 e 200 registros oficiais.');
    if (Array.isArray(curated.records)) {
      const ids = new Set();
      const urls = new Set();
      for (const [i, item] of curated.records.entries()) {
        if (!validateContest(item)) errors.push({ code: 'CONTEST_RECORD_INVALID', record: i, message: `Concurso ${i + 1} tem datas, campos ou domínio oficial inválidos.` });
        if (item && typeof item.id === 'string') {
          if (ids.has(item.id)) errors.push({ code: 'CONTEST_ID_DUPLICATE', record: i, message: `ID de concurso duplicado: ${item.id}` });
          ids.add(item.id);
        }
        if (item && typeof item.url === 'string') {
          if (urls.has(item.url)) errors.push({ code: 'CONTEST_URL_DUPLICATE', record: i, message: `URL de concurso duplicada: ${item.url}` });
          urls.add(item.url);
        }
      }
      check('concursos_curadoria_consistente', errors.every(x => !['CONTEST_RECORD_INVALID', 'CONTEST_ID_DUPLICATE', 'CONTEST_URL_DUPLICATE'].includes(x.code)),
        'Os concursos curados devem possuir IDs únicos, datas em ordem e URLs HTTPS de domínios oficiais permitidos.');
      if (validDateOnly(curated.verifiedAt)) {
        const curationAge = ageInDays(curated.verifiedAt, now);
        if (curationAge > 14) warn('CONTEST_CURATED_STALE', `A curadoria de concursos foi conferida há ${curationAge} dias. É necessária revisão humana de editais, retificações, suspensões e cancelamentos.`);
        const active = curated.records.filter(x => validateContest(x) && x.begin <= brazilToday(now) && x.end >= brazilToday(now)).length;
        const expired = curated.records.filter(x => validateContest(x) && x.end < brazilToday(now)).length;
        if (active === 0) warn('NO_CONTESTS_IN_PERIOD', 'Nenhum concurso da curadoria possui prazo de inscrição dentro do período informado na data desta execução.');
        if (expired > 0) warn('EXPIRED_CONTESTS_PRESENT', `${expired} concurso(s) possuem prazo informado encerrado e serão exibidos como encerrados, não como inscrições abertas.`);
      }
    }
  }
  if (contests) {
    const generated = validIsoTimestamp(contests.generatedAt);
    check('concursos_timestamp_iso', generated, 'data/concursos.json deve possuir generatedAt ISO válido.');
    if (generated) {
      const age = now.getTime() - Date.parse(contests.generatedAt);
      check('concursos_atualizacao_recente', age <= MAX_GENERATION_AGE_MS && age >= -MAX_FUTURE_SKEW_MS,
        'O catálogo de concursos deve ter sido compilado nas últimas 8 horas e não pode estar no futuro.');
    }
    check('concursos_status_descoberta', ['ok', 'partial', 'offline'].includes(contests.discoveryStatus),
      'O estado da descoberta de notícias de concursos deve ser ok, partial ou offline.');
    check('concursos_registros_array', Array.isArray(contests.records) && contests.records.length <= 200,
      'O catálogo público de concursos deve ser uma lista com até 200 registros.');
    if (curated && Array.isArray(curated.records) && Array.isArray(contests.records)) {
      check('concursos_publicos_iguais_curadoria', JSON.stringify(contests.records) === JSON.stringify(curated.records),
        'O catálogo público deve corresponder exatamente à curadoria; manchetes descobertas não podem virar editais automaticamente.');
      check('concursos_data_curadoria_coerente', contests.verifiedAt === curated.verifiedAt,
        'A data de verificação exibida deve corresponder à data da curadoria.');
    }
    check('concursos_leads_array', Array.isArray(contests.leads) && contests.leads.length <= 16,
      'As manchetes para conferência devem ser uma lista com até 16 itens.');
    if (Array.isArray(contests.leads)) {
      const urls = new Set();
      for (const [i, lead] of contests.leads.entries()) {
        const valid = lead && typeof lead.title === 'string' && lead.title.trim() && lead.title.length <= 175 &&
          googleNewsUrl(lead.url) && officialSourceUrl(lead.source) && validDateOnly(lead.published);
        const recent = valid && ageInDays(lead.published, now) >= -1 && ageInDays(lead.published, now) <= 10;
        if (!valid || !recent) errors.push({ code: 'CONTEST_LEAD_INVALID', record: i, message: `Manchete de concurso ${i + 1} possui fonte, data, atualidade ou URL inválida.` });
        if (lead && typeof lead.url === 'string') {
          if (urls.has(lead.url)) errors.push({ code: 'CONTEST_LEAD_DUPLICATE', record: i, message: `Manchete duplicada: ${lead.url}` });
          urls.add(lead.url);
        }
      }
      check('concursos_leads_consistentes', errors.every(x => !['CONTEST_LEAD_INVALID', 'CONTEST_LEAD_DUPLICATE'].includes(x.code)),
        'As manchetes de descoberta devem ser recentes, únicas e provenientes de fontes oficiais identificadas.');
    }
    if (contests.discoveryStatus === 'offline') warn('CONTEST_DISCOVERY_OFFLINE', 'O índice de notícias de concursos não respondeu. A curadoria oficial foi preservada.');
    if (contests.discoveryStatus === 'partial') warn('CONTEST_DISCOVERY_PARTIAL', 'A descoberta de novas notícias de concursos funcionou parcialmente.');
  }

  // 3. Publicidade autoral: só anúncios habilitados precisam estar completos.
  if (projects) {
    check('publicidade_formato', Array.isArray(projects.projects) && projects.projects.length <= 12,
      'O catálogo autoral deve conter uma lista com até 12 projetos.');
    if (Array.isArray(projects.projects)) {
      for (const [i, item] of projects.projects.entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          errors.push({ code: 'PROJECT_RECORD_INVALID', record: i, message: `Anúncio autoral ${i + 1} não é um objeto válido.` });
          continue;
        }
        if (item.enabled === true) {
          const imageOk = item.image === '' || item.image == null ||
            (typeof item.image === 'string' && item.image.length <= 380000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(item.image));
          if (typeof item.name !== 'string' || !item.name.trim() || typeof item.description !== 'string' || !item.description.trim() ||
              (item.url && !safeHttpUrl(item.url)) || !imageOk) {
            errors.push({ code: 'PROJECT_ENABLED_INVALID', record: i, message: `Anúncio autoral habilitado ${i + 1} precisa de nome, descrição, link HTTPS válido e imagem permitida.` });
          }
        } else if (item.url && !safeHttpUrl(item.url)) {
          errors.push({ code: 'PROJECT_URL_INVALID', record: i, message: `URL inválida no anúncio autoral ${i + 1}.` });
        }
      }
      check('publicidade_anuncios_consistentes', errors.every(x => !['PROJECT_RECORD_INVALID', 'PROJECT_ENABLED_INVALID', 'PROJECT_URL_INVALID'].includes(x.code)),
        'Os anúncios habilitados devem estar completos e todos os links informados devem usar HTTPS.');
    }
    check('publicidade_data_atualizacao', projects.updatedAt == null || validIsoTimestamp(projects.updatedAt),
      'updatedAt da publicidade deve ser ISO válido ou null.');
  }

  // 4. Identidade, integração do QA e agenda.
  let html = '';
  let workflow = '';
  try { html = await fs.readFile(path.join(root, 'index.html'), 'utf8'); } catch {}
  try { workflow = await fs.readFile(path.join(root, '.github/workflows/atualizar-vagas.yml'), 'utf8'); } catch {}
  check('identidade_produto', /<title>[^<]*Painel de Oportunidades de Emprego/i.test(html) &&
    /<h1[^>]*>\s*Painel de Oportunidades de Emprego\s*<\/h1>/i.test(html),
    'O título da aba e o título principal devem usar “Painel de Oportunidades de Emprego”.');
  let embeddedFallback = null;
  const fallbackMatch = html.match(/<script type=[\"']application\/json[\"'] id=[\"']contestFallback[\"']>([\s\S]*?)<\/script>/i);
  if (fallbackMatch) { try { embeddedFallback = JSON.parse(fallbackMatch[1]); } catch {} }
  check('concursos_fallback_offline_valido', Boolean(embeddedFallback && Array.isArray(embeddedFallback.records)),
    'O HTML deve conter um catálogo JSON válido para consulta offline de concursos.');
  if (embeddedFallback && curated && Array.isArray(curated.records)) {
    check('concursos_fallback_igual_curadoria', embeddedFallback.verifiedAt === curated.verifiedAt &&
      JSON.stringify(embeddedFallback.records) === JSON.stringify(curated.records),
      'O catálogo offline embutido no HTML deve corresponder à curadoria atual de concursos.');
  }
  check('indicador_qa_na_interface', /id=["']qaStatus["']/.test(html),
    'A interface deve apresentar o estado da última verificação do motor de QA.');
  check('indicador_acessos_na_interface', /id=["']pageViewsCount["']/.test(html) &&
    /https:\/\/counterapi\.com\/api\/onsitelimavirtual\.github\.io\/view\/painel-de-oportunidades/.test(html),
    'A interface deve apresentar o contador agregado de acessos com namespace e chave fixos.');
  check('agenda_duas_vezes_ao_dia', /cron:\s*["']17 9,21 \* \* \*["']/.test(workflow),
    'O GitHub Actions deve agendar duas execuções diárias: 06h17 e 18h17 no horário de Brasília.');
  check('qa_antes_da_publicacao', /node scripts\/qa-integridade\.mjs/.test(workflow),
    'O motor de QA deve executar antes da etapa que publica os catálogos.');

  const today = brazilToday(now);
  const contestRecords = Array.isArray(curated?.records) ? curated.records.filter(validateContest) : [];
  const activeContests = contestRecords.filter(x => x.begin <= today && x.end >= today).length;
  const expiredContests = contestRecords.filter(x => x.end < today).length;
  const report = {
    schemaVersion: 1,
    product: 'Painel de Oportunidades de Emprego',
    engine: 'QA Integridade 1.0',
    generatedAt: now.toISOString(),
    status: errors.length ? 'failed' : warnings.length ? 'passed_with_warnings' : 'passed',
    summary: errors.length ? `${errors.length} falha(s) crítica(s); publicação bloqueada.` : warnings.length ? `Integridade estrutural aprovada com ${warnings.length} alerta(s) para revisão.` : 'Todos os controles de integridade foram aprovados.',
    totals: { checks: checks.length, passed: checks.filter(x => x.passed).length, failed: checks.filter(x => !x.passed).length, warnings: warnings.length },
    metrics: {
      jobReferences: Array.isArray(jobs?.records) ? jobs.records.length : null,
      contestRecords: contestRecords.length,
      contestsInRegistrationPeriod: activeContests,
      contestsWithExpiredDeadline: expiredContests,
      authorProjects: Array.isArray(projects?.projects) ? projects.projects.length : null,
      enabledAuthorProjects: Array.isArray(projects?.projects) ? projects.projects.filter(x => x?.enabled === true).length : null
    },
    checks,
    warnings,
    errors
  };

  if (writeReport) {
    const out = path.join(root, 'data', 'qa-status.json');
    await fs.mkdir(path.dirname(out), { recursive: true });
    const temp = `${out}.tmp-${process.pid}`;
    await fs.writeFile(temp, JSON.stringify(report, null, 2) + '\n', 'utf8');
    await fs.rename(temp, out);
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runIntegrityQA().then(report => {
    console.log(`QA ${report.status}: ${report.totals.passed}/${report.totals.checks} verificações aprovadas; ${report.totals.warnings} alerta(s).`);
    for (const item of report.errors) console.error(`FALHA [${item.code}]: ${item.message}`);
    for (const item of report.warnings) console.warn(`ALERTA [${item.code}]: ${item.message}`);
    if (report.status === 'failed') process.exitCode = 1;
  }).catch(error => {
    console.error('Falha ao executar o motor de QA:', error.message);
    process.exitCode = 1;
  });
}
