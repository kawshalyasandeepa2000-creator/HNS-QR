"use strict";
/* RISE 17 - private CSV Reference Contacts.
 * Uses authenticated Cloudflare Worker /api/admin/references endpoints.
 * CSV is parsed locally, and only reviewed fields are sent. No referral codes,
 * customer registration entries, marketing emails, or card photos are generated.
 */
(() => {
  const $ = selector => document.querySelector(selector);
  const els = {
    nav: $('#csv-references-nav'),
    open: $('#ref-open'), close: $('#ref-close'), panel: $('#ref-import-panel'),
    file: $('#ref-file'), prefix: $('#ref-prefix'), start: $('#ref-start'),
    template: $('#ref-template'), map: $('#ref-map'), preview: $('#ref-preview'),
    fileStatus: $('#ref-file-status'), previewCount: $('#ref-preview-count'),
    confirm: $('#ref-confirm'), stop: $('#ref-stop'), progress: $('#ref-progress'),
    importStatus: $('#ref-import-status'), total: $('#ref-count'),
    refresh: $('#ref-refresh'), export: $('#ref-export'), exportPdf: $('#ref-export-pdf'),
    search: $('#ref-search'), table: $('#ref-rows'), shown: $('#ref-shown'),
    feedback: $('#ref-feedback')
  };
  if(Object.values(els).some(el => !el)) return;

  const fields = [
    ['referenceNo','Reference Number (optional CSV column)'],
    ['personName','Person name'], ['companyName','Company name'],
    ['email','Email'], ['phone','Phone / WhatsApp'],
    ['jobTitle','Job title'], ['website','Website'], ['notes','Notes']
  ];
  const headerAliases = {
    referenceNo:['referenceno','referencenumber','refno','refnumber','referenceid','refid','identificationnumber','identificationid','customerid'],
    personName:['person','personname','contact','contactname','fullname','name','contactperson','individualname'],
    companyName:['company','companyname','business','businessname','organisation','organization','organizationname','firm'],
    email:['email','emailaddress','mail','e-mail','emailid','contactemail'],
    phone:['phone','phonenumber','telephone','mobile','mobilenumber','whatsapp','contactnumber','mobileno','mobilewhatsapp'],
    jobTitle:['jobtitle','designation','position','jobrole','role','title'],
    website:['website','weburl','web','companywebsite','url'],
    notes:['notes','note','comment','comments','remarks','remark']
  };
  const normHeader = value => String(value??'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'');
  const clean = (value, max=500) => String(value??'').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
  const validRef = ref => /^[A-Z0-9][A-Z0-9._-]{0,59}$/.test(ref);
  const validEmail = email => !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const validPhone = phone => !phone || /^[+\d][\d\s()./\-]{6,39}$/.test(phone);
  const validWebsite = web => !web || /^(?:https?:\/\/)?(?:www\.)?[\w-]+(?:\.[\w-]+)+(?::\d{2,5})?(?:\/[^\s]*)?$/i.test(web);
  let rows = [], headers = [], map = {}, overrides = new Map(), loaded = [], total = 0;
  let currentFile = '', importing = false, stopRequested = false, allFetched = false;

  const status = (element, message, error=false) => {
    element.textContent=message;
    element.classList.toggle('error',error);
  };
  const isSignedIn = () => !!adminToken && !dom.dashboard.classList.contains('hidden');

  async function referenceApi(path,{method='GET',data}={}) {
    if(!isSignedIn()) throw new Error('Admin login required. Sign in and try again.');
    if(!apiOrigin?.startsWith('https://')) throw new Error('Cloudflare API URL is not configured.');
    // The server also scopes DELETE/PATCH using the event parameter.
    const url=new URL(`${apiOrigin}${path}`);
    url.searchParams.set('event',selectedEventSlug);
    if(data!==undefined)data={...data,eventSlug:selectedEventSlug};
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    let response;
    try{
      response=await fetch(url.toString(),{
        method,headers:{Authorization:`Bearer ${adminToken}`,...(data!==undefined?{'Content-Type':'application/json'}:{})},
        ...(data!==undefined?{body:JSON.stringify(data)}:{}),
        cache:'no-store',signal:controller.signal
      });
    }catch(error){
      if(error?.name==='AbortError')throw new Error('Cloudflare request timed out. Try again.');
      throw new Error('Cannot reach Worker. Check network, Worker deployment and allowed CORS origins.');
    }finally{clearTimeout(timer);}
    if(!response.ok){
      const err=await response.json().catch(()=>({}));
      if(response.status===404)throw new Error('References API not installed (404). Deploy the References Worker update, then retry.');
      if(response.status===401)throw new Error('Admin token rejected (401). Sign in again.');
      if(response.status===403)throw new Error('Worker origin permission denied (403). Check CORS settings.');
      if(response.status===409)throw new Error('Reference number already exists (409).');
      throw new Error(`${err?.error||'Cloudflare request failed'} (HTTP ${response.status})`);
    }
    return response;
  }

  function csvRows(source) {
    // Quoted commas, doubled quote escapes, embedded newlines and CRLF.
    const text=String(source).replace(/^\uFEFF/,'');
    const data=[];let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(quoted){
        if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}
        else if(c==='"')quoted=false;
        else cell+=c;
      } else if(c==='"' && !cell){quoted=true;}
      else if(c===','){row.push(cell);cell='';}
      else if(c==='\r'||c==='\n'){
        if(c==='\r'&&text[i+1]==='\n')i++;
        row.push(cell);if(row.some(s=>String(s).trim()))data.push(row);
        row=[];cell='';
      }else cell+=c;
    }
    if(quoted)throw new Error('Invalid CSV: an unclosed quotation mark.');
    if(cell||row.length){row.push(cell);if(row.some(s=>String(s).trim()))data.push(row);}
    return data;
  }

  function suggestMapping() {
    const used=new Set();map={};
    for(const [field] of fields){
      const aliases=headerAliases[field].map(normHeader);
      let i=headers.findIndex((h,index)=>!used.has(index)&&aliases.includes(normHeader(h)));
      if(i<0)i=headers.findIndex((h,index)=>!used.has(index)&&aliases.some(alias=>normHeader(h).startsWith(alias)));
      map[field]=i;
      if(i>=0)used.add(i);
    }
  }
  function buildMapping() {
    els.map.replaceChildren();
    fields.forEach(([key,title])=>{
      const wrap=document.createElement('label');wrap.className='refs-map-label';
      const label=document.createElement('span');label.textContent=title;
      const select=document.createElement('select');select.dataset.key=key;
      select.append(new Option('— Not in file —','-1'));
      headers.forEach((h,i)=>select.append(new Option(`${i+1}. ${h||`Column ${i+1}`}`,String(i))));
      select.value=String(map[key]);
      select.addEventListener('change',()=>{map[key]=Number(select.value);overrides.clear();renderPreview();});
      wrap.append(label,select);els.map.append(wrap);
    });
  }
  const mapped=(cells,key,max=500)=>map[key]>=0?clean(cells[map[key]],max):'';
  function generatedReference(index){
    const prefix=clean(els.prefix.value,35).toUpperCase().replace(/\s+/g,'-');
    const start=Number(els.start.value);
    if(!Number.isSafeInteger(start)||start<1||start>999999)return '';
    return `${prefix}-${String(start+index).padStart(3,'0')}`;
  }
  function previewItems() {
    return rows.map((cells,index)=>{
      const csvRef=mapped(cells,'referenceNo',60).toUpperCase();
      const referenceNo=overrides.has(index)?overrides.get(index):csvRef||generatedReference(index);
      return {line:index+2,referenceNo,
        personName:mapped(cells,'personName',120),companyName:mapped(cells,'companyName',160),
        email:mapped(cells,'email',254).toLowerCase(),phone:mapped(cells,'phone',40),
        jobTitle:mapped(cells,'jobTitle',120),website:mapped(cells,'website',200),
        notes:mapped(cells,'notes',500),sourceFile:clean(currentFile,100)};
    });
  }
  function invalidReason(item, duplicate=false) {
    if(!validRef(item.referenceNo))return 'Invalid reference ID';
    if(duplicate)return 'Repeated reference ID in file';
    if(!item.personName&&!item.companyName)return 'Person/company missing';
    if(!validEmail(item.email))return 'Invalid email';
    if(!validPhone(item.phone))return 'Invalid phone';
    if(!validWebsite(item.website))return 'Invalid website';
    return '';
  }
  function itemReasons(items){
    const counts=new Map();
    items.forEach(item=>counts.set(item.referenceNo,(counts.get(item.referenceNo)||0)+1));
    return items.map(item=>invalidReason(item,counts.get(item.referenceNo)>1));
  }
  function previewStats() {
    const items=previewItems();const reasons=itemReasons(items);
    const good=reasons.filter(r=>!r).length, bad=reasons.length-good;
    status(els.importStatus,`${items.length} CSV contacts · ${good} ready · ${bad} need fixing. Edit reference numbers or change column mapping above.`,bad>0);
    els.previewCount.textContent=`${items.length} rows / ${good} valid`;
    els.confirm.disabled=!good||importing;
    return {items,reasons,good,bad};
  }
  function renderPreview(){
    els.preview.replaceChildren();
    const {items,reasons}=previewStats();
    items.forEach((item,index)=>{
      const tr=document.createElement('tr');if(reasons[index])tr.className='refs-invalid';
      function cell(value){const td=document.createElement('td');td.textContent=value||'—';tr.append(td);return td;}
      cell(item.line);
      const refTd=document.createElement('td');const inp=document.createElement('input');
      inp.value=item.referenceNo;inp.maxLength=60;inp.setAttribute('aria-label',`Reference number for row ${item.line}`);
      inp.dataset.index=String(index);
      inp.addEventListener('input',()=>{
        overrides.set(index,clean(inp.value,60).toUpperCase());
        previewStats();
      });
      inp.addEventListener('blur',renderPreview);
      refTd.append(inp);tr.append(refTd);
      cell(item.personName);cell(item.companyName);cell(item.email);cell(item.phone);cell(reasons[index]||'Ready');
      els.preview.append(tr);
    });
  }
  function resetPreview(){rows=[];headers=[];map={};overrides.clear();els.map.replaceChildren();els.preview.replaceChildren();els.confirm.disabled=true;els.previewCount.textContent='';}
  async function processFile(file){
    if(importing)return;
    resetPreview();currentFile=file?.name||'';
    try{
      if(!file||!file.name.toLowerCase().endsWith('.csv'))throw new Error('Select a .csv file. Excel → Save As → CSV UTF-8.');
      if(file.size>5*1024*1024)throw new Error('Max CSV file size is 5 MB. Split a larger file.');
      const data=csvRows(await file.text());
      if(data.length<2)throw new Error('CSV needs header row and at least one contact row.');
      if(data.length>301)throw new Error('Maximum 300 contacts per CSV import. Split the file into smaller batches.');
      headers=data[0].map(h=>clean(h,100));rows=data.slice(1);
      suggestMapping();buildMapping();renderPreview();
      status(els.fileStatus,`✓ ${currentFile}: ${rows.length} rows loaded locally. Check mapped columns and reference numbers.`);
    }catch(error){resetPreview();status(els.fileStatus,error.message,true);}
  }

  async function loadReferences(){
    if(!isSignedIn())return;
    const expectedEvent=selectedEventSlug;
    status(els.total,'Loading private reference contacts...');
    try{
      const data=await(await referenceApi('/api/admin/references')).json();
      if(expectedEvent!==selectedEventSlug)return;
      loaded=Array.isArray(data.items)?data.items:[];total=Number(data.total||0);allFetched=true;
      status(els.total,`${total} reference contacts stored separately in Cloudflare D1. Showing latest ${loaded.length}. Export CSV includes all.`);
      renderTable();
    }catch(error){allFetched=false;status(els.total,`⚠ ${error.message}`,true);}
  }
  function renderTable(){
    const q=els.search.value.toLowerCase().trim();
    const list=loaded.filter(item=>[item.referenceNo,item.personName,item.companyName,item.email,item.phone,item.jobTitle].some(v=>String(v||'').toLowerCase().includes(q)));
    els.table.replaceChildren();
    if(!list.length){
      const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=8;td.textContent=q?'No matches.':'No reference contacts imported yet.';tr.append(td);els.table.append(tr);
    }
    for(const item of list){
      const tr=document.createElement('tr');
      for(const key of ['referenceNo','personName','companyName','email','phone','jobTitle','createdAt']){
        const td=document.createElement('td');td.textContent=item[key]||'—';
        if(key==='referenceNo')td.className='refs-refno';tr.append(td);
      }
      const td=document.createElement('td'),del=document.createElement('button');
      del.type='button';del.className='refs-row-delete';del.textContent='Delete';del.dataset.id=item.id;
      del.setAttribute('aria-label',`Delete reference ${item.referenceNo}`);td.append(del);tr.append(td);
      els.table.append(tr);
    }
    els.shown.textContent=`${list.length} of ${total} references shown`;
  }
  function downloadCsv(data,name){
    const url=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=name;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  els.open.addEventListener('click',()=>{
    if(!isSignedIn()){alert('Admin login required.');return;}
    els.panel.classList.toggle('hidden');
    const opening=!els.panel.classList.contains('hidden');
    els.open.setAttribute('aria-expanded',String(opening));
    if(opening){if(!allFetched)loadReferences();els.panel.scrollIntoView({behavior:'smooth',block:'nearest'});}
  });
  els.close.addEventListener('click',()=>{if(importing)return;els.panel.classList.add('hidden');els.open.setAttribute('aria-expanded','false');});
  els.file.addEventListener('change',()=>processFile(els.file.files?.[0]));
  els.prefix.addEventListener('input',()=>{if(rows.length)renderPreview();});
  els.start.addEventListener('input',()=>{if(rows.length)renderPreview();});
  els.template.addEventListener('click',()=>downloadCsv('\uFEFFReference Number,Person Name,Company Name,Email,Phone,Job Title,Website,Notes\r\n',`${selectedEventSlug}-References-Template.csv`));
  els.stop.addEventListener('click',()=>{if(importing){stopRequested=true;els.stop.disabled=true;status(els.importStatus,'Stopping after current contact...');}});
  els.confirm.addEventListener('click',async()=>{
    if(importing||!isSignedIn())return;
    const {items,reasons,good,bad}=previewStats();
    if(!good){status(els.importStatus,'No valid contacts to import.',true);return;}
    if(!confirm(`Import ${good} contacts into separate References database? ${bad} invalid rows will be skipped. No existing records will be overwritten and no emails will be sent.`))return;
    importing=true;stopRequested=false;
    els.confirm.disabled=true;els.stop.disabled=false;els.file.disabled=true;
    els.progress.hidden=false;els.progress.max=good;els.progress.value=0;
    let saved=0,duplicates=0,failed=0,processed=0;
    const errors=[];
    try{
      for(let index=0;index<items.length;index++){
        if(stopRequested)break;
        if(reasons[index])continue;
        try{await referenceApi('/api/admin/references',{method:'POST',data:items[index]});saved++;}
        catch(error){
          if(/409|already exists/i.test(error.message))duplicates++;
          else{failed++;if(errors.length<3)errors.push(`Row ${items[index].line}: ${error.message}`);}
        }
        processed++;els.progress.value=processed;
        status(els.importStatus,`Saved ${saved} · duplicate IDs ${duplicates} · errors ${failed} · processed ${processed}/${good}`);
      }
      status(els.importStatus,`${stopRequested?'Stopped. ':'Finished. '}Saved ${saved}; skipped ${duplicates} duplicate reference IDs; ${failed} errors.`+(errors.length?' '+errors.join(' | '):''),failed>0);
      if(saved)await loadReferences();
      if(!stopRequested&&!failed&&!bad){els.file.value='';resetPreview();}
    }finally{importing=false;els.file.disabled=false;els.stop.disabled=true;els.confirm.disabled=!rows.length;}
  });
  els.refresh.addEventListener('click',loadReferences);
  window.addEventListener('hns:event-references-view',()=>{if(isSignedIn())loadReferences();});
  window.addEventListener('hns:event-changed',()=>{loaded=[];total=0;allFetched=false;stopRequested=true;els.prefix.value=selectedEventSlug.toUpperCase();els.table.replaceChildren();status(els.total,'Loading selected event references…');});
  els.search.addEventListener('input',renderTable);
  els.export.addEventListener('click',async()=>{
    els.export.disabled=true;
    try{
      const csv=await(await referenceApi('/api/admin/references/export.csv')).text();
      downloadCsv(csv,`${selectedEventSlug}-Business-Card-Details.csv`);
      status(els.feedback,'✓ Separate references CSV exported.');
    }catch(error){status(els.feedback,`Export failed: ${error.message}`,true);}
    finally{els.export.disabled=false;}
  });
  els.exportPdf?.addEventListener('click',async()=>{
    if(!els.exportPdf)return;
    els.exportPdf.disabled=true;
    try{
      const csv=await(await referenceApi('/api/admin/references/export.csv')).text();
      const {headers,rows}=window.hnsDataExport.parseExportCsv(csv);
      window.hnsDataExport.exportTablePdf({
        title:'Card Details',
        subtitle:`${selectedEventName} · reference contacts · Save as PDF in print dialog`,
        headers:headers.length?headers:['Reference No.','Person','Company','Email','Mobile','Job title','Added (UTC)'],
        rows
      });
      status(els.feedback,'✓ PDF export opened. Choose Save as PDF.');
    }catch(error){status(els.feedback,`PDF export failed: ${error.message}`,true);}
    finally{els.exportPdf.disabled=false;}
  });
  els.table.addEventListener('click',async(event)=>{
    const button=event.target.closest('button[data-id]');if(!button)return;
    const item=loaded.find(r=>r.id===button.dataset.id);if(!item)return;
    if(!confirm(`Permanently delete reference ${item.referenceNo} (${item.personName||item.companyName})? Other references and customer registrations are not affected.`))return;
    button.disabled=true;
    try{await referenceApi(`/api/admin/references/${encodeURIComponent(item.id)}`,{method:'DELETE'});status(els.feedback,`✓ Reference ${item.referenceNo} deleted.`);await loadReferences();}
    catch(error){status(els.feedback,`Delete failed: ${error.message}`,true);button.disabled=false;}
  });
  // Existing admin.js keeps ADMIN_TOKEN only in memory; clear contact info on logout.
  $('#logout-button').addEventListener('click',()=>{
    loaded=[];total=0;allFetched=false;stopRequested=true;
    resetPreview();els.file.value='';els.panel.classList.add('hidden');
    els.open.setAttribute('aria-expanded','false');els.table.replaceChildren();els.search.value='';
    status(els.total,'Sign in to view references.');status(els.importStatus,'');status(els.feedback,'');
    els.shown.textContent='—';
  });
})();
