const AREAS=CFG.areas,TYPES=CFG.types,DAYS=CFG.days,C=CFG.contact;
let SCHED={},NEXT={},photoV=Date.now(),repImage="",regPhoto="";
const ZONES=[["Kawempe",10,10,180,90],["Nakawa",200,10,190,100],["Rubaga",10,110,130,100],["Central",150,110,100,100],["Makindye",260,120,130,90]];
const PUB=[["home","Home","🏠"],["report","Report a problem","📍"],["track","Track my report","🔎"],["schedule","Schedule","🗓️"],["learn","Learn","♻️"],["assistant","AI assistant","🤖"],["contact","Contact","📞"]];
const STAFF=[["dashboard","Dashboard","📊"],["tickets","Tickets","🎫"],["zones","Zones map","🗺️"],["profile","My profile","🙍"],["staff","Staff","👥",1],["messages","Messages sent","✉️",1]];
const TITLES={home:"Home",report:"Report a problem",track:"Track my report",schedule:"Collection schedule",learn:"Learn",assistant:"AI assistant",contact:"Contact us",login:"Staff access",profile:"My profile",dashboard:"Dashboard",tickets:"Tickets",zones:"Zones map",staff:"Staff",messages:"Messages sent"};
let trackPhone="",me=null,page="home",authRole="collector",authMode="login",tickets=[],staff=[],msgs=[],stats={total:0,open:0,progress:0,resolved:0},trackRes=null,flt="All",q="",repArea="",lastReport=null,hist=[],log=null;
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const cnt=(k,v)=>tickets.filter(t=>t[k]==v).length;
const isAdmin=()=>me&&me.role=="administrator";
async function api(url,method="GET",body){
 const r=await fetch(url,{method,headers:{"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
 const j=await r.json().catch(()=>({}));
 if(!r.ok){const e=new Error(j.error||"Request failed");e.status=r.status;throw e}return j}
function toast(m){const d=document.createElement("div");d.className="toast";d.textContent=m;document.body.appendChild(d);setTimeout(()=>d.remove(),3200)}
function toggleSide(f){const s=$("#side"),c=$("#scrim");const open=f===undefined?!s.classList.contains("open"):f;s.classList.toggle("open",open);c.classList.toggle("show",open)}
const pill=s=>`<span class="pill ${s}">${s=="Progress"?"In progress":s}</span>`;
const fmt=d=>d?String(d).slice(0,16).replace("T"," "):"";
const fdate=d=>d?new Date(d+"T00:00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",year:"numeric"}):"To be confirmed";
const avatar=(id,name,has,cls="")=>has?`<img class="avimg ${cls}" src="/img/staff/${id}?v=${photoV}" alt="${esc(name)}">`:`<span class="av" style="${cls=="lg"?"width:84px;height:84px;font-size:2rem":cls=="md"?"width:44px;height:44px":""}">${esc((name||"?")[0])}</span>`;
function readImage(file,max,q){return new Promise((res,rej)=>{if(!file)return res("");const fr=new FileReader();fr.onerror=()=>rej(new Error("Could not read the photo"));fr.onload=()=>{const im=new Image();im.onerror=()=>rej(new Error("That file is not a valid image"));im.onload=()=>{const k=Math.min(1,max/Math.max(im.width,im.height)),c=document.createElement("canvas");c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);c.getContext("2d").drawImage(im,0,0,c.width,c.height);res(c.toDataURL("image/jpeg",q))};im.src=fr.result};fr.readAsDataURL(file)})}
async function pickImg(inp,kind){try{const d=await readImage(inp.files[0],kind=="report"?900:320,.72);if(kind=="report"){repImage=d;$("#rprev").innerHTML=d?`<img src="${d}" alt="Preview">`:""}else{regPhoto=d;$("#pprev").innerHTML=d?`<img src="${d}" alt="Preview">`:""}}catch(e){toast(e.message)}}

/* ---------- layout ---------- */
function side(){
 const item=([k,l,i])=>`<a class="${page==k?'on':''}" onclick="go('${k}')"><span>${i}</span>${l}</a>`;
 let s=`<div class="brand" onclick="go('home')"><div class="logo">♻</div><div>Kampala Solid Waste<small>Citizen engagement portal</small></div></div><div class="grp">Public</div>`+PUB.map(item).join("")+`<div class="grp">Staff</div>`;
 if(!me)s+=[["login:collector","Collector login","🧑‍🔧"],["login:administrator","Administrator login","🛡️"]].map(item).join("");
 else s+=STAFF.filter(x=>!x[3]||isAdmin()).map(item).join("")+`<a onclick="logout()"><span>🚪</span>Log out</a>`;
 $("#side").innerHTML=s}
function topbar(){
 const base=page.split(":")[0],un=tickets.filter(t=>t.status!="Resolved").length;
 $("#top").innerHTML=`<button class="ham" onclick="toggleSide()" aria-label="Menu">☰</button><h1>${TITLES[base]||""}</h1><div class="sp"></div>`+
 (me?`<span class="bell" title="Unresolved reports">🔔<b>${un}</b></span><div class="chip">${avatar(me.id,me.name,me.has_photo)}<div>${esc(me.name)}<small>${me.role}</small></div></div>`:`<button class="btn s" onclick="go('report')">Report a problem</button>`)}

/* ---------- navigation ---------- */
async function go(p){
 if(p.startsWith("login:"))authRole=p.split(":")[1];
 let base=p.split(":")[0];
 if(["dashboard","tickets","zones","staff","messages","profile"].includes(base)){
  if(!me){p="login:"+authRole;base="login"}
  else if(["staff","messages"].includes(base)&&!isAdmin()){p="dashboard";base="dashboard"}}
 page=p;
 try{
  if(base=="home")stats=await api("/api/stats");
  if(["schedule","zones","tickets"].includes(base)){const s=await api("/api/schedule");SCHED=s.schedule;NEXT=s.next}
  if(["dashboard","tickets","zones"].includes(base))tickets=await api("/api/tickets");
  if(base=="tickets"&&isAdmin())staff=await api("/api/staff");
  if(base=="staff")staff=await api("/api/staff");
  if(base=="messages")msgs=await api("/api/messages");
 }catch(e){if(e.status==401){me=null;page="login:"+authRole;toast("Please log in again")}else toast(e.message)}
 render();scrollTo(0,0);toggleSide(false)}
function render(){
 side();topbar();
 const base=page.split(":")[0];
 $("#main").innerHTML=VIEWS[base]();
 if(base=="assistant"){log=$("#log");addM("Hello! Ask me about reporting problems, collection days or recycling in Kampala.","bt2");const i=$("#q");i.addEventListener("keydown",e=>{if(e.key=="Enter")ask(i.value)})}}

/* ---------- charts ---------- */
function days(){const o=[];for(let i=6;i>=0;i--)o.push(new Date(Date.now()-i*864e5).toISOString().slice(0,10));return o}
function lineChart(labels,a,b){
 const W=600,H=230,L=34,R=14,T=16,B=30,mx=Math.max(4,...a,...b);
 const x=i=>L+i*(W-L-R)/(labels.length-1),y=v=>T+(H-T-B)*(1-v/mx);
 const pts=s=>s.map((v,i)=>`${x(i)},${y(v)}`).join(" ");
 let g="";for(let k=0;k<=4;k++){const v=Math.round(mx*k/4);g+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--ln)"/><text x="${L-6}" y="${y(v)+3}" text-anchor="end">${v}</text>`}
 const lab=labels.map((d,i)=>`<text x="${x(i)}" y="${H-10}" text-anchor="middle">${d.slice(5)}</text>`).join("");
 const dots=a.map((v,i)=>`<g><rect x="${x(i)-11}" y="${y(v)-20}" width="22" height="15" rx="3" fill="var(--ac)"/><text class="v" x="${x(i)}" y="${y(v)-9}" text-anchor="middle">${v}</text></g>`).join("");
 return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Reports per day">${g}<polygon points="${L},${H-B} ${pts(a)} ${x(a.length-1)},${H-B}" fill="var(--ac)" opacity=".12"/><polyline points="${pts(a)}" fill="none" stroke="var(--ac)" stroke-width="2.5"/><polyline points="${pts(b)}" fill="none" stroke="var(--b)" stroke-width="2.5" stroke-dasharray="5 4"/>${dots}${lab}</svg><div class="leg sub"><span style="--c:var(--ac)">Reported</span><span style="--c:var(--b)">Resolved</span></div>`}
function bars(list,key){const mx=Math.max(1,...list.map(x=>cnt(key,x)));return list.map(x=>{const c=cnt(key,x);return`<div class="hbar"><span>${x}</span><div><i style="width:${c/mx*100}%"></i></div><b>${c}</b></div>`}).join("")}
function donut(){const p=tickets.length||1,o=cnt("status","Open")/p*360,g=o+cnt("status","Progress")/p*360;
 return`<div class="leg"><div class="donut" style="background:conic-gradient(var(--r) 0 ${o}deg,var(--a) ${o}deg ${g}deg,var(--ac) ${g}deg 360deg)"></div><div><span style="--c:var(--r)">Open ${cnt("status","Open")}</span><br><span style="--c:var(--a)">In progress ${cnt("status","Progress")}</span><br><span style="--c:var(--ac)">Resolved ${cnt("status","Resolved")}</span></div></div>`}
function zoneMap(mode){
 const c={};AREAS.forEach(a=>c[a]=tickets.filter(t=>t.area==a&&t.status!="Resolved").length);const mx=Math.max(1,...Object.values(c));
 return`<svg viewBox="0 0 400 220" width="100%" id="map" role="img" aria-label="Map of Kampala divisions">`+ZONES.map(([n,x,y,w,h])=>{
  const heat=mode=="heat";
  return`<g ${heat?"":`onclick="pickArea('${n}')"`}><rect class="z ${heat?'heat':'pick'} ${!heat&&repArea==n?'on':''}" ${heat?`style="fill-opacity:${(.1+.8*c[n]/mx).toFixed(2)}"`:""} x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/><text x="${x+w/2}" y="${y+h/2}" text-anchor="middle">${n}</text>${heat?`<text class="sub" x="${x+w/2}" y="${y+h/2+18}" text-anchor="middle">${c[n]} unresolved</text>`:""}</g>`}).join("")+`</svg>`}

/* ---------- tables ---------- */
const sc=(ico,bg,val,lab)=>`<div class="card sc"><div class="sico" style="background:${bg}">${ico}</div><div><div class="stat">${val}</div><span class="mu">${lab}</span></div></div>`;
function ticketRows(list){
 if(!list.length)return`<p class="mu">No reports found.</p>`;
 const cols=staff.filter(s=>s.role=="collector");
 return`<div class="scroll"><table style="min-width:900px"><tr><th>ID</th><th>Photo</th><th>Division / place</th><th>Issue</th><th>Reporter</th><th>Status</th><th>Collector</th><th>Resolution date</th><th>Action</th></tr>`+list.map(t=>{
  const act=t.status=="Open"?`<button class="btn s" onclick="setS(${t.id},'Progress')">Start</button>`:t.status=="Progress"?`<button class="btn s" onclick="setS(${t.id},'Resolved')">Resolve</button>`:"✓";
  const as=isAdmin()?`<select style="padding:.25rem;width:auto" onchange="assign(${t.id},this.value)"><option value="">Unassigned</option>${cols.map(c=>`<option value="${c.id}" ${c.id==t.assigned_to?'selected':''}>${esc(c.name)}</option>`).join("")}</select>`:(t.assigned_name?`<span style="display:flex;gap:.4rem;align-items:center">${avatar(t.assigned_to,t.assigned_name,t.assigned_photo)}${esc(t.assigned_name)}</span>`:"–");
  const ed=isAdmin()?`<input type="date" value="${t.expected_date||""}" onchange="setDate(${t.id},this.value)" style="width:auto;padding:.25rem">`:fdate(t.expected_date);
  const ph=t.has_image?`<a href="/img/ticket/${t.id}" target="_blank"><img class="thumb" src="/img/ticket/${t.id}" alt="Reported problem"></a>`:`<span class="mu">–</span>`;
  return`<tr><td>#${t.id}</td><td>${ph}</td><td><b>${esc(t.area)}</b><br><span class="mu sub">${esc(t.place)}</span></td><td>${esc(t.type)}</td><td><a href="tel:${esc(t.phone)}">${esc(t.phone)}</a></td><td>${pill(t.status)}</td><td>${as}</td><td>${ed}</td><td>${act}</td></tr>`}).join("")+`</table></div>`}
function filtered(){return tickets.filter(t=>flt=="All"||t.status==flt).filter(t=>!q||[t.id,t.place,t.area,t.type,t.phone].join(" ").toLowerCase().includes(q.toLowerCase()))}
function setQ(v){q=v;$("#tbl").innerHTML=ticketRows(filtered())}
function setF(f){flt=f;render()}
async function setS(id,s){try{const r=await api("/api/tickets/"+id,"PATCH",{status:s});
 toast(s=="Resolved"?"Resolved. Message to reporter: "+({sent:"sent by SMS",not_configured:"saved (SMS not set up)",failed:"SMS failed",sample:"skipped (sample data)"}[r.message_status]||"saved"):"Ticket updated");
 tickets=await api("/api/tickets");render()}catch(e){toast(e.message)}}
async function setDate(id,v){if(!v)return;try{await api("/api/tickets/"+id,"PATCH",{expected_date:v});toast("Date saved. The reporter was messaged.");tickets=await api("/api/tickets");render()}catch(e){toast(e.message)}}
async function assign(id,v){try{await api("/api/tickets/"+id,"PATCH",{assigned_to:v?+v:null});toast("Assigned. The collector was e-mailed.");tickets=await api("/api/tickets");render()}catch(e){toast(e.message)}}
async function demo(){try{await api("/api/demo","POST");tickets=await api("/api/tickets");toast("Sample data loaded");render()}catch(e){toast(e.message)}}

/* ---------- views ---------- */
const VIEWS={
profile:()=>`<div class="card"><div class="prof">${avatar(me.id,me.name,me.has_photo,"lg")}<div><h2 style="margin:0">${esc(me.name)}</h2><span class="mu" style="text-transform:capitalize">${me.role}</span><br><span class="mu sub">${esc(me.email)}</span></div></div>
<label for="pimg">${me.has_photo?"Change your photo":"Add your photo"} (residents see it when you are assigned to their report)</label><input id="pimg" type="file" accept="image/*" onchange="pickImg(this,'staff')"><div class="prev" id="pprev">${regPhoto?`<img src="${regPhoto}" alt="Preview">`:""}</div>
<p><button class="btn" onclick="savePhoto()">Save photo</button></p><div class="err" id="er"></div></div>`,
home:()=>`<section class="hero"><div><h2>Together for a cleaner Kampala</h2><p>Report uncollected waste or illegal dumping in seconds. When a collector resolves it, we send you a message.</p><button class="btn light" onclick="go('report')">Report a problem →</button><button class="btn gw" onclick="go('track')">Track my report</button></div>
<div class="hc"><div><b>${stats.total}</b><span>Reports</span></div><div><b>${stats.progress}</b><span>In progress</span></div><div><b>${stats.resolved}</b><span>Resolved</span></div></div></section>
<h2>How it works</h2><div class="grid"><div class="card step"><i>1</i><h3>Choose division and place</h3><span class="mu">Tap your division and tell us where the problem is.</span></div><div class="card step"><i>2</i><h3>Give the issue and your phone</h3><span class="mu">Choose the problem and enter the phone number to be notified.</span></div><div class="card step"><i>3</i><h3>Get a message</h3><span class="mu">A collector resolves it and you receive a message that it is done.</span></div></div>
<h2>Get in touch</h2>${contact()}`,
report:()=>lastReport?`<div class="ok"><h2>Report #${lastReport.id} received ✅</h2><p>${lastReport.collector?`<b>${esc(lastReport.collector)}</b> will handle it. `:""}Expected resolution: <b>${fdate(lastReport.expected_date)}</b>.</p><p>We sent a message to <b>${esc(lastReport.phone)}</b> and will send another when it has been resolved.</p><button class="btn" onclick="lastReport=null;render()">Report another problem</button> <button class="btn ghost" onclick="go('track')">Track my report</button></div>`:
`<div class="g2"><div class="card"><h2>1. Choose your division</h2>${zoneMap("pick")}<p class="mu sub">Tap a division on the map or use the list below.</p></div>
<div class="card"><h2>2. Report details</h2>
<label for="ra">Division</label><select id="ra" onchange="pickArea(this.value)"><option value="">Select division</option>${AREAS.map(a=>`<option ${a==repArea?'selected':''}>${a}</option>`).join("")}</select>
<label for="rp">Place of the problem</label><input id="rp" placeholder="e.g. Bwaise market, near the bridge">
<label for="rt">Problem issue</label><select id="rt">${TYPES.map(t=>`<option>${t}</option>`).join("")}</select>
<label for="rph">Your phone number</label><input id="rph" type="tel" placeholder="e.g. 0755530904" autocomplete="tel">
<label for="rd">More details (optional)</label><textarea id="rd" rows="2"></textarea>
<label for="rimg">Photo of the problem (optional)</label><input id="rimg" type="file" accept="image/*" onchange="pickImg(this,'report')"><div class="prev" id="rprev">${repImage?`<img src="${repImage}" alt="Preview">`:""}</div>
<p><button class="btn" onclick="submitReport()">Submit report</button></p><div class="err" id="er"></div></div></div>`,
track:()=>`<div class="card"><h2>Track my report</h2><p class="mu">Enter the phone number you used when reporting.</p><div class="row"><input id="tp" type="tel" placeholder="e.g. 0755530904"><button class="btn" onclick="doTrack()">Search</button></div><div class="err" id="er"></div></div>
${trackRes?(trackRes.tickets.length?trackRes.tickets.map(t=>`<div class="card tk"><div><b>#${t.id}</b> ${esc(t.type)} ${pill(t.status)}<br><span class="mu sub">${esc(t.area)}, ${esc(t.place)} · reported ${fmt(t.created)}</span><br>${t.status=="Resolved"?`Resolved on <b>${fmt(t.resolved_at)}</b>`:`Expected resolution: <b>${fdate(t.expected_date)}</b>`}
<div class="who">${t.collector_name?`${avatar(t.assigned_to,t.collector_name,t.collector_photo,"md")}<div><span class="mu sub">Collector</span><br><b>${esc(t.collector_name)}</b></div>`:`<span class="mu sub">Collector not assigned yet</span>`}</div></div>${t.has_image?`<a href="/img/ticket/${t.id}?phone=${encodeURIComponent(trackPhone)}" target="_blank"><img class="thumb big" src="/img/ticket/${t.id}?phone=${encodeURIComponent(trackPhone)}" alt="Your photo"></a>`:""}</div>`).join(""):`<div class="card"><p class="mu">No reports found for this number.</p></div>`)+(trackRes.messages.length?`<div class="card"><h3>Messages sent to you</h3>${trackRes.messages.map(m=>`<div class="msg">${esc(m.body)}<br><span class="mu sub">${fmt(m.created)}</span></div>`).join("")}</div>`:""):""}`,
schedule:()=>{const edit=isAdmin();return`<div class="card"><h2>Collection schedule</h2><p class="mu">${edit?"Tick the collection days for each division and save. Reporters get their expected resolution date from this schedule.":"Collection days for each division. Final days are set by the municipal authorities and contractors."}</p><div class="scroll"><table><tr><th>Division</th><th>Collection days</th><th>Next collection</th></tr>${AREAS.map(a=>`<tr><td><b>${a}</b></td><td>${edit?DAYS.map(d=>`<label class="chk"><input type="checkbox" data-a="${a}" data-d="${d}" ${(SCHED[a]||[]).includes(d)?"checked":""}>${d}</label>`).join(""):((SCHED[a]||[]).join(" and ")||"To be confirmed")}</td><td>${NEXT[a]?fdate(NEXT[a]):"–"}</td></tr>`).join("")}</table></div>${edit?`<p><button class="btn" onclick="saveSched()">Save schedule</button></p>`:""}</div>`},
learn:()=>`<div class="grid">${[["🥬","Organic","Food scraps and garden waste. Compost them or use a separate bin."],["🧴","Plastics","Rinse bottles and containers, keep them dry and separate for recyclers."],["📄","Paper","Flatten cartons and keep paper dry for recyclers."],["🔋","Hazardous","Batteries, medical and chemical waste never go in the general bin."],["🥫","Metal and glass","Keep separate and give to scrap collectors."],["🚫","Illegal dumping","Use the nearest collection point and report dump sites here."]].map(([i,a,b])=>`<div class="card"><div style="font-size:1.8rem">${i}</div><h3>${a}</h3><span class="mu">${b}</span></div>`).join("")}</div>`,
assistant:()=>`<div class="card"><h2>Chat with the AI assistant</h2><div id="log"></div><div class="chips">${["How do I report illegal dumping?","My garbage was not collected","How do I sort waste at home?"].map(x=>`<button onclick="ask(this.textContent)">${x}</button>`).join("")}</div><div class="row"><input id="q" placeholder="Type your question…" aria-label="Message"><button class="btn" onclick="ask($('#q').value)">Send</button></div></div>`,
contact:()=>`<div class="card"><h2>Contact us</h2><p class="mu">Reach the Solid Waste Collection team for urgent issues or questions.</p></div>${contact()}`,
login:()=>{const r=authRole=="administrator"?"Administrator":"Collector",reg=authMode=="register";
 return`<div class="card auth"><h2>${r} ${reg?"registration":"login"}</h2><div class="seg"><button class="${!reg?'on':''}" onclick="authMode='login';render()">Login</button><button class="${reg?'on':''}" onclick="authMode='register';render()">First time? Register</button></div>
 ${reg?`<p class="mu sub">Register with the e-mail saved for you in the system database. The system checks that your e-mail is saved before creating your account.</p>`:""}
 <label for="em">E-mail</label><input id="em" type="email" autocomplete="username"><label for="pw">Password</label><input id="pw" type="password" autocomplete="${reg?'new-password':'current-password'}">
 ${reg?`<label for="pw2">Confirm password</label><input id="pw2" type="password" autocomplete="new-password"><label for="pimg">Your photo (optional, shown to residents)</label><input id="pimg" type="file" accept="image/*" onchange="pickImg(this,'staff')"><div class="prev" id="pprev">${regPhoto?`<img src="${regPhoto}" alt="Preview">`:""}</div>`:""}
 <p><button class="btn" onclick="submitAuth()">${reg?"Create account":"Login"}</button></p><div class="err" id="er"></div></div>`},
dashboard:()=>{const d=days(),rep=d.map(x=>tickets.filter(t=>String(t.created).slice(0,10)==x).length),res=d.map(x=>tickets.filter(t=>t.resolved_at&&String(t.resolved_at).slice(0,10)==x).length);
 return`${!tickets.length?`<div class="card"><b>No reports yet.</b> ${isAdmin()?`<button class="btn s" onclick="demo()">Load sample data</button>`:""}</div>`:""}
<div class="grid">${sc("🗂️","var(--bs)",tickets.length,"Total reports")}${sc("⚠️","var(--rs)",cnt("status","Open"),"Open")}${sc("🚛","var(--as)",cnt("status","Progress"),"In progress")}${sc("✅","var(--gs)",cnt("status","Resolved"),"Resolved")}</div>
<div class="g2"><div class="card"><h3>Reports trend (last 7 days)</h3>${lineChart(d,rep,res)}</div><div class="card"><h3>Reports by issue</h3>${bars(TYPES,"type")}<h3 style="margin-top:1rem">Status</h3>${donut()}</div></div>
<div class="g2"><div class="card"><h3>Zones map</h3>${zoneMap("heat")}</div><div class="card"><h3>AI briefing</h3><p class="mu sub">The AI reads current reports and recommends priorities.</p><button class="btn" id="gb" onclick="brief()">Generate AI briefing</button><div id="br"></div></div></div>
<div class="card"><h3>Latest reports</h3>${ticketRows(tickets.slice(0,6))}</div>`},
tickets:()=>`<div class="card"><div class="filters">${["All","Open","Progress","Resolved"].map(f=>`<button class="${flt==f?'on':''}" onclick="setF('${f}')">${f=="Progress"?"In progress":f}</button>`).join("")}<input placeholder="Search place, phone, issue…" value="${esc(q)}" oninput="setQ(this.value)"></div><div id="tbl">${ticketRows(filtered())}</div></div>`,
zones:()=>`<div class="g2"><div class="card"><h3>Unresolved reports by division</h3>${zoneMap("heat")}</div><div class="card"><div class="scroll"><table><tr><th>Division</th><th>Open</th><th>In progress</th><th>Resolved</th><th>Collection days</th></tr>${AREAS.map(a=>{const f=s=>tickets.filter(t=>t.area==a&&t.status==s).length;return`<tr><td><b>${a}</b></td><td>${f("Open")}</td><td>${f("Progress")}</td><td>${f("Resolved")}</td><td>${SCHED[a].join(", ")}</td></tr>`}).join("")}</table></div></div></div>`,
staff:()=>`<div class="card"><h3>Collectors and administrators in the database</h3><div class="scroll"><table><tr><th>Name</th><th>E-mail</th><th>Role</th><th>Account</th></tr>${staff.map(s=>`<tr><td style="display:flex;gap:.5rem;align-items:center">${avatar(s.id,s.name,s.has_photo)}${esc(s.name)}</td><td>${esc(s.email)}</td><td style="text-transform:capitalize">${s.role}</td><td>${s.registered?'<span class="pill Resolved">Registered</span>':'<span class="pill Progress">Waiting to register</span>'}</td></tr>`).join("")}</table></div></div>
<div class="card"><h3>Add a person</h3><p class="mu sub">Only e-mails saved here can register an account.</p><label for="sn">Full name</label><input id="sn"><label for="se">E-mail</label><input id="se" type="email"><label for="sr">Role</label><select id="sr"><option value="collector">Collector</option><option value="administrator">Administrator</option></select><p><button class="btn" onclick="addStaff()">Save to database</button></p><div class="err" id="er"></div></div>`,
messages:()=>`<div class="card"><h3>Messages sent to reporters</h3><p class="mu sub">SMS go to reporters and e-mails go to staff. "Not configured" means the message was saved but no SMS or e-mail provider is connected yet.</p>${msgs.length?`<div class="scroll"><table><tr><th>Time</th><th>Type</th><th>To</th><th>Ticket</th><th>Message</th><th>Status</th></tr>${msgs.map(m=>`<tr><td>${fmt(m.created)}</td><td>${m.channel=="email"?"✉️ E-mail":"📱 SMS"}</td><td>${esc(m.recipient)}</td><td>#${m.ticket_id}</td><td>${m.subject?`<b>${esc(m.subject)}</b><br>`:""}${esc(m.body).replace(/\n/g,"<br>")}</td><td><span class="pill ${m.status}">${m.status.replace("_"," ")}</span></td></tr>`).join("")}</table></div>`:`<p class="mu">No messages yet.</p>`}</div>`
};
function contact(){return`<div class="grid"><div class="card"><div style="font-size:1.6rem">📞</div><h3>Phone</h3><a href="tel:${C.phone}">${C.phone}</a></div><div class="card"><div style="font-size:1.6rem">✉️</div><h3>E-mail</h3><a href="mailto:${C.email}">${C.email}</a></div><div class="card"><div style="font-size:1.6rem">📍</div><h3>Service area</h3><span class="mu">Kampala, Uganda</span></div></div>`}

/* ---------- actions ---------- */
function pickArea(a){repArea=a;const s=$("#ra");if(s)s.value=a;document.querySelectorAll("#map .z").forEach(z=>z.classList.toggle("on",z.nextElementSibling.textContent==a))}
async function submitReport(){
 try{const r=await api("/api/reports","POST",{area:$("#ra").value,place:$("#rp").value,type:$("#rt").value,phone:$("#rph").value,details:$("#rd").value,image:repImage});lastReport=r;repArea="";repImage="";render();scrollTo(0,0)}
 catch(e){$("#er").textContent=e.message}}
async function doTrack(){try{trackPhone=$("#tp").value;trackRes=await api("/api/track?phone="+encodeURIComponent($("#tp").value));render()}catch(e){$("#er").textContent=e.message}}
async function submitAuth(){
 const reg=authMode=="register",email=$("#em").value,password=$("#pw").value;
 if(reg&&password!==$("#pw2").value){$("#er").textContent="Passwords do not match.";return}
 try{const r=await api(reg?"/api/register":"/api/login","POST",{email,password,expect:authRole,photo:regPhoto});me=r.user;regPhoto="";photoV=Date.now();toast("Welcome, "+me.name);go("dashboard")}
 catch(e){$("#er").textContent=e.message}}
async function savePhoto(){if(!regPhoto){$("#er").textContent="Choose a photo first.";return}try{await api("/api/photo","POST",{photo:regPhoto});regPhoto="";photoV=Date.now();me=(await api("/api/me")).user;toast("Photo saved");render()}catch(e){$("#er").textContent=e.message}}
async function saveSched(){const s={};AREAS.forEach(a=>s[a]=[]);document.querySelectorAll("input[data-a]").forEach(c=>{if(c.checked)s[c.dataset.a].push(c.dataset.d)});try{await api("/api/schedule","PUT",{schedule:s});const r=await api("/api/schedule");SCHED=r.schedule;NEXT=r.next;toast("Schedule saved");render()}catch(e){toast(e.message)}}
async function logout(){await api("/api/logout","POST").catch(()=>{});me=null;tickets=[];go("home")}
async function addStaff(){try{await api("/api/staff","POST",{name:$("#sn").value,email:$("#se").value,role:$("#sr").value});toast("Saved to database");go("staff")}catch(e){$("#er").textContent=e.message}}
function addM(t,c){const d=document.createElement("div");d.className="m "+c;d.textContent=t;log.appendChild(d);log.scrollTop=log.scrollHeight;return d}
async function ask(t){t=(t||"").trim();if(!t)return;addM(t,"me");$("#q").value="";const b=addM("…","bt2");
 try{const r=await api("/api/chat","POST",{message:t,history:hist});b.textContent=r.reply;hist.push("Resident: "+t,"Assistant: "+r.reply)}
 catch(e){b.textContent="Sorry, the assistant is unavailable. Please e-mail "+C.email+" or call "+C.phone+"."}}
async function brief(){const b=$("#gb"),o=$("#br");b.disabled=true;o.innerHTML='<div class="ai">Analysing reports…</div>';
 try{const r=await api("/api/briefing","POST");o.innerHTML='<div class="ai"></div>';o.firstChild.textContent=r.text}
 catch(e){o.innerHTML='<div class="ai">'+esc(e.message)+'</div>'}b.disabled=false}

(async()=>{try{me=(await api("/api/me")).user}catch(e){}go("home")})();
