"use strict";
// RISE 17 event-contact Excel/CSV import and Excel export.
// Client-side parsing; reviewed rows are saved through the existing authenticated
// Cloudflare business-card lead API. Does NOT alter or touch referrals.
(() => {
  const $ = selector => document.querySelector(selector);
  const ui = {
    pick: $('#lead-import-file'), open: $('#leads-import-open'), panel: $('#lead-import-panel'),
    close: $('#lead-import-close'), map: $('#lead-import-map'),
    preview: $('#lead-import-preview-rows'), info: $('#lead-import-info'),
    fileStatus: $('#lead-import-file-status'), status: $('#lead-import-status'),
    confirm: $('#lead-import-confirm'), cancel: $('#lead-import-cancel'),
    template: $('#lead-import-template'), exportXlsx: $('#leads-export-excel'),
    progress: $('#lead-import-progress'), fileInput: $('#lead-import-file')
  };
  if (Object.values(ui).some(el => !el)) return;
  const fields = [
    ['personName','Person name'], ['companyName','Company name'],
    ['email','Email address'], ['phone','Phone / WhatsApp'],
    ['jobTitle','Job title'], ['website','Website'],
    ['eventName','Event'], ['notes','Notes']
  ];
  const aliases = {
    personName: ['person','personname','contact','contactname','fullname','name','firstnameandlastname','contactperson','individual','individualname'],
    companyName: ['company','companyname','organisation','organization','business','businessname','firm','employer','companyorganisation'],
    email: ['email','emailaddress','emailid','mail','mailaddress','e-mail','workemail','contactemail'],
    phone: ['phone','phonenumber','telephone','tel','mobile','mobilenumber','mobilephone','contactnumber','whatsapp','whatsappnumber','cell','cellphone','phonewhatsapp','telephone1','directline'],
    jobTitle: ['jobtitle','title','role','designation','position','profession','occupation'],
    website: ['website','web','weburl','url','companywebsite','site'],
    eventName: ['event','eventname','campaign','campaignname','exhibition','conference'],
    notes: ['notes','note','comments','remarks','description','followup','remark']
  };
  const normHeader = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[^a-z0-9]+/g,'');
  const cleanText = (value, max=500) => String(value ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
  const canonicalEmail = x => cleanText(x,254).toLowerCase();
  const canonicalPhone = x => cleanText(x,40).replace(/\D/g, '');
  const keyFor = r => {
    const email=canonicalEmail(r.email);
    if (email) return `email:${email}`;
    const phone=canonicalPhone(r.phone);
    if (phone.length>=8) return `phone:${phone}`;
    if (r.personName && r.companyName) return `named:${normHeader(r.personName)}:${normHeader(r.companyName)}`;
    return '';
  };
  // Also match by phone if email is present: the same person might use another email.
  const allKeys = r => {
    const keys=[];
    const em=canonicalEmail(r.email),ph=canonicalPhone(r.phone);
    if(em)keys.push(`email:${em}`);
    if(ph.length>=8)keys.push(`phone:${ph}`);
    if(!keys.length&&r.personName&&r.companyName)keys.push(keyFor(r));
    return keys;
  };

  let rows = [], headers = [], mapping = {}, selected = [], importRunning = false,
    stopRequested = false, importFileName = '', xlsxLoading = null;
  const setStatus = (message, bad=false) => {
    ui.status.textContent=message;
    ui.status.classList.toggle('lead-import-error', bad);
  };
  const setFileStatus=(message,bad=false)=>{
    ui.fileStatus.textContent=message;
    ui.fileStatus.classList.toggle('lead-import-error',bad);
  };
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  function parseCsv(source) {
    // RFC4180 compatible CSV: quoted commas, escaped quotes, and newlines.
    const str=String(source).replace(/^\uFEFF/,'');
    const out=[];let current=[],field='',quoted=false;
    for(let i=0;i<str.length;i++) {
      const c=str[i];
      if(quoted) {
        if(c==='"'&&str[i+1]==='"'){field+='"';i++;}
        else if(c==='"'){quoted=false;}
        else field+=c;
      } else if(c==='"'&&field===''){quoted=true;}
      else if(c===','){current.push(field);field='';}
      else if(c==='\r'||c==='\n') {
        if(c==='\r'&&str[i+1]==='\n')i++;
        current.push(field);out.push(current);current=[];field='';
      } else field+=c;
    }
    if(quoted)throw new Error('CSV file has an unclosed quoted cell.');
    if(field!==''||current.length){current.push(field);out.push(current);}
    return out;
  }
  function parseCsvToRows(csv){return parseCsv(csv).filter(row=>row.some(c=>String(c).trim()));}
  async function loadXlsx() {
    if(window.XLSX)return window.XLSX;
    if(!xlsxLoading)xlsxLoading=new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      s.async=true;
      s.onload=()=>window.XLSX?resolve(window.XLSX):reject(new Error('Excel reader did not load.'));
      s.onerror=()=>reject(new Error('Excel reader could not load. Connect to internet or save your Excel file as CSV.'));
      document.head.append(s);
    }).catch(err=>{xlsxLoading=null;throw err;});
    return xlsxLoading;
  }
  async function fileToRows(file) {
    const ext=(file.name.split('.').pop()||'').toLowerCase();
    if(file.size>8*1024*1024)throw new Error('File is larger than 8 MB. Please split it into smaller files.');
    if(ext==='csv')return parseCsvToRows(await file.text());
    if(ext==='xlsx'||ext==='xls') {
      const XLSX=await loadXlsx();
      const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false,cellText:true});
      if(!wb.SheetNames.length)throw new Error('No worksheets found in this file.');
      // All contact rows must be in the first worksheet; prevents accidental
      // duplicate imports from hidden/archived or summary sheets.
      const ws=wb.Sheets[wb.SheetNames[0]];
      const data=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,blankrows:false});
      return data.map(r=>r.map(v=>String(v??''))).filter(r=>r.some(c=>c.trim()));
    }
    throw new Error('Choose an Excel .xlsx/.xls or .csv file.');
  }
  function suggestMapping(head) {
    const used=new Set(),map={};
    for(const [field] of fields) {
      const variants=new Set((aliases[field]||[]).map(normHeader));
      let index=head.findIndex((h,i)=>!used.has(i)&&variants.has(normHeader(h)));
      // For common headers with text after the label, e.g. "Mobile Number (UAE)".
      if(index<0) index=head.findIndex((h,i)=>!used.has(i)&&
        (aliases[field]||[]).some(a=>normHeader(h).startsWith(normHeader(a))));
      if(index>=0){map[field]=index;used.add(index);}else map[field]=-1;
    }
    return map;
  }
  function resetPreview() {
    rows=[];headers=[];mapping={};selected=[];
    ui.map.replaceChildren();ui.preview.replaceChildren();
    ui.confirm.disabled=true;ui.info.textContent='';ui.progress.value=0;ui.progress.hidden=true;
  }
  function buildMap() {
    ui.map.replaceChildren();
    for(const [field,label] of fields) {
      const wrap=document.createElement('label');wrap.className='lead-import-map-item';
      const t=document.createElement('span');t.textContent=label;
      const select=document.createElement('select');select.dataset.field=field;
      const none=new Option('— Not in file —','-1');select.append(none);
      headers.forEach((head,i)=>select.append(new Option(`${String.fromCharCode(65+i%26)} · ${head||`Column ${i+1}`}`,String(i))));
      select.value=String(mapping[field]??-1);
      select.addEventListener('change',()=>{mapping[field]=Number(select.value);renderPreview();});
      wrap.append(t,select);ui.map.append(wrap);
    }
  }
  function rowFromValues(line) {
    const object={};
    for(const [key] of fields) {
      const col=mapping[key];
      object[key]=col>=0?cleanText(line[col],key==='notes'?500:key==='email'?254:key==='website'?200:key==='companyName'?160:key==='personName'?120:key==='phone'?40:120):'';
    }
    object.email=canonicalEmail(object.email);
    object.eventName=object.eventName||'RISE 17 - 2026';
    return object;
  }
  function validationError(item) {
    if(!item.personName&&!item.companyName)return 'Missing person/company';
    if(item.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email))return 'Invalid email';
    if(item.phone&&!/^[+\d][\d\s()./\-]{6,39}$/.test(item.phone))return 'Invalid phone';
    if(item.website&&!/^(?:https?:\/\/)?(?:www\.)?[\w-]+(?:\.[\w-]+)+(?::\d{2,5})?(?:\/[^\s]*)?$/i.test(item.website))return 'Invalid website';
    return '';
  }
  function td(row,value) {const c=document.createElement('td');c.textContent=String(value??'—');row.append(c);}
  function renderPreview() {
    selected=rows.slice(1).map((r,i)=>({line:i+2,record:rowFromValues(r)}));
    const invalid=selected.filter(x=>validationError(x.record)).length;
    const good=selected.length-invalid;
    ui.info.textContent=`${selected.length} data rows · ${good} valid · ${invalid} need correction. First ${Math.min(8,selected.length)} shown below.`;
    ui.preview.replaceChildren();
    selected.slice(0,8).forEach(item=>{
      const tr=document.createElement('tr');
      td(tr,item.line);td(tr,item.record.personName);td(tr,item.record.companyName);
      td(tr,item.record.email);td(tr,item.record.phone);
      td(tr,validationError(item.record)||'Ready');ui.preview.append(tr);
    });
    ui.confirm.disabled=!good||importRunning|| (mapping.personName<0&&mapping.companyName<0);
    setStatus((mapping.personName<0&&mapping.companyName<0)
      ? 'Select at least one Person name or Company name column before importing.'
      : `${good} valid rows ready. Preview and check the mapped columns before Confirm Import.`,
      mapping.personName<0&&mapping.companyName<0);
  }
  async function previewFile(file) {
    if(importRunning)return;
    resetPreview();importFileName=file.name;
    setFileStatus(`Reading ${file.name}...`);
    try {
      const parsed=await fileToRows(file);
      if(parsed.length<2)throw new Error('File needs a header row and at least one contact row.');
      if(parsed.length>1001)throw new Error('Please import no more than 1,000 contacts at once. Split the file into batches.');
      rows=parsed;
      headers=parsed[0].map((h,i)=>cleanText(h,100)||`Column ${i+1}`);
      mapping=suggestMapping(headers);buildMap();renderPreview();
      setFileStatus(`${file.name} · ${rows.length-1} contacts · columns mapped from first row.`);
    } catch(error) {resetPreview();setFileStatus(error.message||'Could not read spreadsheet.',true);setStatus('Choose another file or save it as CSV.',true);}
  }
  ui.open.addEventListener('click',()=>{
    if(dom.dashboard.classList.contains('hidden'))return;
    ui.panel.classList.toggle('hidden');ui.open.setAttribute('aria-expanded',String(!ui.panel.classList.contains('hidden')));
    if(!ui.panel.classList.contains('hidden'))ui.panel.scrollIntoView({behavior:'smooth',block:'nearest'});
  });
  ui.close.addEventListener('click',()=>{if(!importRunning){ui.panel.classList.add('hidden');ui.open.setAttribute('aria-expanded','false');}});
  ui.fileInput.addEventListener('change',async()=>{const f=ui.fileInput.files?.[0];if(f)await previewFile(f);});
  ui.template.addEventListener('click',()=>{
    const text='\uFEFFPerson name,Company name,Email address,Phone / WhatsApp,Job title,Website,Event,Notes\r\n';
    const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='RISE17-Import-Contacts-Template.csv';
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  ui.cancel.addEventListener('click',()=>{
    if(!importRunning)return;
    stopRequested=true;ui.cancel.disabled=true;
    setStatus('Stopping after the requests currently in progress...');
  });
  ui.confirm.addEventListener('click',async()=>{
    if(importRunning||!selected.length)return;
    if(!adminToken||dom.dashboard.classList.contains('hidden')) {setStatus('Please sign in as admin before importing.',true);return;}
    const eligible=selected.filter(x=>!validationError(x.record));
    if(!eligible.length){setStatus('No valid rows to import.',true);return;}
    const confirmed=confirm(`Import contacts from ${importFileName}? Only approved fields will be sent to private Cloudflare D1. Existing records will not be overwritten. Duplicates based on email or phone will be skipped.`);
    if(!confirmed)return;
    importRunning=true;stopRequested=false;
    ui.confirm.disabled=true;ui.fileInput.disabled=true;ui.cancel.disabled=false;
    ui.progress.hidden=false;ui.progress.max=eligible.length;ui.progress.value=0;
    let sent=0,skipped=0,failed=0,done=0;
    const failures=[];
    try {
      setStatus('Checking existing saved contacts for duplicates...');
      // Check ALL existing contacts, not just the 200 records displayed in the table.
      // This uses the same authenticated CSV endpoint as the existing export button.
      const csv=await(await leadApi('/api/admin/business-cards/export.csv')).text();
      const existing=parseCsvToRows(csv);
      const colNames=(existing[0]||[]).map(normHeader);
      const idx=n=>colNames.indexOf(normHeader(n));
      const existingKeys=new Set();
      for(const row of existing.slice(1)) {
        const record={email:row[idx('email')]||'',phone:row[idx('phone')]||'',
          personName:row[idx('person_name')]||'',companyName:row[idx('company_name')]||''};
        for(const key of allKeys(record))existingKeys.add(key);
      }
      const seen=new Set(existingKeys);
      const queue=[];
      for(const item of eligible){
        const keys=allKeys(item.record);
        if(keys.some(key=>seen.has(key))){skipped++;done++;continue;}
        keys.forEach(k=>seen.add(k));queue.push(item);
      }
      ui.progress.value=done;
      setStatus(`Importing ${queue.length} new contacts; ${skipped} duplicates skipped...`);
      // Concurrency 2 keeps Worker requests responsive and limits mobile data use.
      let index=0;
      async function worker(){
        while(!stopRequested) {
          const position=index++;
          if(position>=queue.length)break;
          const item=queue[position];
          try{await leadApi('/api/admin/business-cards',{method:'POST',data:item.record});sent++;}
          catch(err){failed++;failures.push(`Row ${item.line}: ${err.message||'Save failed'}`);}
          done++;ui.progress.value=done;
          setStatus(`Saved ${sent} · duplicates skipped ${skipped} · failed ${failed} · ${done}/${eligible.length} processed`);
        }
      }
      await Promise.all([worker(),worker()]);
      const stopped=stopRequested;
      setStatus(`${stopped?'Stopped. ':'Completed. '}Saved ${sent}; skipped ${skipped} duplicates; failed ${failed}.`+
        (failures.length?' Errors: '+failures.slice(0,2).join(' | '):''),!!failed);
      if(sent>0)await loadBusinessCardLeads();
      if(!stopped&&!failed){ui.fileInput.value='';resetPreview();ui.progress.hidden=false;ui.progress.max=1;ui.progress.value=1;}
    }catch(error){setStatus(`Import not started / interrupted: ${error.message}. No existing contacts were overwritten.`,true);}
    finally {importRunning=false;ui.fileInput.disabled=false;ui.cancel.disabled=true;ui.confirm.disabled=!selected.some(x=>!validationError(x.record));}
  });
  ui.exportXlsx.addEventListener('click',async()=>{
    if(!adminToken||dom.dashboard.classList.contains('hidden'))return;
    ui.exportXlsx.disabled=true;
    try {
      const XLSX=await loadXlsx();
      const csv=await(await leadApi('/api/admin/business-cards/export.csv')).text();
      const grid=parseCsvToRows(csv);
      if(!grid.length)throw new Error('No contacts to export.');
      // The CSV export prefixes dangerous formula-like values with an apostrophe.
      // In XLSX, use explicit string cells instead, keeping the displayed phone
      // numbers (including +971) intact without executable spreadsheet formulas.
      const cells=grid.map((row,rowIndex)=>row.map(value=>
        rowIndex>0 && /^'[=+@\-\t\r]/.test(value) ? value.slice(1) : value));
      const ws=XLSX.utils.aoa_to_sheet(cells);
      for (const address of Object.keys(ws)) {
        if (address.startsWith('!')) continue;
        if (typeof ws[address].v === 'string') {ws[address].t='s';delete ws[address].f;}
      }
      ws['!cols']=[{wch:26},{wch:31},{wch:33},{wch:22},{wch:25},{wch:30},{wch:23},{wch:36},{wch:26},{wch:26}];
      const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'RISE 17 Contacts');
      XLSX.writeFile(wb,'RISE17-2026-Business-Card-Leads.xlsx');
    }catch(error){alert(`Could not export Excel file: ${error.message||'Please try the CSV export.'}`);}
    finally{ui.exportXlsx.disabled=false;}
  });
  $('#logout-button').addEventListener('click',()=>{
    stopRequested=true;rows=[];selected=[];headers=[];mapping={};
    ui.fileInput.value='';ui.panel.classList.add('hidden');ui.open.setAttribute('aria-expanded','false');
    resetPreview();ui.fileStatus.textContent='Choose an Excel or CSV file (up to 1,000 rows).';setStatus('');
  });
})();
