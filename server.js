const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '200kb' }));
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const MAX_PER_DAY = Math.max(1, Number(process.env.MAX_MESSAGES_PER_DAY || 10));
const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'data.json');
if (!ADMIN_PASSWORD || ADMIN_PASSWORD === 'coloque-uma-senha-forte-aqui') {
  console.error('ERRO: configure ADMIN_PASSWORD com uma senha forte nas variáveis de ambiente.');
  process.exit(1);
}
let data = { schedules: [], sent: {}, enabled: false };
try { if (fs.existsSync(DATA_FILE)) data = { ...data, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch (e) { console.error('Não foi possível ler data.json:', e.message); }
function save() {
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tempFile, DATA_FILE);
}
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta.' });
  next();
}
app.get('/health', (_req, res) => res.json({ ok: true, whatsapp: clientState, note: 'Saúde do servidor; não garante que o WhatsApp esteja conectado.' }));
app.use('/api', auth);
app.get('/api/status', (_req, res) => res.json({ state: clientState, enabled: data.enabled, schedules: data.schedules, sentToday: countSentToday(), maxPerDay: MAX_PER_DAY, lastError }));
app.get('/api/qr', async (_req, res) => {
  if (!latestQR) return res.json({ qr: null, state: clientState, message: 'QR ainda não disponível; confira o status.' });
  try { res.json({ qr: await QRCode.toDataURL(latestQR), state: clientState }); } catch { res.status(500).json({ error: 'Não foi possível gerar o QR.' }); }
});
app.get('/api/groups', async (_req, res) => {
  try {
    if (!client || clientState !== 'ready') return res.status(409).json({ error: 'Conecte o WhatsApp primeiro.' });
    const chats = await client.getChats();
    res.json(chats.filter(c => c.isGroup).map(c => ({ id: c.id._serialized, name: c.name })).sort((a,b) => a.name.localeCompare(b.name)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/schedules', (req, res) => {
  const { id, name, message, groupIds, time, days, active } = req.body || {};
  if (!name || !message || !Array.isArray(groupIds) || !groupIds.length || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '') || !Array.isArray(days) || !days.length) return res.status(400).json({ error: 'Informe nome, mensagem, ao menos um grupo, horário e dia.' });
  if (message.length > 5000) return res.status(400).json({ error: 'Mensagem muito longa (máximo 5.000 caracteres).' });
  const validDays = [...new Set(days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))];
  const validGroupIds = [...new Set(groupIds.filter(x => typeof x === 'string' && /^\d+-\d+@g\.us$/.test(x)))];
  const schedule = { id: id || `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, name: String(name).slice(0,100), message: String(message), groupIds: validGroupIds, time, days: validDays, active: active !== false };
  if (!schedule.groupIds.length || !schedule.days.length) return res.status(400).json({ error: 'Selecione grupos e dias válidos.' });
  const index = data.schedules.findIndex(s => s.id === schedule.id);
  if (index >= 0) data.schedules[index] = schedule; else data.schedules.push(schedule);
  save(); res.json({ ok: true, schedule });
});
app.delete('/api/schedules/:id', (req, res) => { data.schedules = data.schedules.filter(s => s.id !== req.params.id); save(); res.json({ ok: true }); });
app.post('/api/enabled', (req, res) => {
  const enabled = !!(req.body && req.body.enabled);
  if (enabled && clientState !== 'ready') return res.status(409).json({ error: 'Conecte o WhatsApp antes de ativar os envios.' });
  data.enabled = enabled;
  save();
  res.json({ ok: true, enabled: data.enabled });
});
app.get('/', (_req, res) => res.type('html').send(HTML));

let client = null, latestQR = null, clientState = 'starting', lastError = null;
function initClient() {
  client = new Client({ authStrategy: new LocalAuth({ clientId: 'medeiros-divulgacao', dataPath: path.join(DATA_DIR, '.wwebjs_auth') }), puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] }, takeoverOnConflict: false });
  client.on('qr', qr => { latestQR = qr; clientState = 'qr'; });
  client.on('authenticated', () => { latestQR = null; clientState = 'authenticated'; });
  client.on('ready', () => { latestQR = null; clientState = 'ready'; lastError = null; console.log('WhatsApp conectado.'); });
  client.on('auth_failure', msg => { clientState = 'auth_failure'; lastError = String(msg); });
  client.on('disconnected', reason => { clientState = 'disconnected'; lastError = String(reason); });
  client.initialize().catch(e => { clientState = 'error'; lastError = e.message; console.error(e); });
}
function localParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ || 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type, x.value]));
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, day: weekdays[p.weekday] };
}
function countSentToday() { const today = localParts().date; return Object.values(data.sent || {}).filter(x => x.date === today).length; }
let tickBusy = false;
async function tick() {
  if (tickBusy || !data.enabled || clientState !== 'ready') return;
  tickBusy = true;
  try {
    const now = localParts();
    for (const s of data.schedules.filter(x => x.active && x.time === now.time && x.days.includes(now.day))) {
      for (const groupId of s.groupIds) {
        const key = `${now.date}|${s.id}|${groupId}`;
        if (data.sent[key]) continue;
        if (countSentToday() >= MAX_PER_DAY) { lastError = `Limite diário de ${MAX_PER_DAY} mensagens atingido.`; return; }
        try {
          // Envio somente para grupos selecionados explicitamente pelo administrador.
          await client.sendMessage(groupId, s.message);
          data.sent[key] = { date: now.date, at: new Date().toISOString(), schedule: s.name, groupId };
          save();
          await new Promise(r => setTimeout(r, 5000));
        } catch (e) { lastError = `Falha no envio para ${groupId}: ${e.message}`; console.error(lastError); }
      }
    }
  } finally { tickBusy = false; }
}
cron.schedule('* * * * *', tick, { timezone: process.env.TZ || 'America/Sao_Paulo' });
const HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Robô Medeiros — Agendador</title><style>
:root{color-scheme:dark;--bg:#111827;--panel:#1f2937;--line:#374151;--text:#f9fafb;--muted:#cbd5e1;--orange:#f97316;--green:#22c55e}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px system-ui,Arial}.wrap{max-width:850px;margin:auto;padding:18px}.hero{background:linear-gradient(135deg,#ea580c,#9a3412);padding:22px;border-radius:18px;margin-bottom:16px}.hero h1{margin:0 0 8px;font-size:24px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;margin:14px 0}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.muted{color:var(--muted);font-size:14px}label{display:block;margin:12px 0 6px;font-weight:650}input,textarea,select{width:100%;padding:11px;border-radius:9px;border:1px solid #64748b;background:#111827;color:white;font:inherit}textarea{min-height:120px}button{border:0;border-radius:9px;padding:11px 14px;background:var(--orange);color:white;font-weight:750;font:inherit;cursor:pointer}button.secondary{background:#475569}button.danger{background:#b91c1c}.days{display:flex;gap:9px;flex-wrap:wrap}.days label{font-weight:400;margin:4px 0}.groups{max-height:230px;overflow:auto;border:1px solid var(--line);padding:10px;border-radius:9px}.groups label{font-weight:400;margin:8px 0}.status{padding:9px;border-radius:9px;background:#111827;margin-top:10px;overflow-wrap:anywhere}.qr{max-width:260px;width:100%;background:white;padding:10px;border-radius:10px}.item{border:1px solid var(--line);padding:12px;border-radius:10px;margin:10px 0}.item h3{margin:0 0 6px}.item p{white-space:pre-wrap;overflow-wrap:anywhere}.hidden{display:none}.badge{font-size:13px;background:#334155;border-radius:999px;padding:4px 8px}@media(min-width:650px){.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}}
</style></head><body><div class="wrap"><div class="hero"><h1>🤖 Robô Medeiros Divulgação</h1><div>Agendador de publicações para grupos selecionados</div><p class="muted">Painel separado — não altera seu site principal.</p></div>
<div class="panel"><h2>1. Acesso do administrador</h2><label>Senha de administrador</label><input id="pw" type="password" placeholder="Senha configurada no servidor"><div class="row" style="margin-top:10px"><button onclick="connect()">Entrar / atualizar status</button><span id="state" class="badge">Não conectado</span></div><div id="status" class="status">Digite a senha e toque em Entrar.</div><div id="qrbox" class="hidden"><p>WhatsApp → Aparelhos conectados → Conectar aparelho → escaneie este QR.</p><img id="qr" class="qr" alt="QR Code de conexão"></div></div>
<div class="panel"><h2>2. Conectar e escolher grupos</h2><p class="muted">A conexão usa um cliente não oficial do WhatsApp Web e pode ser desconectada ou restringida pelo WhatsApp. Use apenas grupos que autorizaram suas divulgações.</p><div class="row"><button class="secondary" onclick="loadGroups()">Carregar meus grupos</button><button class="secondary" onclick="toggleAll(true)">Marcar todos</button><button class="secondary" onclick="toggleAll(false)">Desmarcar todos</button></div><div id="groups" class="groups" style="margin-top:10px">Conecte o WhatsApp e carregue os grupos.</div></div>
<div class="panel"><h2>3. Criar uma publicação agendada</h2><label>Nome interno</label><input id="name" placeholder="Ex.: Ofertas da manhã"><label>Mensagem da oferta</label><textarea id="message" placeholder="Cole aqui a mensagem promocional com preço e link de afiliado."></textarea><div class="two"><div><label>Horário (Brasília)</label><input id="time" type="time" value="09:00"></div><div><label>Dias</label><div class="days" id="days">${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map((d,i)=>`<label><input type="checkbox" value="${i}" style="width:auto"> ${d}</label>`).join('')}</div></div></div><label>Grupos de destino</label><p class="muted">Marque abaixo apenas os grupos que deram autorização.</p><div class="row"><button onclick="addSchedule()">Salvar agendamento</button><button class="secondary" onclick="loadStatus()">Atualizar lista</button></div></div>
<div class="panel"><h2>4. Controle de publicações</h2><div class="row"><button onclick="setEnabled(true)">ATIVAR AUTOMÁTICO</button><button class="danger" onclick="setEnabled(false)">PAUSAR ENVIOS</button></div><div id="enabled" class="status">Automação pausada.</div><div id="schedules"></div></div>
<p class="muted">Importante: este serviço agenda mensagens que você cadastrar. Ele não busca ofertas ou gera links de afiliado automaticamente. O servidor precisa ficar online e manter o armazenamento persistente para preservar a conexão, os agendamentos e os registros.</p></div><script>
let token='',groups=[];const $=id=>document.getElementById(id);function headers(){return {'Content-Type':'application/json','Authorization':'Bearer '+token}}async function api(url,opts={}){const r=await fetch(url,{...opts,headers:{...headers(),...(opts.headers||{})}});let j={};try{j=await r.json()}catch{}if(!r.ok)throw Error(j.error||'Erro HTTP '+r.status);return j}function msg(s){$('status').textContent=s}async function connect(){token=$('pw').value;if(!token){msg('Digite a senha de administrador.');return}try{await loadStatus();const q=await api('/api/qr');if(q.qr){$('qr').src=q.qr;$('qrbox').classList.remove('hidden')}else $('qrbox').classList.add('hidden');msg('Conectividade verificada. Estado do WhatsApp: '+q.state); }catch(e){msg(e.message)}}async function loadStatus(){const j=await api('/api/status');$('state').textContent=j.state;$('enabled').textContent=j.enabled?'Automação ATIVA. Mensagens poderão ser enviadas nos horários cadastrados.':'Automação pausada.';if(j.lastError)msg('Aviso: '+j.lastError);$('schedules').innerHTML='<h3>Agendamentos salvos</h3>'+(j.schedules.length?j.schedules.map(s=>'<div class="item"><h3>'+esc(s.name)+' <span class="badge">'+(s.active?'Ativo':'Pausado')+'</span></h3><div class="muted">'+s.time+' · dias: '+s.days.map(d=>['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d]).join(', ')+' · '+s.groupIds.length+' grupo(s)</div><p>'+esc(s.message)+'</p><button class="danger" onclick="removeSchedule(\''+s.id+'\')">Excluir</button></div>').join(''):'<p>Nenhum agendamento cadastrado.</p>');msg('Status atualizado. Enviadas hoje: '+j.sentToday+' / '+j.maxPerDay)}function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}async function loadGroups(){try{groups=await api('/api/groups');$('groups').innerHTML=groups.length?groups.map(g=>'<label><input type="checkbox" class="groupcheck" value="'+esc(g.id)+'" style="width:auto"> '+esc(g.name)+'</label>').join(''):'Nenhum grupo encontrado.';msg('Grupos carregados: '+groups.length)}catch(e){msg(e.message)}}function toggleAll(v){document.querySelectorAll('.groupcheck').forEach(c=>c.checked=v)}async function addSchedule(){const groupIds=[...document.querySelectorAll('.groupcheck:checked')].map(c=>c.value),days=[...$('days').querySelectorAll('input:checked')].map(c=>Number(c.value));const body={name:$('name').value.trim(),message:$('message').value.trim(),groupIds,time:$('time').value,days,active:true};try{await api('/api/schedules',{method:'POST',body:JSON.stringify(body)});msg('Agendamento salvo.');await loadStatus()}catch(e){msg(e.message)}}async function removeSchedule(id){if(!confirm('Excluir este agendamento?'))return;try{await api('/api/schedules/'+encodeURIComponent(id),{method:'DELETE'});await loadStatus()}catch(e){msg(e.message)}}async function setEnabled(enabled){try{await api('/api/enabled',{method:'POST',body:JSON.stringify({enabled})});await loadStatus()}catch(e){msg(e.message)}}
</script></body></html>`;
app.listen(PORT, () => console.log(`Robô Medeiros agendador em http://localhost:${PORT}`));
initClient();
