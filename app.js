/* La Meva Economia: dades només al dispositiu, en IndexedDB. */
const app = document.querySelector('#app');
const DB_NAME = 'la-meva-economia';
let db, state = { accounts: [], categories: [], movements: [], recurrings: [] };
let screen = 'home';
let summaryMonth = '';
let summaryMode = 'month';
let summaryFrom = '', summaryTo = '';
const euro = new Intl.NumberFormat('ca-ES', { style: 'currency', currency: 'EUR' });
const monthFormatter = new Intl.DateTimeFormat('ca-ES', { month: 'long', year: 'numeric' });
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => crypto.randomUUID();

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => ['accounts', 'categories', 'movements', 'recurrings'].forEach(s => request.result.createObjectStore(s, { keyPath: 'id' }));
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
function all(store) { return new Promise((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
function put(store, value) { return new Promise((resolve, reject) => { const r = db.transaction(store, 'readwrite').objectStore(store).put(value); r.onsuccess = resolve; r.onerror = () => reject(r.error); }); }
function remove(store, id) { return new Promise((resolve, reject) => { const r = db.transaction(store, 'readwrite').objectStore(store).delete(id); r.onsuccess = resolve; r.onerror = () => reject(r.error); }); }
async function refresh() { [state.accounts, state.categories, state.movements, state.recurrings] = await Promise.all(['accounts','categories','movements','recurrings'].map(all)); }
const find = (collection, id) => collection.find(x => x.id === id);
const nameOf = (collection, id, fallback = '—') => find(collection, id)?.name || fallback;
const amount = m => m.type === 'income' ? Number(m.amount) : -Number(m.amount);
const accountBalance = account => Number(account.initialBalance) + state.movements.filter(m => m.accountId === account.id).reduce((sum, m) => sum + amount(m), 0);
const esc = text => String(text || '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function bootstrap() {
  db = await openDB(); await refresh();
  if (!state.accounts.length) return renderSetup();
  if (!state.categories.length) await seedCategories();
  await generateRecurring(); await refresh(); render();
}
async function seedCategories() {
  const data = ['Habitatge','Alimentació','Transport','Salut','Oci','Compres','Subministraments','Altres','Nòmina','Freelance','Altres ingressos'];
  await Promise.all(data.map(name => put('categories', { id: uid(), name })));
}
function renderSetup() {
  app.innerHTML = `<section class="setup"><h1>La Meva Economia</h1><p>Comencem afegint les teves comptes i el seu saldo inicial.</p><form id="setup-form" class="form"><div id="setup-accounts"></div><button type="button" class="add-link" id="add-account">+ Afegir una altra compte</button><button class="btn">Començar</button></form></section>`;
  const addRow = () => document.querySelector('#setup-accounts').insertAdjacentHTML('beforeend', `<div class="account-row"><input required aria-label="Nom de la compte" placeholder="Nom de la compte" value="Compte principal"><input required aria-label="Saldo inicial" type="number" step="0.01" inputmode="decimal" placeholder="0,00"><button type="button" class="remove-row" aria-label="Eliminar">×</button></div>`);
  addRow();
  document.querySelector('#add-account').onclick = () => { addRow(); document.querySelectorAll('.account-row input:first-child').forEach((x,i) => { if(i) x.value=''; }); };
  document.querySelector('#setup-accounts').onclick = e => { if (e.target.classList.contains('remove-row') && document.querySelectorAll('.account-row').length > 1) e.target.parentElement.remove(); };
  document.querySelector('#setup-form').onsubmit = async e => { e.preventDefault(); const rows = [...document.querySelectorAll('.account-row')]; await Promise.all(rows.map(r => put('accounts', { id:uid(), name:r.children[0].value.trim(), initialBalance:Number(r.children[1].value) || 0 }))); await seedCategories(); await refresh(); render(); };
}
function layout(content, fab = false) {
  app.innerHTML = `<header class="screen-head"><h1>La Meva Economia</h1></header>${content}${fab ? '<button class="fab" id="add-movement" aria-label="Afegir moviment">+</button>' : ''}<nav class="bottom-nav"><button data-screen="home" class="${screen==='home'?'active':''}">Inici</button><button data-screen="summaries" class="${screen==='summaries'?'active':''}">Resums</button><button data-screen="history" class="${screen==='history'?'active':''}">Historial</button><button data-screen="accounts" class="${screen==='accounts'?'active':''}">Comptes</button><button data-screen="more" class="${screen==='more'?'active':''}">Més</button></nav>`;
  document.querySelectorAll('[data-screen]').forEach(b => b.onclick = () => { screen = b.dataset.screen; render(); });
  document.querySelector('#add-movement')?.addEventListener('click', () => movementModal());
}
function render() {
  if (screen === 'home') return renderHome(); if (screen === 'summaries') return renderSummaries(); if (screen === 'history') return renderHistory(); if (screen === 'accounts') return renderAccounts(); renderMore();
}
function renderHome() {
  const month = today().slice(0,7); const ms = state.movements.filter(m => m.date.startsWith(month));
  const total = state.accounts.reduce((sum,a) => sum + accountBalance(a), 0);
  const incomes = ms.filter(m => m.type==='income').reduce((s,m) => s + Number(m.amount),0);
  const expenses = ms.filter(m => m.type==='expense').reduce((s,m) => s + Number(m.amount),0);
  layout(`<section class="balance"><span>Saldo total</span><strong>${euro.format(total)}</strong></section><section class="summary"><article><span>Ingressos del mes</span><strong class="income">${euro.format(incomes)}</strong></article><article><span>Despeses del mes</span><strong class="expense">${euro.format(expenses)}</strong></article></section>`, true);
}
function renderSummaries() {
  const months = [...new Set(state.movements.map(m => m.date.slice(0, 7)))].sort().reverse();
  if (!months.includes(summaryMonth)) summaryMonth = months[0];
  const monthOptions = months.map(month => {
    const label = monthFormatter.format(new Date(`${month}-01T12:00:00`));
    return `<option value="${month}" ${month === summaryMonth ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');
  const periodOptions = [['month', 'Mensual'], ['range', 'Interval de dates'], ['all', 'Des de l’inici']];
  layout(`<section>
    <div class="section-top"><h2>Resums</h2>
      <select id="summary-mode" aria-label="Període del resum">${periodOptions.map(([value, label]) => `<option value="${value}" ${value === summaryMode ? 'selected' : ''}>${label}</option>`).join('')}</select>
    </div>
    ${summaryMode === 'month' && months.length ? `<div class="field"><label for="summary-month">Mes</label><select id="summary-month">${monthOptions}</select></div>` : ''}
    ${summaryMode === 'range' ? `<form id="summary-range" class="form">
      <div class="summary-dates">
        <div class="field"><label for="summary-from">Des de</label><input id="summary-from" name="from" type="date" required value="${esc(summaryFrom)}"></div>
        <div class="field"><label for="summary-to">Fins a</label><input id="summary-to" name="to" type="date" required value="${esc(summaryTo)}"></div>
      </div>
      <div><button class="btn">Mostra el resum</button></div>
      <p id="summary-error" class="expense" role="alert" hidden></p>
    </form>` : ''}
    <div id="summary-results"></div>
  </section>`);
  document.querySelector('#summary-mode').onchange = e => { summaryMode = e.target.value; renderSummaries(); };
  const monthSelect = document.querySelector('#summary-month');
  if (monthSelect) monthSelect.onchange = e => { summaryMonth = e.target.value; renderSummaryResults(); };
  const rangeForm = document.querySelector('#summary-range');
  if (rangeForm) rangeForm.onsubmit = e => {
    e.preventDefault();
    const { from, to } = Object.fromEntries(new FormData(rangeForm));
    const error = document.querySelector('#summary-error');
    error.hidden = from <= to;
    if (!error.hidden) {
      error.textContent = 'La data inicial ha de ser anterior o igual a la data final.';
      document.querySelector('#summary-results').innerHTML = '';
      return;
    }
    summaryFrom = from;
    summaryTo = to;
    renderSummaryResults();
  };
  renderSummaryResults();
}
const totalAmount = movements => movements.reduce((sum, m) => sum + Math.round(Number(m.amount) * 100), 0);
function renderSummaryResults() {
  const results = document.querySelector('#summary-results');
  if (summaryMode === 'range' && !summaryFrom) return;
  if (summaryMode !== 'month') {
    const expenses = state.movements.filter(m => m.type === 'expense' &&
      (summaryMode === 'all' || (m.date >= summaryFrom && m.date <= summaryTo)));
    results.innerHTML = `<section class="card month-balance"><span>Total de despeses</span><strong class="expense">${euro.format(totalAmount(expenses) / 100)}</strong></section>
      <section class="breakdown"><h2>Despeses per categoria</h2>${categoryBreakdown(expenses, 'No hi ha despeses en aquest període.', true)}</section>`;
    return;
  }
  if (!summaryMonth) {
    results.innerHTML = '<p class="empty">Encara no hi ha moviments per resumir.</p>';
    return;
  }
  const movements = state.movements.filter(m => m.date.slice(0, 7) === summaryMonth);
  const incomes = movements.filter(m => m.type === 'income');
  const expenses = movements.filter(m => m.type === 'expense');
  const totalIncomes = totalAmount(incomes);
  const totalExpenses = totalAmount(expenses);
  const balance = totalIncomes - totalExpenses;
  results.innerHTML = `<div class="summary month-balance">
      <article><span>Ingressos</span><strong class="income">${euro.format(totalIncomes / 100)}</strong></article>
      <article><span>Despeses</span><strong class="expense">${euro.format(totalExpenses / 100)}</strong></article>
    </div>
    <section class="card month-balance"><span>Balanç del mes</span><strong class="${balance >= 0 ? 'income' : 'expense'}">${euro.format(balance / 100)}</strong></section>
    <section class="breakdown"><h2>Despeses per categoria</h2>${categoryBreakdown(expenses, 'No hi ha despeses aquest mes.', true)}</section>
    <section class="breakdown"><h2>Ingressos per categoria</h2>${categoryBreakdown(incomes, 'No hi ha ingressos aquest mes.')}</section>`;
}
function categoryBreakdown(movements, emptyText, expandable = false) {
  if (!movements.length) return `<p class="empty breakdown-empty">${emptyText}</p>`;
  const groups = new Map();
  for (const movement of movements) {
    if (!groups.has(movement.categoryId)) groups.set(movement.categoryId, []);
    groups.get(movement.categoryId).push(movement);
  }
  const rows = [...groups].map(([id, items]) => ({
    category: nameOf(state.categories, id, 'Categoria eliminada'), items, total: totalAmount(items)
  })).sort((a, b) => b.total - a.total);
  return `<div class="list">${rows.map(({ category, items, total }) => {
    const heading = `<strong>${esc(category)}</strong><strong class="amount">${euro.format(total / 100)}</strong>`;
    if (!expandable) return `<article class="item">${heading}</article>`;
    const details = items.sort((a, b) => b.date.localeCompare(a.date)).map(m => `<li class="item">
      <div class="item-main"><strong>${esc(m.notes || category)}</strong><small>${esc(m.date)} · ${esc(nameOf(state.accounts, m.accountId))}</small></div>
      <span class="amount">${euro.format(m.amount)}</span></li>`).join('');
    return `<details class="category-detail"><summary class="item">${heading}</summary><ul class="list">${details}</ul></details>`;
  }).join('')}</div>`;
}
function renderHistory() {
  layout(`<section><div class="section-top"><h2>Historial</h2><button class="btn small secondary" id="clear-filters">Netejar</button></div><div class="filters"><input id="f-date" type="date" aria-label="Data"><select id="f-category"><option value="">Categoria</option>${categoryOptions()}</select><select id="f-account"><option value="">Compte</option>${accountOptions()}</select><select id="f-type"><option value="">Tipus</option><option value="income">Ingrés</option><option value="expense">Despesa</option></select><input id="f-min" type="number" step="0.01" placeholder="Import mínim"><input id="f-max" type="number" step="0.01" placeholder="Import màxim"></div><div id="movement-list" class="list"></div></section>`, true);
  const filter = () => {
    const date = document.querySelector('#f-date').value, cat=document.querySelector('#f-category').value, acc=document.querySelector('#f-account').value, type=document.querySelector('#f-type').value, min=Number(document.querySelector('#f-min').value), max=Number(document.querySelector('#f-max').value);
    const rows = state.movements.filter(m => (!date||m.date===date)&&(!cat||m.categoryId===cat)&&(!acc||m.accountId===acc)&&(!type||m.type===type)&&(!min||Number(m.amount)>=min)&&(!max||Number(m.amount)<=max)).sort((a,b)=>b.date.localeCompare(a.date));
    document.querySelector('#movement-list').innerHTML = rows.length ? rows.map(movementItem).join('') : '<p class="empty">No hi ha moviments.</p>';
    document.querySelectorAll('[data-edit-movement]').forEach(x => x.onclick = () => movementModal(x.dataset.editMovement));
  };
  document.querySelectorAll('.filters input,.filters select').forEach(x => x.oninput=filter); document.querySelector('#clear-filters').onclick=()=>{ document.querySelectorAll('.filters input,.filters select').forEach(x=>x.value=''); filter(); }; filter();
}
function movementItem(m) { return `<article class="item"><button class="item-main" data-edit-movement="${m.id}"><strong>${esc(m.notes || nameOf(state.categories,m.categoryId))}</strong><small>${m.date} · ${esc(nameOf(state.accounts,m.accountId))} · ${esc(nameOf(state.categories,m.categoryId))}</small></button><span class="amount ${m.type==='income'?'income':'expense'}">${m.type==='income'?'+':'−'}${euro.format(m.amount)}</span></article>`; }
function renderAccounts() {
  layout(`<section><div class="section-top"><h2>Comptes</h2><button class="btn small" id="new-account">Afegir</button></div><div class="list">${state.accounts.map(a=>`<article class="item"><div class="item-main"><strong>${esc(a.name)}</strong><small>Saldo inicial: ${euro.format(a.initialBalance)}</small></div><div><strong class="amount">${euro.format(accountBalance(a))}</strong><button data-edit-account="${a.id}" aria-label="Editar compte">✎</button></div></article>`).join('')}</div></section>`);
  document.querySelector('#new-account').onclick=()=>accountDialog(); document.querySelectorAll('[data-edit-account]').forEach(x=>x.onclick=()=>accountDialog(x.dataset.editAccount));
}
function renderMore() {
  layout(`<section class="list"><button class="item" id="categories"><span><strong>Categories</strong><small>Gestiona les categories</small></span><span>›</span></button><button class="item" id="recurrings"><span><strong>Moviments recurrents</strong><small>Ingressos i despeses mensuals</small></span><span>›</span></button></section>`);
  document.querySelector('#categories').onclick=categoriesModal; document.querySelector('#recurrings').onclick=recurringsModal;
}
function accountOptions(selected='') { return state.accounts.map(a=>`<option value="${a.id}" ${a.id===selected?'selected':''}>${esc(a.name)}</option>`).join(''); }
function categoryOptions(selected='') { return state.categories.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${esc(c.name)}</option>`).join(''); }
function modal(title, body) { document.body.insertAdjacentHTML('beforeend', `<div class="modal" id="modal"><section class="sheet"><header class="sheet-head"><h2>${title}</h2><button class="close" id="close-modal" aria-label="Tancar">×</button></header>${body}</section></div>`); document.querySelector('#close-modal').onclick=closeModal; }
function closeModal() { document.querySelector('#modal')?.remove(); }
function movementModal(id) {
  const m = find(state.movements,id) || { type:'expense', amount:'', date:today(), accountId:state.accounts[0]?.id, categoryId:state.categories[0]?.id, notes:'' };
  modal(id?'Edita moviment':'Nou moviment', `<form id="movement-form" class="form"><div class="type-switch"><button type="button" data-type="expense" class="${m.type==='expense'?'selected':''}">Despesa</button><button type="button" data-type="income" class="${m.type==='income'?'selected':''}">Ingrés</button></div><input type="hidden" name="type" value="${m.type}"><div class="field"><label>Import</label><input required name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" value="${m.amount}"></div><div class="field"><label>Categoria</label><select required name="categoryId">${categoryOptions(m.categoryId)}</select></div><div class="field"><label>Data</label><input required name="date" type="date" value="${m.date}"></div><div class="field"><label>Compte</label><select required name="accountId">${accountOptions(m.accountId)}</select></div><div class="field"><label>Concepte o notes</label><textarea name="notes" placeholder="Opcional">${esc(m.notes)}</textarea></div><div class="actions"><button class="btn">Desar</button>${id?'<button type="button" class="btn danger" id="delete-movement">Eliminar</button>':''}</div></form>`);
  document.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{ document.querySelectorAll('[data-type]').forEach(x=>x.classList.remove('selected')); b.classList.add('selected'); document.querySelector('[name=type]').value=b.dataset.type; });
  document.querySelector('#movement-form').onsubmit=async e=>{ e.preventDefault(); const d=Object.fromEntries(new FormData(e.target)); await put('movements',{...m,id:m.id||uid(),...d,amount:Number(d.amount)}); await refresh(); closeModal(); render(); };
  document.querySelector('#delete-movement')?.addEventListener('click',async()=>{ if(confirm('Vols eliminar aquest moviment?')) { await remove('movements',id); await refresh(); closeModal(); render(); } });
}
function accountDialog(id) { const a=find(state.accounts,id); const name=prompt('Nom de la compte:',a?.name||''); if(name===null||!name.trim())return; const initial=prompt('Saldo inicial (€):',a?.initialBalance??'0'); if(initial===null)return; put('accounts',{id:a?.id||uid(),name:name.trim(),initialBalance:Number(String(initial).replace(',','.'))||0}).then(async()=>{await refresh();render();}); }
function categoriesModal() {
  const draw=()=>{ modal('Categories',`<div class="actions"><button class="btn small" id="new-category">Afegir categoria</button></div><div class="list" style="margin-top:14px">${state.categories.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<article class="item"><strong>${esc(c.name)}</strong><span><button data-edit-category="${c.id}">✎</button><button data-delete-category="${c.id}">×</button></span></article>`).join('')}</div>`); document.querySelector('#new-category').onclick=()=>changeCategory(); document.querySelectorAll('[data-edit-category]').forEach(x=>x.onclick=()=>changeCategory(x.dataset.editCategory)); document.querySelectorAll('[data-delete-category]').forEach(x=>x.onclick=()=>deleteCategory(x.dataset.deleteCategory)); };
  const changeCategory=async id=>{const c=find(state.categories,id), name=prompt('Nom de la categoria:',c?.name||'');if(name&&name.trim()){await put('categories',{id:c?.id||uid(),name:name.trim()});await refresh();closeModal();draw();}};
  const deleteCategory=async id=>{if(state.movements.some(m=>m.categoryId===id)||state.recurrings.some(r=>r.categoryId===id))return alert('No es pot eliminar una categoria que ja s’utilitza.');if(confirm('Vols eliminar aquesta categoria?')){await remove('categories',id);await refresh();closeModal();draw();}}; draw();
}
function recurringsModal() {
  const draw=()=>{ modal('Moviments recurrents',`<div class="actions"><button class="btn small" id="new-recurring">Afegir moviment</button></div><div class="list" style="margin-top:14px">${state.recurrings.length?state.recurrings.map(r=>`<article class="item"><button class="item-main" data-edit-recurring="${r.id}"><strong>${esc(r.notes||nameOf(state.categories,r.categoryId))}</strong><small>Cada mes, dia ${r.day} · ${r.type==='income'?'Ingrés':'Despesa'} · ${euro.format(r.amount)}</small></button><button data-delete-recurring="${r.id}">×</button></article>`).join(''):'<p class="empty">No hi ha moviments recurrents.</p>'}</div>`); document.querySelector('#new-recurring').onclick=()=>recurringForm(); document.querySelectorAll('[data-edit-recurring]').forEach(x=>x.onclick=()=>recurringForm(x.dataset.editRecurring)); document.querySelectorAll('[data-delete-recurring]').forEach(x=>x.onclick=async()=>{if(confirm('Vols eliminar aquest moviment recurrent?')){await remove('recurrings',x.dataset.deleteRecurring);await refresh();closeModal();draw();}}); };
  const recurringForm=id=>{const r=find(state.recurrings,id)||{type:'expense',amount:'',day:new Date().getDate(),accountId:state.accounts[0]?.id,categoryId:state.categories[0]?.id,notes:''};closeModal();modal(id?'Edita moviment recurrent':'Nou moviment recurrent',`<form id="recurring-form" class="form"><div class="type-switch"><button type="button" data-type="expense" class="${r.type==='expense'?'selected':''}">Despesa</button><button type="button" data-type="income" class="${r.type==='income'?'selected':''}">Ingrés</button></div><input name="type" type="hidden" value="${r.type}"><div class="field"><label>Import</label><input required name="amount" type="number" min="0.01" step="0.01" value="${r.amount}"></div><div class="field"><label>Categoria</label><select name="categoryId">${categoryOptions(r.categoryId)}</select></div><div class="field"><label>Compte</label><select name="accountId">${accountOptions(r.accountId)}</select></div><div class="field"><label>Dia de cada mes</label><input required name="day" type="number" min="1" max="31" value="${r.day}"></div><div class="field"><label>Concepte o notes</label><textarea name="notes">${esc(r.notes)}</textarea></div><button class="btn">Desar</button></form>`); document.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-type]').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');document.querySelector('[name=type]').value=b.dataset.type;});document.querySelector('#recurring-form').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));await put('recurrings',{...r,id:r.id||uid(),...d,amount:Number(d.amount),day:Number(d.day),lastGenerated:r.lastGenerated||''});await refresh();closeModal();recurringsModal();};}; draw();
}
async function generateRecurring() {
  const now=new Date(), current=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  for(const r of state.recurrings) { if(r.lastGenerated===current) continue; const last=r.lastGenerated || current; const [y,m]=current.split('-').map(Number); const day=Math.min(r.day,new Date(y,m,0).getDate()); const date=`${current}-${String(day).padStart(2,'0')}`; if(date<=today()) { await put('movements',{id:uid(),type:r.type,amount:Number(r.amount),categoryId:r.categoryId,accountId:r.accountId,notes:r.notes,date,recurringId:r.id}); await put('recurrings',{...r,lastGenerated:current}); } }
}
if ('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
bootstrap().catch(err=>{ app.innerHTML=`<p class="empty">No s’ha pogut obrir l’aplicació: ${esc(err.message)}</p>`; });
