(function(){
'use strict';

/* ============================================================
   Utilidades
   ============================================================ */
var $=function(s){return document.querySelector(s);};
var pad=function(n){return String(n).padStart(2,'0');};
var isoOf=function(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
var todayIso=function(){return isoOf(new Date());};
var parse=function(s){var a=s.split('-').map(Number);return new Date(a[0],a[1]-1,a[2]);};
var shiftDays=function(n,base){var d=base?parse(base):new Date();d.setDate(d.getDate()+n);return isoOf(d);};
var shiftMonths=function(n,base){var d=base?parse(base):new Date();d.setMonth(d.getMonth()+n);return isoOf(d);};
var diffDays=function(s){var t=new Date();t.setHours(0,0,0,0);return Math.round((parse(s)-t)/86400000);};
var fmtDate=function(s){if(!s)return '—';var a=String(s).slice(0,10).split('-');return a[2]+'/'+a[1]+'/'+a[0];};
// Los centavos se muestran solo cuando existen ($1.250 / $1.250,50).
var money=function(n){n=Number(n)||0;var d=Math.abs(n*100-Math.round(n*100/100)*100)<0.5?0:2;return new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',minimumFractionDigits:d,maximumFractionDigits:2}).format(n);};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
// Texto sin tildes ni mayúsculas, para comparar y buscar ("Gómez" == "gomez").
var norm=function(s){return String(s==null?'':s).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();};
var toMin=function(t){return Number(t.slice(0,2))*60+Number(t.slice(3,5));};
var fmtBytes=function(n){n=Number(n)||0;if(n>=1073741824)return (n/1073741824).toFixed(1).replace('.',',')+' GB';if(n>=1048576)return (n/1048576).toFixed(n>=10485760?0:1).replace('.',',')+' MB';return Math.max(1,Math.round(n/1024))+' KB';};
var plural=function(n,a,b){return n+' '+(n===1?a:b);};
var fmtTs=function(v){var d=new Date(v);if(isNaN(d.getTime()))return '';return d.toLocaleString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});};
var fmtTime=function(v){var d=new Date(v);if(isNaN(d.getTime()))return '';return d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false});};
// Cantidad con su unidad: "3" / "1,25 kg".
var fmtQty=function(n,unit){var t=String(Math.round(Number(n)*1000)/1000).replace('.',',');return unit==='kg'?t+' kg':t;};
var pct=function(n){return n==null?'—':String(Math.round(n*10)/10).replace('.',',')+'%';};
var r2=function(x){return Math.round(x*100)/100;};
var r3=function(x){return Math.round(x*1000)/1000;};
// Lunes de la semana que contiene "iso" (semana de lunes a domingo).
var mondayOf=function(iso){var d=parse(iso);var wd=d.getDay();wd=wd===0?7:wd;return shiftDays(-(wd-1),iso);};

var PHONE_PAT='[0-9 +\\(\\)\\-]{6,50}';
var PROD_CATS=['Alimento balanceado','Snacks y premios','Accesorios','Juguetes','Higiene y cuidado','Salud (venta libre)','Camas y transporte','Acuario','Aves y roedores','Otros'];
var SPECIES_OPTS=[['','Todas / no aplica'],['Perro','Perro'],['Gato','Gato'],['Perro y gato','Perro y gato'],['Otras mascotas','Otras mascotas']];
var UNIT_OPTS=[['u','Por unidad'],['kg','Suelto, por kilo']];
var SERV_CATS=['Baño','Peluquería','Otros'];
var PET_SPECIES=['Perro','Gato','Otro'];
var PET_SIZES=[['','Sin definir'],['Chico','Chico'],['Mediano','Mediano'],['Grande','Grande'],['Gigante','Gigante']];
var CASH_IN_CATS=['Ventas','Aporte de capital','Otros ingresos'];
var CASH_OUT_CATS=['Compra de mercadería','Alquiler y servicios','Sueldos','Impuestos','Insumos de peluquería','Retiro de caja','Otros'];
var ADJUST_REASONS=['Rotura','Vencimiento','Error de carga','Uso interno (peluquería)','Faltante','Otro'];
var PAY=['Efectivo','Transferencia','Tarjeta de débito','Tarjeta de crédito'];
var APPT_STATUS=[['reservado','Reservado'],['en_curso','En curso'],['listo','Listo para retirar'],['entregado','Entregado'],['no_vino','No vino'],['cancelado','Cancelado']];
var APPT_LABEL={};APPT_STATUS.forEach(function(x){APPT_LABEL[x[0]]=x[1];});
var APPT_VIEWS=[['day','Día'],['week','Semana'],['month','Mes']];
var EXPIRY_DAYS=30; // aviso de vencimiento: productos que vencen en los próximos 30 días

/* ============================================================
   Estado
   ============================================================ */
var S={shop:'Mi Pet Shop',user:null,products:[],services:[],suppliers:[],clients:[],summary:null};
var newCart=function(){return {items:[],discType:'amount',discValue:'',method:'Efectivo',clientId:'',petId:'',apptId:null,note:''};};
var ui={view:'',cart:newCart(),posq:'',
  stq:'',cat:'all',stf:'all',stab:'products',
  sales:null,sfrom:'',sto:'',dash:null,
  cq:'',cfopen:false,cashp:'month',cashf:'all',cashm:'all',cash:null,closings:null,cfrom:'',cto:'',
  rep:'30',rfrom:'',rto:'',rep_m:null,rep_p:null,rep_c:null,rep_s:null,rep_u:null,
  backups:null,usage:null,users:null,suppliers:null,sq:'',
  csel:null,cdetail:null,cliq:'',
  cal:{view:'week',anchor:todayIso()},appts:null,todayAppts:null};
var main=$('#main'),dlg=$('#dlg');
var isAdmin=function(){return !!S.user&&S.user.role==='admin';};
var prodById=function(id){return id?S.products.find(function(x){return String(x.id)===String(id);})||null:null;};
var servById=function(id){return id?S.services.find(function(x){return String(x.id)===String(id);})||null:null;};
var clientById=function(id){return id?S.clients.find(function(x){return String(x.id)===String(id);})||null:null;};
var lowStock=function(x){return x.stock<=x.min;};
var expiring=function(x){return !!x.expires&&diffDays(x.expires)<=EXPIRY_DAYS;};

function toast(msg,warn){var t=$('#toast');t.textContent=msg;t.classList.toggle('warn',!!warn);t.classList.add('on');clearTimeout(toast._t);toast._t=setTimeout(function(){t.classList.remove('on');},3200);}

/* ============================================================
   Conexión con el servidor
   ============================================================ */
async function api(path,opts){
  opts=opts||{};
  var init={method:opts.method||'GET',credentials:'same-origin',headers:{'Accept':'application/json'}};
  if(opts.body!==undefined){init.method=opts.method||'POST';init.headers['Content-Type']='application/json';init.body=JSON.stringify(opts.body);}
  var res;
  try{res=await fetch('/api'+path,init);}
  catch(e){var ce=new Error('No hay conexión con el servidor. Revisá tu internet e intentá de nuevo.');ce.status=0;throw ce;}
  if(opts.raw&&res.ok)return res;
  var data=null;
  try{data=await res.json();}catch(e){}
  if(!res.ok){
    var err=new Error((data&&data.error)||'Ocurrió un error inesperado ('+res.status+')');
    err.status=res.status;
    if(res.status===401&&path!=='/login'&&S.user){S.user=null;showLogin('Tu sesión venció. Volvé a ingresar.');}
    throw err;
  }
  return data;
}

function setState(s){document.body.dataset.state=s;}
function showLogin(msg){
  if(dlg.open)dlg.close();
  setState('login');
  $('#lerror').textContent=msg||'';
}
function applyBootstrap(d){
  S.shop=d.shop||'Mi Pet Shop';S.user=d.user;S.products=d.products;S.services=d.services;S.suppliers=d.suppliers||[];S.clients=d.clients||[];S.summary=d.summary||null;
  document.title=S.shop;
  $('#shopname').textContent=S.shop;
}
async function start(){
  var d=await api('/bootstrap');
  applyBootstrap(d);
  // El dueño entra a sus números; el ayudante, directo a vender.
  ui.view=isAdmin()?'resumen':'vender';
  setState('app');
  render();
  try{await loadView();}catch(e){toast(e.message);}
  render();
}
async function boot(){
  try{await start();}
  catch(e){
    if(e.status===401){showLogin();return;}
    setState('loading');
    $('#boot-msg').textContent='No se pudo conectar con el sistema';
    $('#boot-sub').textContent=e.message;
    $('#boot-retry').hidden=false;
  }
}

/* Carga los datos de la pantalla actual. */
async function loadView(){
  var v=ui.view;
  if(v==='resumen'&&isAdmin()){
    var r=await Promise.all([api('/dashboard'),api('/appointments?from='+todayIso()+'&to='+todayIso())]);
    ui.dash=r[0];ui.todayAppts=r[1].items;
  }else if(v==='ventas'){
    await loadSales();
  }else if(v==='clientes'&&ui.csel){
    try{ui.cdetail=await api('/clients/'+ui.csel);}
    catch(e){if(e.status===404){ui.csel=null;ui.cdetail=null;}else throw e;}
  }else if(v==='agenda'){
    await loadAppointments();
  }else if(v==='caja'&&isAdmin()){
    await loadCash();
  }else if(v==='proveedores'){
    ui.suppliers=(await api('/suppliers')).items;
  }else if(v==='reportes'&&isAdmin()){
    await loadReports();
  }else if(v==='copias'&&isAdmin()){
    var b=await api('/backups');ui.backups=b.items;ui.usage=b.usage;
  }else if(v==='usuarios'&&isAdmin()){
    ui.users=(await api('/users')).items;
  }
}
async function loadSales(){
  var q=isAdmin()&&ui.sfrom&&ui.sto?'?from='+ui.sfrom+'&to='+ui.sto:'';
  ui.sales=await api('/sales'+q);
}
// Rango visible de la agenda según la vista (día, semana o mes completo en semanas enteras).
function calRange(){
  var a=ui.cal.anchor;
  if(ui.cal.view==='day')return [a,a];
  if(ui.cal.view==='week')return [mondayOf(a),shiftDays(6,mondayOf(a))];
  var first=a.slice(0,8)+'01';
  var y=Number(a.slice(0,4)),m=Number(a.slice(5,7));
  var last=a.slice(0,8)+pad(new Date(y,m,0).getDate());
  var wd=parse(last).getDay();wd=wd===0?7:wd;
  return [mondayOf(first),shiftDays(7-wd,last)];
}
async function loadAppointments(){
  var r=calRange();
  ui.appts=(await api('/appointments?from='+r[0]+'&to='+r[1])).items;
}
async function reloadCal(){
  try{await loadAppointments();}catch(e){toast(e.message);}
  render();
}
function calShift(dir){
  if(ui.cal.view==='month'){ui.cal.anchor=shiftMonths(dir,ui.cal.anchor);return;}
  ui.cal.anchor=shiftDays(dir*(ui.cal.view==='day'?1:7),ui.cal.anchor);
}
function calTitle(){
  if(ui.cal.view==='month'){var t=parse(ui.cal.anchor).toLocaleDateString('es-AR',{month:'long',year:'numeric'});return t.charAt(0).toUpperCase()+t.slice(1);}
  if(ui.cal.view==='day'){var s=parse(ui.cal.anchor).toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long'});return s.charAt(0).toUpperCase()+s.slice(1);}
  var r=calRange();return fmtDate(r[0])+' – '+fmtDate(r[1]);
}
// Filtros de Caja como parámetros de la dirección (los usa la lista y la exportación a CSV).
function cashQuery(){
  var q=['period='+ui.cashp];
  if(ui.cashp==='range'){q.push('from='+ui.cfrom);q.push('to='+ui.cto);}
  if(ui.cashf!=='all')q.push('type='+ui.cashf);
  if(ui.cashm!=='all')q.push('group='+encodeURIComponent(ui.cashm));
  return q.join('&');
}
async function downloadFile(path,name){
  var res=await api(path,{raw:true});
  var blob=await res.blob();
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=name;
  document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1500);
}
// Rango "Desde – Hasta" (inputs de fecha): HTML común a Ventas, Caja y Reportes.
var rangeHTML=function(idFrom,idTo,from,to){
  return '<span class="rng"><label>Desde <input type="date" id="'+idFrom+'" value="'+esc(from)+'" max="'+todayIso()+'" style="width:auto"></label> <label>Hasta <input type="date" id="'+idTo+'" value="'+esc(to)+'" style="width:auto"></label></span>';
};
async function loadCash(){
  var r=await Promise.all([api('/cash?'+cashQuery()),api('/cash/summary'),api('/cash/closings')]);
  ui.cash=r[0];S.summary=r[1];ui.closings=r[2];
}
function repQuery(){return ui.rfrom&&ui.rto?'from='+ui.rfrom+'&to='+ui.rto:'days='+ui.rep;}
async function loadReports(){
  var q=repQuery();
  var r=await Promise.all([api('/reports/monthly'),api('/reports/products?'+q),api('/reports/categories?'+q),api('/reports/services?'+q),api('/reports/staff?'+q)]);
  ui.rep_m=r[0].months;ui.rep_p=r[1];ui.rep_c=r[2].items;ui.rep_s=r[3].items;ui.rep_u=r[4].items;
}
/* Después de guardar algo: vuelve a pedir los datos y redibuja. */
async function reload(){
  try{
    applyBootstrap(await api('/bootstrap'));
    await loadView();
  }catch(e){toast(e.message);}
  render();
}
async function go(view){
  ui.view=view;
  render();
  window.scrollTo(0,0);
  try{await loadView();}catch(e){toast(e.message);}
  render();
}
async function refreshView(){
  render();
  try{await loadView();}catch(e){toast(e.message);}
  render();
}

/* ============================================================
   Ventanas de formulario
   ============================================================ */
function fld(label,name,o){
  o=o||{};
  var value=o.value==null?'':o.value,ctl;
  if(o.opts){
    ctl='<select name="'+name+'"'+(o.req?' required':'')+'>'+o.opts.map(function(x){
      var v=Array.isArray(x)?x[0]:x,t=Array.isArray(x)?x[1]:x;
      return '<option value="'+esc(v)+'"'+(String(v)===String(value)?' selected':'')+'>'+esc(t)+'</option>';
    }).join('')+'</select>';
  }else if(o.type==='textarea'){
    ctl='<textarea name="'+name+'" rows="3" placeholder="'+esc(o.ph||'')+'">'+esc(value)+'</textarea>';
  }else if(o.type==='checkbox'){
    return '<label class="fld check'+(o.full?' full':'')+'"><input type="checkbox" name="'+name+'"'+(value?' checked':'')+'><span>'+label+'</span></label>';
  }else{
    ctl='<input name="'+name+'" type="'+(o.type||'text')+'" value="'+esc(value)+'"'+(o.req?' required':'')+' placeholder="'+esc(o.ph||'')+'"'+
      (o.step?' step="'+o.step+'"':'')+(o.minlength?' minlength="'+o.minlength+'"':'')+(o.pattern?' pattern="'+o.pattern+'" title="'+esc(o.title||'')+'"':'')+(o.min!=null?' min="'+o.min+'"':'')+(o.max!=null?' max="'+o.max+'"':'')+(o.list?' list="'+o.list+'"':'')+
      (o.auto?' autocomplete="'+o.auto+'"':' autocomplete="off"')+'>';
  }
  return '<label class="fld'+(o.full?' full':'')+'"><span>'+label+'</span>'+ctl+'</label>';
}
function openForm(o){
  dlg.innerHTML='<form class="dform"><h2>'+o.title+'</h2>'+o.body+'<p class="err" role="alert"></p>'+
    '<div class="actions"><button type="button" class="btn ghost" data-close>Cancelar</button>'+
    '<button type="submit" class="btn '+(o.danger?'danger':'primary')+'">'+(o.submit||'Guardar')+'</button></div></form>';
  var f=dlg.querySelector('form');
  // Si el navegador frena el envío por un campo inválido, el motivo se muestra siempre en el formulario.
  f.addEventListener('invalid',function(e){
    var el=e.target,lab=el.closest('label'),name=lab&&lab.querySelector('span')?lab.querySelector('span').textContent.replace(/\s*\(.*$/,''):'';
    f.querySelector('.err').textContent=(name?name+': ':'')+(el.validity&&el.validity.valueMissing?'completá este campo.':el.validationMessage||'revisá este campo.');
  },true);
  f.addEventListener('submit',async function(e){
    e.preventDefault();
    if(f.dataset.busy)return; // nunca se envía dos veces
    var btn=f.querySelector('[type="submit"]'),errEl=f.querySelector('.err'),data={},label=btn.innerHTML;
    new FormData(f).forEach(function(v,k){data[k]=v;});
    errEl.textContent='';f.dataset.busy='1';btn.disabled=true;btn.classList.add('busy');btn.textContent='Guardando…';
    try{var r=await o.onSubmit(data,f);if(r!==false&&dlg.open)dlg.close();}
    catch(err){errEl.textContent=err.message||'Ocurrió un error';}
    delete f.dataset.busy;btn.disabled=false;btn.classList.remove('busy');btn.innerHTML=label;
  });
  dlg.querySelector('[data-close]').addEventListener('click',function(){dlg.close();});
  dlg.showModal();
  return f;
}
dlg.addEventListener('click',function(e){if(e.target===dlg)dlg.close();});
function confirmForm(title,text,submit,fn,danger){
  openForm({title:title,body:'<p>'+text+'</p>',submit:submit,danger:danger!==false,onSubmit:fn});
}
// Diálogo de decisión que devuelve una promesa con el "value" del botón elegido (o null si se cierra).
function choiceDialog(title,html,buttons){
  return new Promise(function(resolve){
    var d=document.createElement('dialog'),val=null;
    d.innerHTML='<form class="dform"><h2>'+title+'</h2>'+html+'<div class="actions">'+buttons.map(function(b,i){
      return '<button type="button" class="btn '+(b.cls||'ghost')+'" data-i="'+i+'">'+b.label+'</button>';
    }).join('')+'</div></form>';
    document.body.appendChild(d);
    d.addEventListener('click',function(e){var b=e.target.closest('[data-i]');if(b){val=buttons[Number(b.dataset.i)].value;d.close();}});
    d.addEventListener('close',function(){d.remove();resolve(val);});
    d.showModal();
  });
}
// Ventana de solo lectura con botones propios (detalle de venta, de turno, de proveedor).
function infoDialog(title,html,buttons){
  dlg.innerHTML='<form class="dform"><h2>'+title+'</h2>'+html+'<div class="actions">'+(buttons||[]).map(function(b,i){
    return '<button type="button" class="btn '+(b.cls||'')+'" data-b="'+i+'">'+b.label+'</button>';
  }).join('')+'<button type="button" class="btn ghost" data-close>Cerrar</button></div></form>';
  dlg.querySelector('[data-close]').addEventListener('click',function(){dlg.close();});
  (buttons||[]).forEach(function(b,i){dlg.querySelector('[data-b="'+i+'"]').addEventListener('click',function(){
    Promise.resolve().then(b.fn).catch(function(err){toast(err.message);});
  });});
  if(!dlg.open)dlg.showModal();
}
function segHTML(action,items,active){
  return '<div class="seg" role="group">'+items.map(function(i){
    return '<button class="segb" data-action="'+action+'" data-v="'+i[0]+'" aria-pressed="'+(String(i[0])===String(active))+'">'+i[1]+'</button>';
  }).join('')+'</div>';
}
var loadingView=function(title){return '<section class="farm"><div class="head"><h1>'+title+'</h1></div><p class="empty">Cargando…</p></section>';};

/* ============================================================
   Navegación, avisos y usuario
   ============================================================ */
function navItems(){
  var a=[];
  if(isAdmin())a.push(['resumen','📊 Resumen']);
  a.push(['vender','🛒 Vender'],['ventas','🧾 Ventas'],['stock','📦 Stock'],['servicios','✂️ Servicios'],['agenda','📅 Agenda'],['clientes','👤 Clientes'],['proveedores','🚚 Proveedores']);
  if(isAdmin())a.push(['caja','💵 Caja'],['reportes','📈 Reportes'],['copias','💾 Copias de seguridad'],['usuarios','🔑 Usuarios']);
  return a;
}
function renderNav(){
  $('#nav').innerHTML=navItems().map(function(i){
    return '<button class="navb" data-action="nav" data-v="'+i[0]+'" aria-current="'+(ui.view===i[0]?'page':'false')+'">'+i[1]+'</button>';
  }).join('');
}
function renderUserBox(){
  var u=S.user;
  $('#userbox').innerHTML='<div class="who"><b>'+esc(u.name)+'</b><small>'+(u.role==='admin'?'Dueño / administrador':'Empleado')+'</small></div>'+
    '<button data-action="change-pass">Cambiar contraseña</button><button data-action="logout">Cerrar sesión</button>';
}
function lastExportDays(){
  try{var t=Number(localStorage.getItem('petshop_last_export'));if(!t)return null;return Math.floor((Date.now()-t)/86400000);}catch(e){return null;}
}
function renderAlerts(){
  var low=S.products.filter(lowStock).length,exp=S.products.filter(expiring).length;
  var h='';
  if(low)h+='<button class="al" data-action="goto-stock" data-v="low"><span class="dot stock"></span><span>'+plural(low,'producto con poco stock','productos con poco stock')+'</span></button>';
  if(exp)h+='<button class="al" data-action="goto-stock" data-v="exp"><span class="dot porvencer"></span><span>'+plural(exp,'producto vence pronto','productos vencen pronto')+'</span></button>';
  if(isAdmin()){
    var d=lastExportDays();
    if(d===null||d>7)h+='<button class="al" data-action="nav" data-v="copias"><span class="dot copia"></span><span>'+(d===null?'Todavía no descargaste una copia de seguridad':'Hace '+plural(d,'día','días')+' que no descargás una copia de seguridad')+'</span></button>';
  }
  if(!h)h='<div class="al"><span class="dot ok"></span><span>Todo en orden</span></div>';
  $('#alerts').innerHTML='<h3>Para revisar</h3>'+h;
}

/* ============================================================
   Resumen (pantalla de inicio del dueño)
   ============================================================ */
function card(label,value,sub,cls){
  return '<div class="card'+(cls?' '+cls:'')+'"><small>'+label+'</small><b>'+value+'</b>'+(sub?'<span>'+sub+'</span>':'')+'</div>';
}
// Barras de ventas de los últimos 14 días (la parte clara es la ganancia).
function daysChart(days){
  var max=Math.max.apply(null,days.map(function(d){return d.total;}).concat([1]));
  var W=560,H=150,bw=W/days.length;
  var bars=days.map(function(d,i){
    var h=Math.round(d.total/max*(H-24)),hp=Math.round(Math.max(0,d.profit)/max*(H-24)),x=Math.round(i*bw+bw*0.15),w=Math.round(bw*0.7);
    var lab=String(Number(d.date.slice(8,10)));
    return '<g><title>'+fmtDate(d.date)+': ventas '+money(d.total)+' · ganancia '+money(d.profit)+'</title>'+
      '<rect x="'+x+'" y="'+(H-20-h)+'" width="'+w+'" height="'+h+'" rx="3" fill="var(--brand)" opacity=".35"></rect>'+
      '<rect x="'+x+'" y="'+(H-20-hp)+'" width="'+w+'" height="'+hp+'" rx="3" fill="var(--brand)"></rect>'+
      '<text x="'+(x+w/2)+'" y="'+(H-5)+'" text-anchor="middle" font-size="10" fill="var(--muted)">'+lab+'</text></g>';
  }).join('');
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Ventas de los últimos 14 días">'+bars+'</svg>';
}
function vsText(cur,prev){
  if(!prev)return '';
  var d=Math.round((cur-prev)/prev*1000)/10;
  return '<span class="'+(d>=0?'in':'out')+'">'+(d>=0?'▲ ':'▼ ')+pct(Math.abs(d))+'</span> vs. mismo período del mes pasado';
}
function viewResumen(){
  var D=ui.dash;
  if(!D)return loadingView('Resumen');
  var mes=new Date().toLocaleDateString('es-AR',{month:'long'});
  var low=S.products.filter(lowStock).sort(function(a,b){return a.stock-b.stock;});
  var exp=S.products.filter(expiring).sort(function(a,b){return a.expires.localeCompare(b.expires);});
  var methods=Object.keys(D.today.byMethod).map(function(k){return k+' '+money(D.today.byMethod[k]);}).join(' · ');
  var top=D.top.length?'<table class="tbl slim"><thead><tr><th>Artículo</th><th class="num">Vendido</th><th class="num">Cobrado</th><th class="num">Ganancia</th></tr></thead><tbody>'+D.top.map(function(x){
    return '<tr><td>'+esc(x.name)+'</td><td class="num">'+fmtQty(x.qty,x.unit)+'</td><td class="num">'+money(x.total)+'</td><td class="num">'+money(x.profit)+'</td></tr>';
  }).join('')+'</tbody></table>':'<p class="empty">Todavía no hay ventas este mes.</p>';
  var lowList=low.length?'<ul class="plainlist">'+low.slice(0,8).map(function(x){return '<li><b>'+esc(x.name)+'</b> <small>quedan '+fmtQty(x.stock,x.unit)+' (mínimo '+fmtQty(x.min,x.unit)+')</small></li>';}).join('')+'</ul>'+(low.length>8?'<button class="link" data-action="goto-stock" data-v="low">Ver los '+low.length+'</button>':''):'<p class="empty">Ningún producto por debajo del mínimo.</p>';
  var expList=exp.length?'<ul class="plainlist">'+exp.slice(0,8).map(function(x){var d=diffDays(x.expires);return '<li><b>'+esc(x.name)+'</b> <small class="'+(d<0?'negtxt':'')+'">'+(d<0?'venció el ':'vence el ')+fmtDate(x.expires)+' · stock '+fmtQty(x.stock,x.unit)+'</small></li>';}).join('')+'</ul>':'<p class="empty">Nada por vencer en los próximos '+EXPIRY_DAYS+' días.</p>';
  var appts=(ui.todayAppts||[]).filter(function(a){return a.status!=='cancelado';});
  var apptList=appts.length?'<ul class="plainlist">'+appts.map(function(a){return '<li><b>'+a.time+'</b> '+esc(a.pet)+' <small>('+esc(a.clientLast)+') · '+esc(a.service||'Sin servicio')+' · '+esc(APPT_LABEL[a.status])+'</small></li>';}).join('')+'</ul>':'<p class="empty">No hay turnos para hoy.</p>';
  return '<section class="farm"><div class="head"><h1>Resumen</h1><div class="hbtns"><button class="btn" data-action="nav" data-v="caja">Cerrar caja</button><button class="btn primary" data-action="nav" data-v="vender">Nueva venta</button></div></div>'+
    '<h2 class="sub">Hoy</h2><div class="cards">'+
      card('Vendido hoy',money(D.today.total),plural(D.today.count,'venta','ventas')+(D.today.count?' · ticket promedio '+money(D.today.avg):''))+
      card('Ganancia de hoy',money(D.today.profit),D.today.margin==null?'':'Margen '+pct(D.today.margin))+
      card('Efectivo en caja',money(D.drawer),methods||'Sin cobros hoy',D.drawer<0?'neg':'')+
      card('Turnos de hoy',String(D.apptsToday),'Peluquería y baño')+
    '</div>'+
    '<h2 class="sub">'+mes.charAt(0).toUpperCase()+mes.slice(1)+'</h2><div class="cards">'+
      card('Ventas del mes',money(D.month.total),vsText(D.month.total,D.prevMonth.total))+
      card('Ganancia bruta',money(D.month.profit),D.month.margin==null?'':'Margen '+pct(D.month.margin))+
      card('Gastos y compras',money(D.month.expenses),'Todos los egresos de caja del mes')+
      card('Ticket promedio',money(D.month.avg),plural(D.month.count,'venta','ventas'))+
    '</div>'+
    '<div class="grid2"><section class="panel"><h3>Ventas de los últimos 14 días</h3><div class="legend"><span><i style="background:var(--brand);opacity:.35"></i>Ventas</span><span><i style="background:var(--brand)"></i>Ganancia</span></div>'+daysChart(D.days)+'</section>'+
    '<section class="panel"><h3>Lo más vendido del mes</h3>'+top+'</section></div>'+
    '<div class="grid3"><section class="panel"><h3>Poco stock</h3>'+lowList+'</section><section class="panel"><h3>Por vencer</h3>'+expList+'</section><section class="panel"><h3>Turnos de hoy</h3>'+apptList+'</section></div></section>';
}

/* ============================================================
   Vender (punto de venta)
   ============================================================ */
function cartTotals(){
  var sub=0;ui.cart.items.forEach(function(it){sub+=r2(it.price*it.qty);});sub=r2(sub);
  var v=Number(ui.cart.discValue)||0;
  var disc=ui.cart.discType==='percent'?r2(sub*Math.min(v,100)/100):r2(Math.min(v,sub));
  return {sub:sub,disc:disc,total:r2(sub-disc)};
}
function addToCart(type,id,qty){
  var src=type==='product'?prodById(id):servById(id);
  if(!src)return;
  if(type==='product'&&src.stock<=0){toast('No queda stock de '+src.name,true);return;}
  var ex=ui.cart.items.find(function(it){return it.type===type&&String(it.id)===String(id);});
  var add=qty||1;
  if(ex){ex.qty=type==='product'&&src.unit==='kg'?r3(ex.qty+add):ex.qty+add;}
  else ui.cart.items.push({type:type,id:src.id,name:src.name,unit:type==='product'?src.unit:'u',qty:add,price:src.price});
  toast('Agregado: '+src.name);
}
function posResults(){
  var q=norm(ui.posq).trim();
  var prods=S.products.filter(function(x){return !q||norm(x.name+' '+x.brand+' '+x.category+' '+x.barcode).indexOf(q)>=0;});
  var servs=S.services.filter(function(x){return !q||norm(x.name+' '+x.category).indexOf(q)>=0;});
  var h=servs.slice(0,12).map(function(s){
    return '<button class="pitem" data-action="cart-add" data-type="service" data-id="'+s.id+'"><span class="avatar" aria-hidden="true">✂️</span><span class="pi-main"><b>'+esc(s.name)+'</b><small>Servicio · '+esc(s.category)+'</small></span><b>'+money(s.price)+'</b></button>';
  }).join('')+prods.slice(0,40).map(function(x){
    var st=x.stock<=0?'<span class="chip bad">Sin stock</span>':'<small>'+fmtQty(x.stock,x.unit)+' en stock</small>';
    return '<button class="pitem" data-action="cart-add" data-type="product" data-id="'+x.id+'"'+(x.stock<=0?' disabled':'')+'><span class="avatar" aria-hidden="true">'+(x.unit==='kg'?'⚖️':'📦')+'</span><span class="pi-main"><b>'+esc(x.name)+'</b><small>'+esc([x.brand,x.category].filter(Boolean).join(' · '))+'</small></span><span class="pi-end"><b>'+money(x.price)+(x.unit==='kg'?'/kg':'')+'</b>'+st+'</span></button>';
  }).join('');
  if(!h)h='<p class="empty">'+(S.products.length||S.services.length?'No hay nada con esa búsqueda.':'Todavía no hay productos ni servicios cargados.')+'</p>';
  return h;
}
function cartHTML(){
  var c=ui.cart,admin=isAdmin(),t=cartTotals();
  var lines=c.items.map(function(it,i){
    var step=it.unit==='kg'?'0.001':'1';
    return '<div class="cline"><span class="l-name"><b>'+esc(it.name)+'</b>'+(it.unit==='kg'?'<small> (por kilo)</small>':'')+'</span>'+
      '<input type="number" class="cqty" data-i="'+i+'" min="'+step+'" step="'+step+'" value="'+it.qty+'" aria-label="Cantidad">'+
      (admin?'<input type="number" class="cprice" data-i="'+i+'" min="0" step="0.01" value="'+it.price+'" aria-label="Precio" title="Precio (podés cambiarlo para esta venta)">':'<span class="num">'+money(it.price)+'</span>')+
      '<span class="l-sub">'+money(r2(it.price*it.qty))+'</span><button class="link bad" data-action="cart-del" data-i="'+i+'" aria-label="Quitar">✕</button></div>';
  }).join('');
  var cl=clientById(c.clientId);
  var clientOpts='<option value="">Sin cliente (venta de mostrador)</option>'+S.clients.map(function(x){return '<option value="'+x.id+'"'+(String(x.id)===String(c.clientId)?' selected':'')+'>'+esc(x.name)+(x.phone?' · '+esc(x.phone):'')+'</option>';}).join('');
  var petOpts=cl&&cl.pets.length?'<select id="cart-pet" aria-label="Mascota"><option value="">Mascota (opcional)</option>'+cl.pets.map(function(p){return '<option value="'+p.id+'"'+(String(p.id)===String(c.petId)?' selected':'')+'>'+esc(p.name)+'</option>';}).join('')+'</select>':'';
  return '<div class="cart panel"><h3>Venta'+(c.apptId?' <span class="chip info">Cobro de turno</span>':'')+'</h3>'+
    (lines?'<div class="cline head"><span>Artículo</span><span>Cant.</span><span>Precio</span><span class="l-sub">Subtotal</span><span></span></div>'+lines:'<p class="empty">Buscá un producto o escaneá su código para agregarlo.</p>')+
    '<div class="crow"><label>Descuento <select id="cart-dtype" style="width:auto"><option value="amount"'+(c.discType==='amount'?' selected':'')+'>$</option><option value="percent"'+(c.discType==='percent'?' selected':'')+'>%</option></select>'+
      '<input type="number" id="cart-dval" min="0" step="0.01" value="'+esc(c.discValue)+'" style="width:7rem" placeholder="0"></label></div>'+
    '<div class="crow"><select id="cart-client" aria-label="Cliente">'+clientOpts+'</select>'+petOpts+'</div>'+
    '<div class="crow"><span class="flabel">Forma de pago</span>'+segHTML('cart-method',PAY.map(function(m){return [m,m];}),c.method)+'</div>'+
    '<div class="ctotals"><div><span>Subtotal</span><span>'+money(t.sub)+'</span></div>'+(t.disc?'<div><span>Descuento</span><span>− '+money(t.disc)+'</span></div>':'')+
    '<div class="grand"><span>Total</span><span>'+money(t.total)+'</span></div></div>'+
    '<div class="actions"><button class="btn ghost" data-action="cart-clear"'+(c.items.length||c.clientId?'':' disabled')+'>Vaciar</button><button class="btn primary big-btn" data-action="cart-pay"'+(c.items.length?'':' disabled')+'>Cobrar '+money(t.total)+'</button></div></div>';
}
function viewVender(){
  return '<section class="farm"><div class="head"><h1>Vender</h1><button class="btn" data-action="scan-sell">📷 Escanear código</button></div>'+
    '<div class="pos"><div class="pos-search"><input id="posq" type="search" placeholder="Buscar producto o servicio, o leer el código con el lector y Enter" value="'+esc(ui.posq)+'" aria-label="Buscar producto o servicio" autofocus>'+
    '<div class="plist" id="posres">'+posResults()+'</div></div><div id="cartbox">'+cartHTML()+'</div></div></section>';
}
function renderCart(){var b=$('#cartbox');if(b)b.innerHTML=cartHTML();}
async function payCart(){
  var c=ui.cart,t=cartTotals();
  if(!c.items.length)return;
  var body={method:c.method,items:c.items.map(function(it){return {type:it.type,id:it.id,qty:it.qty,price:it.price};}),
    discount:Number(c.discValue)>0?{type:c.discType,value:c.discValue}:null,clientId:c.clientId?Number(c.clientId):null,petId:c.petId?Number(c.petId):null,appointmentId:c.apptId};
  var r=await api('/sales',{body:body});
  ui.cart=newCart();ui.posq='';
  await reload();
  saleDoneDialog(r.id,t.total);
}
function saleDoneDialog(id,total){
  infoDialog('Venta registrada','<p class="big">'+money(total)+'</p><p>Venta N° '+id+'. Se descontó el stock y se registró el ingreso en la caja.</p>',[
    {label:'🖨 Imprimir ticket',fn:function(){return printSale(id);}},
    {label:'Nueva venta',cls:'primary',fn:function(){dlg.close();if(ui.view!=='vender')go('vender');else{var q=$('#posq');if(q)q.focus();}}},
  ]);
}
// Ticket no fiscal (comprobante interno), listo para imprimir o guardar como PDF.
async function printSale(id){
  var s=await api('/sales/'+id);
  $('#print').innerHTML='<div class="ticket"><h1>'+esc(S.shop)+'</h1><p>Comprobante N° '+s.id+' · '+fmtDate(s.date)+' '+fmtTime(s.createdAt)+'</p>'+
    (s.client?'<p>Cliente: '+esc(s.client)+(s.pet?' ('+esc(s.pet)+')':'')+'</p>':'')+
    '<table>'+s.items.map(function(it){return '<tr><td>'+fmtQty(it.qty,it.unit)+' × '+esc(it.name)+'<br><small>'+money(it.price)+(it.unit==='kg'?'/kg':' c/u')+'</small></td><td class="r">'+money(r2(it.qty*it.price))+'</td></tr>';}).join('')+'</table>'+
    (s.discount?'<p class="r">Subtotal '+money(s.subtotal)+'<br>Descuento − '+money(s.discount)+'</p>':'')+
    '<p class="r tot">TOTAL '+money(s.total)+'</p><p>Pago: '+esc(s.method)+'</p>'+(s.voided?'<p><b>VENTA ANULADA</b></p>':'')+'<p class="foot">Comprobante no válido como factura. ¡Gracias por tu compra!</p></div>';
  setTimeout(function(){window.print();},50);
}

/* ============================================================
   Ventas (historial)
   ============================================================ */
function viewVentas(){
  var V=ui.sales,admin=isAdmin();
  if(!V)return loadingView('Ventas');
  var rows=V.items.map(function(s){
    return '<tr class="'+(s.voided?'voided':'')+'"><td>'+s.id+'</td><td>'+fmtDate(s.date)+'<br><small>'+fmtTime(s.createdAt)+'</small></td><td>'+esc(s.summary)+(s.client?'<br><small>'+esc(s.client)+(s.pet?' · '+esc(s.pet):'')+'</small>':'')+'</td>'+
      '<td>'+esc(s.method)+'<br><small>'+esc(s.seller)+'</small></td><td class="num">'+(s.voided?'<span class="chip bad">Anulada</span><br>':'')+'<b>'+money(s.total)+'</b>'+(s.discount?'<br><small>desc. '+money(s.discount)+'</small>':'')+'</td>'+
      (admin?'<td class="num">'+(s.voided?'—':money(s.profit))+'</td>':'')+
      '<td class="act"><button class="link" data-action="sale-view" data-id="'+s.id+'">Ver</button><button class="link" data-action="sale-print" data-id="'+s.id+'">Ticket</button>'+(admin&&!s.voided?'<button class="link bad" data-action="sale-void" data-id="'+s.id+'">Anular</button>':'')+'</td></tr>';
  }).join('');
  var T=V.totals;
  return '<section class="farm"><div class="head"><h1>Ventas</h1>'+(admin?'<button class="btn" data-action="sales-export">Exportar CSV</button>':'')+'</div>'+
    (admin?'<div class="toolbar">'+segHTML('sales-period',[['today','Hoy'],['yesterday','Ayer'],['week','Últimos 7 días'],['month','Este mes']],ui.sfrom?'':'today')+rangeHTML('sfrom','sto',ui.sfrom,ui.sto)+'</div>':'<p class="empty">Ventas de hoy.</p>')+
    '<div class="cards">'+card('Ventas',String(T.count),V.from===V.to?fmtDate(V.from):fmtDate(V.from)+' al '+fmtDate(V.to))+card('Total cobrado',money(T.total),T.count?'Ticket promedio '+money(T.total/T.count):'')+(admin?card('Ganancia',money(T.profit),T.total?'Margen '+pct(T.profit/T.total*100):''):'')+'</div>'+
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>N°</th><th>Fecha</th><th>Artículos</th><th>Pago</th><th class="num">Total</th>'+(admin?'<th class="num">Ganancia</th>':'')+'<th></th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="'+(admin?7:6)+'" class="empty">No hay ventas en este período.</td></tr>')+'</tbody></table></div>'+
    (V.limited?'<p class="empty">Se muestran las últimas 500 ventas. Elegí un período más corto para ver el resto.</p>':'')+'</section>';
}
async function saleDetail(id){
  var s=await api('/sales/'+id),admin=isAdmin();
  var rows=s.items.map(function(it){
    return '<tr><td>'+esc(it.name)+'</td><td class="num">'+fmtQty(it.qty,it.unit)+'</td><td class="num">'+money(it.price)+'</td><td class="num">'+money(it.amount)+'</td>'+(admin?'<td class="num">'+money(r2(it.amount-it.qty*it.cost))+'</td>':'')+'</tr>';
  }).join('');
  var btns=[{label:'🖨 Ticket',fn:function(){return printSale(id);}}];
  if(admin&&!s.voided)btns.push({label:'Anular venta',cls:'danger-o',fn:function(){voidSale(id);}});
  infoDialog('Venta N° '+s.id,
    '<p>'+fmtDate(s.date)+' '+fmtTime(s.createdAt)+' · '+esc(s.method)+(s.seller?' · vendió '+esc(s.seller):'')+'</p>'+(s.client?'<p>Cliente: '+esc(s.client)+(s.pet?' ('+esc(s.pet)+')':'')+'</p>':'')+
    (s.voided?'<p class="warnbox">Venta anulada'+(s.voidReason?': '+esc(s.voidReason):'')+'</p>':'')+
    '<div class="tbl-wrap"><table class="tbl slim"><thead><tr><th>Artículo</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Cobrado</th>'+(admin?'<th class="num">Ganancia</th>':'')+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div class="ctotals">'+(s.discount?'<div><span>Descuento</span><span>− '+money(s.discount)+'</span></div>':'')+'<div class="grand"><span>Total</span><span>'+money(s.total)+'</span></div>'+(admin&&!s.voided?'<div><span>Ganancia</span><span>'+money(s.profit)+'</span></div>':'')+'</div>',btns);
}
function voidSale(id){
  openForm({title:'Anular venta N° '+id,danger:true,submit:'Anular venta',
    body:'<p>Se devuelve el stock de los productos y se quita el ingreso de la caja. La venta queda en el historial marcada como anulada.</p><div class="fields">'+fld('Motivo (opcional)','reason',{full:true,ph:'Ej.: el cliente devolvió el producto'})+'</div>',
    onSubmit:async function(d){await api('/sales/'+id+'/void',{body:{reason:d.reason}});await reload();toast('Venta anulada');}});
}

/* ============================================================
   Stock
   ============================================================ */
function filteredProducts(){
  var sq=norm(ui.stq).trim();
  return S.products.filter(function(x){
    if(ui.cat!=='all'&&x.category!==ui.cat)return false;
    if(ui.stf==='low'&&!lowStock(x))return false;
    if(ui.stf==='exp'&&!expiring(x))return false;
    return !sq||norm(x.name+' '+x.brand+' '+x.category+' '+x.barcode).indexOf(sq)>=0;
  });
}
function stockRows(){
  var admin=isAdmin(),L=filteredProducts(),totCost=0,totSale=0;
  var rows=L.map(function(x){
    var chip=x.stock<=0?'<span class="chip bad">Sin stock</span>':lowStock(x)?'<span class="chip warn">Poco stock</span>':'';
    if(x.expires){var d=diffDays(x.expires);if(d<0)chip+=' <span class="chip bad">Vencido</span>';else if(d<=EXPIRY_DAYS)chip+=' <span class="chip warn">Vence '+fmtDate(x.expires)+'</span>';}
    var stockCell=admin?'<span class="stk"><span>'+fmtQty(x.stock,x.unit)+'</span><button data-action="stock-add" data-id="'+x.id+'" aria-label="Agregar stock" title="Llegó mercadería">+</button></span>':'<b>'+fmtQty(x.stock,x.unit)+'</b>';
    var bag=x.packKg&&x.looseId?'<button class="link" data-action="open-bag" data-id="'+x.id+'">Abrir bolsa</button>':'';
    var acts='<button class="link" data-action="sell" data-id="'+x.id+'">Vender</button>'+bag+(admin?'<details class="rowmenu"><summary aria-label="Más acciones de '+esc(x.name)+'" title="Más acciones">⋮</summary><div class="menu">'+
      '<button class="link" data-action="stock-adjust" data-id="'+x.id+'">Ajustar stock</button><button class="link" data-action="stock-history" data-id="'+x.id+'">Historial</button><button class="link" data-action="edit-product" data-id="'+x.id+'">Editar</button><button class="link bad" data-action="del-product" data-id="'+x.id+'">Eliminar</button></div></details>':'');
    var per=x.unit==='kg'?'/kg':'';
    var costCells='';
    if(admin){
      var val=Math.max(x.stock,0)*x.cost;totCost+=val;totSale+=Math.max(x.stock,0)*x.price;
      var margin=x.cost>0&&x.price>0?(x.price-x.cost)/x.price*100:null;
      costCells='<td class="num col2">'+(x.cost>0?money(x.cost)+per:'—')+'</td><td class="num col2'+(x.cost>0&&x.price<x.cost?' negtxt':'')+'">'+(margin==null?'—':(x.price<x.cost?'⚠ ':'')+pct(margin))+'</td><td class="num col2">'+(x.cost>0?money(val):'—')+'</td>';
    }
    return '<tr><td><b>'+esc(x.name)+'</b><br><small>'+esc([x.brand,x.category,x.species].filter(Boolean).join(' · '))+'</small>'+(x.barcode?'<br><small class="bc">▮ '+esc(x.barcode)+'</small>':'')+'</td><td>'+stockCell+'</td><td class="num">'+fmtQty(x.min,x.unit)+'</td><td>'+chip+'</td><td class="num">'+money(x.price)+per+'</td>'+costCells+'<td class="act">'+acts+'</td></tr>';
  }).join('');
  var cols=admin?9:6;
  var empty=S.products.length?'No hay productos con ese filtro.':'Todavía no cargaste productos. '+(admin?'Empezá con “Nuevo producto”.':'Pedile al dueño que los cargue.');
  var foot=admin&&L.length?'<tfoot><tr><td colspan="'+cols+'"><b>Mercadería en stock:</b> '+money(totCost)+' a costo · '+money(totSale)+' a precio de venta · ganancia potencial '+money(totSale-totCost)+'</td></tr></tfoot>':'';
  return '<tbody>'+(rows||'<tr><td colspan="'+cols+'" class="empty">'+empty+'</td></tr>')+'</tbody>'+foot;
}
// Pedido sugerido: lo que está en el mínimo o por debajo, agrupado por proveedor, para llegar al doble del mínimo.
function restockGroups(){
  var g={};
  S.products.filter(lowStock).forEach(function(x){
    var k=x.supplierId||0;
    (g[k]=g[k]||[]).push({p:x,qty:Math.ceil(Math.max(x.min*2-x.stock,1))});
  });
  return Object.keys(g).map(function(k){
    var s=k==='0'?null:(S.suppliers||[]).find(function(x){return String(x.id)===k;});
    return {supplier:s,items:g[k]};
  }).sort(function(a,b){return (a.supplier?a.supplier.name:'~').localeCompare(b.supplier?b.supplier.name:'~','es');});
}
function restockHTML(){
  var G=restockGroups(),admin=isAdmin();
  if(!G.length)return '<p class="empty">No hay productos en el mínimo o por debajo. Cuando haya, acá vas a ver qué pedir y a quién.</p>';
  return '<p class="empty">Cantidad sugerida: lo necesario para llegar al doble del stock mínimo. Podés copiar el pedido y mandárselo al proveedor.</p>'+G.map(function(g,i){
    return '<div class="grp"><div class="toolbar"><h3 style="margin:0">'+(g.supplier?esc(g.supplier.name):'Sin proveedor asignado')+'</h3>'+(g.supplier&&g.supplier.phone?'<small>'+esc(g.supplier.phone)+'</small>':'')+
      '<span class="grow"></span><button class="btn" data-action="copy-order" data-i="'+i+'">Copiar pedido</button></div>'+
      '<div class="tbl-wrap"><table class="tbl slim"><thead><tr><th>Producto</th><th class="num">Stock</th><th class="num">Mínimo</th><th class="num">Pedir</th>'+(admin?'<th class="num">Costo estimado</th><th></th>':'')+'</tr></thead><tbody>'+g.items.map(function(it){
        return '<tr><td><b>'+esc(it.p.name)+'</b>'+(it.p.brand?' <small>'+esc(it.p.brand)+'</small>':'')+'</td><td class="num">'+fmtQty(it.p.stock,it.p.unit)+'</td><td class="num">'+fmtQty(it.p.min,it.p.unit)+'</td><td class="num"><b>'+fmtQty(it.qty,it.p.unit)+'</b></td>'+
          (admin?'<td class="num">'+(it.p.cost>0?money(it.p.cost*it.qty):'—')+'</td><td class="act"><button class="link" data-action="stock-add" data-id="'+it.p.id+'">Llegó</button></td>':'')+'</tr>';
      }).join('')+'</tbody></table></div></div>';
  }).join('');
}
function viewStock(){
  var admin=isAdmin();
  var low=S.products.filter(lowStock).length,exp=S.products.filter(expiring).length;
  var tabs='<div class="tabs" role="tablist"><button class="tab" role="tab" data-action="stab" data-v="products" aria-selected="'+(ui.stab==='products')+'">Productos</button><button class="tab" role="tab" data-action="stab" data-v="restock" aria-selected="'+(ui.stab==='restock')+'">Para pedir'+(low?' ('+low+')':'')+'</button></div>';
  var body;
  if(ui.stab==='restock')body=restockHTML();
  else body='<div class="toolbar">'+segHTML('stf',[['all','Todos'],['low','Poco stock ('+low+')'],['exp','Por vencer ('+exp+')']],ui.stf)+
      '<select id="stcat" style="width:auto" aria-label="Categoría"><option value="all">Todas las categorías</option>'+PROD_CATS.map(function(c){return '<option'+(ui.cat===c?' selected':'')+'>'+c+'</option>';}).join('')+'</select></div>'+
    '<input id="stq" type="search" placeholder="Buscar por nombre, marca o código (o leer un código con el lector y Enter)" value="'+esc(ui.stq)+'" aria-label="Buscar producto" style="margin-bottom:1rem">'+
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th>Stock</th><th class="num">Mínimo</th><th>Estado</th><th class="num">Precio</th>'+(admin?'<th class="num col2">Costo</th><th class="num col2">Margen</th><th class="num col2">Valor en stock</th>':'')+'<th></th></tr></thead>'+stockRows()+'</table></div>';
  return '<section class="farm"><div class="head"><h1>Stock</h1><div class="hbtns"><button class="btn" data-action="scan-sell">📷 Vender con escáner</button>'+
    (admin?'<button class="btn" data-action="scan-stock">📷 Ingresar con escáner</button><button class="btn" data-action="bulk-price">% Actualizar precios</button><button class="btn primary" data-action="new-product">Nuevo producto</button>':'')+'</div></div>'+tabs+body+'</section>';
}

/* ============================================================
   Servicios (lista de precios de baño y peluquería)
   ============================================================ */
function viewServicios(){
  var admin=isAdmin();
  var g=SERV_CATS.map(function(cat){
    var L=S.services.filter(function(s){return s.category===cat;});
    if(!L.length)return '';
    return '<div class="grp"><h3>'+cat+'</h3><div class="tbl-wrap"><table class="tbl slim"><tbody>'+L.map(function(s){
      return '<tr><td><b>'+esc(s.name)+'</b><br><small>Duración aproximada: '+s.duration+' min</small></td><td class="num">'+money(s.price)+'</td><td class="act">'+
        '<button class="link" data-action="sell-service" data-id="'+s.id+'">Cobrar</button>'+(admin?'<button class="link" data-action="edit-service" data-id="'+s.id+'">Editar</button><button class="link bad" data-action="del-service" data-id="'+s.id+'">Eliminar</button>':'')+'</td></tr>';
    }).join('')+'</tbody></table></div></div>';
  }).join('');
  return '<section class="farm"><div class="head"><h1>Servicios</h1>'+(admin?'<button class="btn primary" data-action="new-service">Nuevo servicio</button>':'')+'</div>'+
    '<p class="empty">Precios de baño y peluquería. Se cobran desde “Vender” o desde el turno en la Agenda. Tip: cargá un servicio por tamaño (ej.: “Baño perro chico”, “Baño perro grande”).</p>'+
    (g||'<p class="empty">Todavía no cargaste servicios. '+(admin?'Empezá con “Nuevo servicio”.':'Pedile al dueño que los cargue.')+'</p>')+'</section>';
}

/* ============================================================
   Caja (solo el dueño)
   ============================================================ */
function closingPanel(){
  var K=ui.closings;if(!K)return '';
  var today=K.items.find(function(x){return x.date===K.today;});
  var hist=K.items.slice(0,10).map(function(x){
    var d=x.difference;
    return '<tr><td>'+fmtDate(x.date)+'</td><td class="num">'+money(x.expected)+'</td><td class="num">'+money(x.counted)+'</td><td class="num '+(d===0?'':d>0?'in':'out')+'">'+(d>0?'+':'')+money(d)+'</td><td>'+esc(x.note)+'<br><small>'+esc(x.who)+'</small></td></tr>';
  }).join('');
  return '<section class="panel closing"><h3>Cierre de caja de hoy</h3>'+
    '<p>Según el sistema debería haber <b>'+money(K.expected)+'</b> en efectivo.'+(today?' Ya cerraste hoy: contaste '+money(today.counted)+' ('+(today.difference===0?'sin diferencia':'diferencia '+money(today.difference))+'). Podés volver a cerrarla.':'')+'</p>'+
    '<div class="crow"><label>Efectivo contado <input type="number" id="close-counted" min="0" step="0.01" style="width:9rem"></label><label class="grow">Nota <input id="close-note" placeholder="Opcional"></label><button class="btn primary" data-action="cash-close">'+(today?'Volver a cerrar':'Cerrar caja')+'</button></div>'+
    (hist?'<details><summary>Cierres anteriores</summary><div class="tbl-wrap"><table class="tbl slim"><thead><tr><th>Día</th><th class="num">Debería haber</th><th class="num">Contado</th><th class="num">Diferencia</th><th>Nota</th></tr></thead><tbody>'+hist+'</tbody></table></div></details>':'')+'</section>';
}
function viewCaja(){
  if(!ui.cash||!S.summary)return loadingView('Caja');
  var sm=S.summary,m=sm.month,bal=m.in-m.out;
  var mes=new Date().toLocaleDateString('es-AR',{month:'long'});
  var cq=norm(ui.cq).trim();
  var nf=(ui.cashp!=='month'?1:0)+(ui.cashf!=='all'?1:0)+(ui.cashm!=='all'?1:0)+(cq?1:0);
  var rows=ui.cash.items.filter(function(c){return !cq||norm(c.concept+' '+c.category+' '+c.method).indexOf(cq)>=0;}).map(function(c){
    var act=c.saleId?'<button class="link" data-action="sale-view" data-id="'+c.saleId+'">Ver venta</button>':'<button class="link bad" data-action="del-cash" data-id="'+c.id+'">Eliminar</button>';
    return '<tr><td>'+fmtDate(c.date)+'</td><td><b>'+esc(c.concept)+'</b></td><td>'+esc(c.category)+'</td><td>'+esc(c.method)+'</td><td class="num '+(c.type==='in'?'in':'out')+'">'+(c.type==='in'?'+ ':'− ')+money(c.amount)+'</td><td class="act">'+act+'</td></tr>';
  }).join('');
  var pm=PAY.map(function(x){return '<div class="bk"><span>'+x+'</span><b>'+money(m.byMethod[x]||0)+'</b></div>';}).join('');
  return '<section class="farm"><div class="head"><h1>Caja</h1></div>'+
    '<div class="summary"><div><small>Ingresos de '+mes+'</small><b>'+money(m.in)+'</b><small>Efectivo '+money(m.efe)+' · Transferencias '+money(m.tra)+' · Tarjetas '+money(m.tar)+'</small></div>'+
    '<div><small>Egresos de '+mes+'</small><b>'+money(m.out)+'</b></div><div><small>Balance</small><b class="'+(bal>=0?'pos':'neg')+'">'+money(bal)+'</b></div></div>'+
    '<div class="cashbox"><div class="panel"><h3>Efectivo que debería haber en caja</h3><div class="big'+(sm.drawer<0?' neg':'')+'">'+money(sm.drawer)+'</div>'+
      '<p>Hoy entró '+money(sm.todayCash.in)+' y salió '+money(sm.todayCash.out)+' en efectivo. Si sacás plata de la caja, registrala como egreso en efectivo (categoría “Retiro de caja”).</p></div>'+
    '<div class="panel"><h3>Ingresos de '+mes+' por forma de pago</h3><div class="bk-list">'+pm+'</div></div></div>'+closingPanel()+
    '<div class="cashactions"><button class="btn" data-action="cash-export">Exportar CSV</button><span class="grow"></span><button class="btn" data-action="cash-out">Registrar gasto</button><button class="btn primary" data-action="cash-in">Registrar ingreso</button></div>'+
    '<details class="filterpanel" id="cfilters"'+(ui.cfopen?' open':'')+'><summary>Filtros'+(nf?' <span class="badge">'+nf+'</span>':'')+'</summary><div class="fbody">'+
      '<div class="frow"><span class="flabel">Período</span>'+segHTML('cashp',[['today','Hoy'],['month','Este mes'],['prev','Mes anterior'],['all','Todo']],ui.cashp)+rangeHTML('cfrom','cto',ui.cfrom,ui.cto)+'</div>'+
      '<div class="frow"><span class="flabel">Tipo</span>'+segHTML('cashf',[['all','Ingresos y egresos'],['in','Ingresos'],['out','Egresos']],ui.cashf)+'</div>'+
      '<div class="frow"><span class="flabel">Forma de pago</span>'+segHTML('cashm',[['all','Todas'],['Efectivo','Efectivo'],['Transferencia','Transferencias'],['Tarjeta','Tarjetas']],ui.cashm)+'</div>'+
      '<div class="frow"><span class="flabel">Buscar</span><input id="cq" type="search" placeholder="Concepto, categoría o forma de pago" value="'+esc(ui.cq)+'" aria-label="Buscar movimiento"></div>'+
      (nf?'<div class="frow"><button class="link" data-action="cash-clear-filters">Quitar todos los filtros</button></div>':'')+'</div></details>'+
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Forma de pago</th><th class="num">Monto</th><th></th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="6" class="empty">No hay movimientos en este período.</td></tr>')+'</tbody></table></div>'+
    (ui.cash.limited?'<p class="empty">Se muestran los últimos 500 movimientos. Elegí un período más corto para ver el resto.</p>':'')+'</section>';
}

/* ============================================================
   Reportes (solo el dueño)
   ============================================================ */
function monthLabel(ym){return new Date(Number(ym.slice(0,4)),Number(ym.slice(5,7))-1,1).toLocaleDateString('es-AR',{month:'short'}).replace('.','');}
function monthChart(M){
  var max=Math.max.apply(null,M.map(function(x){return Math.max(x.sales,x.cashOut);}).concat([1]));
  var W=560,H=170,gw=W/M.length;
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Ventas, ganancia y egresos por mes">'+M.map(function(x,i){
    var x0=Math.round(i*gw+gw*0.12),bw=Math.round(gw*0.25),hs=Math.round(x.sales/max*(H-26)),hp=Math.round(Math.max(0,x.profit)/max*(H-26)),ho=Math.round(x.cashOut/max*(H-26));
    return '<g><title>'+monthLabel(x.ym)+': ventas '+money(x.sales)+', ganancia '+money(x.profit)+', egresos '+money(x.cashOut)+'</title>'+
      '<rect x="'+x0+'" y="'+(H-20-hs)+'" width="'+bw+'" height="'+hs+'" rx="3" fill="var(--brand)" opacity=".4"></rect>'+
      '<rect x="'+(x0+bw+2)+'" y="'+(H-20-hp)+'" width="'+bw+'" height="'+hp+'" rx="3" fill="var(--brand)"></rect>'+
      '<rect x="'+(x0+2*bw+4)+'" y="'+(H-20-ho)+'" width="'+bw+'" height="'+ho+'" rx="3" fill="var(--muted)" opacity=".55"></rect>'+
      '<text x="'+(x0+1.5*bw+2)+'" y="'+(H-5)+'" text-anchor="middle" font-size="11" fill="var(--muted)">'+monthLabel(x.ym)+'</text></g>';
  }).join('')+'</svg>';
}
function viewReportes(){
  if(!ui.rep_m||!ui.rep_p)return loadingView('Reportes');
  var days=ui.rep_p.days;
  var mrows=ui.rep_m.slice().reverse().map(function(x){
    return '<tr><td>'+monthLabel(x.ym)+' '+x.ym.slice(0,4)+'</td><td class="num">'+x.count+'</td><td class="num">'+money(x.sales)+'</td><td class="num">'+money(x.cost)+'</td><td class="num"><b>'+money(x.profit)+'</b></td><td class="num">'+money(x.expenses)+'</td><td class="num '+(x.result>=0?'in':'out')+'">'+money(x.result)+'</td><td class="num">'+money(x.purchases)+'</td></tr>';
  }).join('');
  var maxC=ui.rep_c.length?ui.rep_c[0].total:1;
  var crow=ui.rep_c.map(function(x){
    return '<tr><td><b>'+esc(x.category)+'</b> <small>'+(x.kind==='service'?'servicio':'')+'</small></td><td><div class="bars"><div class="bar" style="width:'+Math.max(4,Math.round(x.total/maxC*140))+'px"></div><span>'+money(x.total)+'</span></div></td><td class="num">'+money(x.profit)+'</td><td class="num">'+pct(x.total?x.profit/x.total*100:null)+'</td></tr>';
  }).join('');
  var prow=ui.rep_p.items.map(function(x){
    var st,left=x.qty>0?Math.round(x.stock/(x.qty/days)):null;
    if(x.stock<=0)st='<span class="chip bad">Sin stock</span>';
    else if(x.qty===0)st='<span class="chip none">Sin ventas</span>';
    else if(left<=15)st='<span class="chip warn">'+plural(left,'día','días')+'</span>';
    else st='~'+left+' días';
    return '<tr><td><b>'+esc(x.name)+'</b><br><small>'+esc([x.brand,x.category].filter(Boolean).join(' · '))+'</small></td><td class="num">'+fmtQty(x.qty,x.unit)+'</td><td class="num">'+money(x.total)+'</td><td class="num">'+money(x.profit)+'</td><td class="num">'+pct(x.total?x.profit/x.total*100:null)+'</td><td class="num">'+fmtQty(x.stock,x.unit)+'</td><td>'+st+'</td><td class="num">'+money(x.stockValue)+'</td></tr>';
  }).join('');
  var srow=ui.rep_s.map(function(x){return '<tr><td><b>'+esc(x.name)+'</b></td><td class="num">'+x.n+'</td><td class="num">'+money(x.total)+'</td></tr>';}).join('');
  var urow=ui.rep_u.map(function(x){return '<tr><td><b>'+esc(x.name)+'</b></td><td class="num">'+x.n+'</td><td class="num">'+money(x.total)+'</td></tr>';}).join('');
  var period=ui.rep_p.from===ui.rep_p.to?fmtDate(ui.rep_p.from):fmtDate(ui.rep_p.from)+' al '+fmtDate(ui.rep_p.to);
  return '<section class="farm"><div class="head"><h1>Reportes</h1></div>'+
    '<div class="repsec"><h2>Mes a mes</h2><div class="legend"><span><i style="background:var(--brand);opacity:.4"></i>Ventas</span><span><i style="background:var(--brand)"></i>Ganancia bruta</span><span><i style="background:var(--muted);opacity:.55"></i>Egresos</span></div>'+monthChart(ui.rep_m)+
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mes</th><th class="num">Ventas</th><th class="num">Vendido</th><th class="num">Costo de lo vendido</th><th class="num">Ganancia bruta</th><th class="num">Gastos</th><th class="num">Resultado</th><th class="num">Compras de mercadería</th></tr></thead><tbody>'+mrows+'</tbody></table></div>'+
    '<p class="empty">Ganancia bruta = lo vendido menos lo que te costó esa mercadería. Gastos = egresos de caja que no son compras de mercadería ni retiros. Resultado = ganancia bruta − gastos.</p></div>'+
    '<div class="repsec"><div class="toolbar"><h2 style="margin:0">Período: '+period+'</h2>'+segHTML('rep',[['7','7 días'],['30','30 días'],['90','3 meses'],['365','1 año']],ui.rfrom&&ui.rto?'':ui.rep)+rangeHTML('rfrom','rto',ui.rfrom,ui.rto)+'<button class="btn" data-action="rep-export">Exportar ventas (CSV)</button></div>'+
    '<div class="grp"><h3>Por categoría</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Categoría</th><th>Vendido</th><th class="num">Ganancia</th><th class="num">Margen</th></tr></thead><tbody>'+(crow||'<tr><td colspan="4" class="empty">No hay ventas en este período.</td></tr>')+'</tbody></table></div></div>'+
    '<div class="grp"><h3>Productos</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="num">Vendido</th><th class="num">Cobrado</th><th class="num">Ganancia</th><th class="num">Margen</th><th class="num">Stock</th><th>Le alcanza para</th><th class="num">Valor del stock</th></tr></thead><tbody>'+(prow||'<tr><td colspan="8" class="empty">Todavía no cargaste productos.</td></tr>')+'</tbody></table></div></div>'+
    '<div class="grid2"><div class="grp"><h3>Servicios</h3><div class="tbl-wrap"><table class="tbl slim"><thead><tr><th>Servicio</th><th class="num">Veces</th><th class="num">Cobrado</th></tr></thead><tbody>'+(srow||'<tr><td colspan="3" class="empty">Sin servicios cobrados.</td></tr>')+'</tbody></table></div></div>'+
    '<div class="grp"><h3>Ventas por empleado</h3><div class="tbl-wrap"><table class="tbl slim"><thead><tr><th>Usuario</th><th class="num">Ventas</th><th class="num">Total</th></tr></thead><tbody>'+(urow||'<tr><td colspan="3" class="empty">Sin ventas.</td></tr>')+'</tbody></table></div></div></div></div></section>';
}

/* ============================================================
   Clientes y mascotas
   ============================================================ */
var petEmo=function(p){return p.species==='Gato'?'🐱':p.species==='Perro'?'🐶':'🐾';};
function ageText(b){
  if(!b)return '';
  var a=b.split('-').map(Number),now=new Date();
  var months=(now.getFullYear()-a[0])*12+(now.getMonth()+1-a[1]);
  if(now.getDate()<a[2])months--;
  if(months<0)months=0;
  if(months<12)return plural(months,'mes','meses');
  return plural(Math.floor(months/12),'año','años');
}
function filteredClients(){
  var q=norm(ui.cliq).trim(),qd=ui.cliq.replace(/\D/g,'');
  return S.clients.filter(function(c){
    if(!q)return true;
    var hay=norm(c.name+' '+c.email+' '+c.phone+' '+c.address+' '+c.pets.map(function(p){return p.name;}).join(' '));
    return hay.indexOf(q)>=0||(qd.length>=3&&c.phone.replace(/\D/g,'').indexOf(qd)>=0);
  });
}
function clientListHTML(){
  var L=filteredClients();
  if(!L.length)return '<li class="empty">'+(S.clients.length?'No hay clientes con esa búsqueda.':'Todavía no hay clientes. Empezá con “Nuevo cliente”.')+'</li>';
  return L.map(function(c){
    return '<li><button class="pitem" data-action="select-client" data-id="'+c.id+'" aria-current="'+(c.id===ui.csel)+'"><span class="avatar" aria-hidden="true">👤</span>'+
      '<span class="pi-main"><b>'+esc(c.name)+'</b><small>'+(c.pets.length?c.pets.map(function(p){return esc(p.name);}).join(', '):'Sin mascotas')+(c.phone?' · '+esc(c.phone):'')+'</small></span></button></li>';
  }).join('');
}
function clientDetailHTML(c){
  var tel=String(c.phone||'').replace(/[^\d+]/g,'');
  var contact=[c.phone?'Tel. <a href="tel:'+esc(tel)+'">'+esc(c.phone)+'</a>':'<span class="mut">Sin teléfono</span>',c.email?'<a href="mailto:'+esc(c.email)+'">'+esc(c.email)+'</a>':'<span class="mut">Sin email</span>'];
  var pets=c.pets.length?'<div class="petlist">'+c.pets.map(function(p){
    var info=[p.species,p.breed,p.size,ageText(p.birth)].filter(Boolean).map(esc).join(' · ');
    return '<div class="petrow"><span class="avatar" aria-hidden="true">'+petEmo(p)+'</span><span class="pi-main"><b>'+esc(p.name)+'</b><small>'+info+'</small>'+(p.notes?'<small class="pnote">✂️ '+esc(p.notes)+'</small>':'')+'</span>'+
      '<span class="racts"><button class="link" data-action="pet-appt" data-id="'+p.id+'">Turno</button><button class="link" data-action="edit-pet" data-id="'+p.id+'">Editar</button>'+(isAdmin()?'<button class="link bad" data-action="del-pet" data-id="'+p.id+'">Quitar</button>':'')+'</span></div>';
  }).join('')+'</div>':'<p class="empty">Todavía no tiene mascotas cargadas.</p>';
  var sales=c.sales.length?'<div class="tbl-wrap"><table class="tbl slim"><thead><tr><th>Fecha</th><th>Artículos</th><th>Pago</th><th class="num">Total</th><th></th></tr></thead><tbody>'+c.sales.map(function(s){
    return '<tr class="'+(s.voided?'voided':'')+'"><td>'+fmtDate(s.date)+'</td><td>'+esc(s.summary)+(s.pet?' <small>('+esc(s.pet)+')</small>':'')+'</td><td>'+esc(s.method)+'</td><td class="num">'+(s.voided?'<span class="chip bad">Anulada</span> ':'')+money(s.total)+'</td><td class="act"><button class="link" data-action="sale-view" data-id="'+s.id+'">Ver</button></td></tr>';
  }).join('')+'</tbody></table></div>':'<p class="empty">Todavía no tiene compras registradas a su nombre.</p>';
  var appts=c.appointments.length?'<ul class="plainlist">'+c.appointments.slice(0,15).map(function(a){return '<li>'+fmtDate(a.date)+' '+a.time+' · <b>'+esc(a.pet)+'</b> · '+esc(a.service||'Sin servicio')+' <small>('+esc(APPT_LABEL[a.status])+')</small></li>';}).join('')+'</ul>':'<p class="empty">Sin turnos.</p>';
  return '<button class="btn back" data-action="back-client">Volver a la lista</button>'+
    '<header class="phead"><div class="avatar big" aria-hidden="true">👤</div><div class="info"><h2>'+esc(c.name)+'</h2><p class="meta">'+contact.join(' · ')+'</p>'+
    (c.address?'<p class="meta">'+esc(c.address)+'</p>':'')+(c.notes?'<p class="meta">📝 '+esc(c.notes)+'</p>':'')+'</div>'+
    '<div class="pactions"><button class="btn primary" data-action="client-sell">Venderle</button><button class="btn" data-action="add-pet">Agregar mascota</button><button class="btn" data-action="edit-client">Editar datos</button>'+
    (isAdmin()?'<button class="btn danger-o" data-action="del-client">Eliminar</button>':'')+'</div></header>'+
    '<div class="cards">'+card('Compró en total',money(c.totalSpent),plural(c.sales.filter(function(s){return !s.voided;}).length,'compra','compras'))+card('Última compra',c.lastPurchase?fmtDate(c.lastPurchase):'—',c.lastPurchase?'hace '+plural(-diffDays(c.lastPurchase),'día','días'):'')+'</div>'+
    '<section class="sec"><div class="sec-head"><h3>Mascotas ('+c.pets.length+')</h3></div>'+pets+'</section>'+
    '<section class="sec"><div class="sec-head"><h3>Turnos de peluquería</h3></div>'+appts+'</section>'+
    '<section class="sec"><div class="sec-head"><h3>Compras</h3></div>'+sales+'</section>';
}
function viewClientes(){
  var c=ui.csel&&ui.cdetail&&ui.cdetail.id===ui.csel?ui.cdetail:null;
  var right=ui.csel?(c?clientDetailHTML(c):'<button class="btn back" data-action="back-client">Volver a la lista</button><p class="empty">Cargando…</p>'):'<p class="empty">Elegí un cliente para ver sus mascotas, sus compras y sus turnos.</p>';
  return '<section class="pac '+(ui.csel?'show-detail':'')+'"><div class="pac-list">'+
    '<div class="head"><h1>Clientes</h1><button class="btn primary" data-action="new-client">Nuevo cliente</button></div>'+
    '<input id="cliq" type="search" placeholder="Buscar por nombre, teléfono, email o mascota" value="'+esc(ui.cliq)+'" aria-label="Buscar cliente">'+
    '<ul class="plist" id="clist">'+clientListHTML()+'</ul></div><div class="pac-detail">'+right+'</div></section>';
}

/* ============================================================
   Agenda de peluquería y baño
   ============================================================ */
var WEEKDAYS=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
var apptLabel=function(a){return a.time+' · '+esc(a.pet)+' ('+esc(a.clientLast)+')';};
function dayAppts(iso){return (ui.appts||[]).filter(function(a){return a.date===iso;}).sort(function(a,b){return a.time.localeCompare(b.time);});}
function apptBtn(a,big){
  return '<button class="appt st-'+a.status+'" data-action="appt-view" data-id="'+a.id+'">'+apptLabel(a)+'<small>'+esc(a.service||'Sin servicio')+(big?' · hasta '+a.endTime+' · '+esc(APPT_LABEL[a.status]):'')+'</small></button>';
}
function calDayColumn(iso){
  var d=parse(iso),isToday=iso===todayIso();
  return '<div class="cal-day'+(isToday?' today':'')+'"><div class="cal-day-head"><span>'+WEEKDAYS[(d.getDay()+6)%7]+'</span><b>'+d.getDate()+'</b>'+
    '<button class="cal-add" data-action="cal-add-day" data-v="'+iso+'" aria-label="Agregar turno este día">+</button></div>'+dayAppts(iso).map(function(a){return apptBtn(a,false);}).join('')+'</div>';
}
function calMonthGrid(){
  var r=calRange(),cur=ui.cal.anchor.slice(0,7),cells='',d=r[0];
  while(d<=r[1]){
    var list=dayAppts(d),out=d.slice(0,7)!==cur,isToday=d===todayIso();
    cells+='<div class="cal-mday'+(out?' out':'')+(isToday?' today':'')+(list.length||isToday?' has':'')+'"><div class="mhead"><span>'+WEEKDAYS[(parse(d).getDay()+6)%7]+' '+Number(d.slice(8,10))+'</span>'+
      '<button class="cal-add" data-action="cal-add-day" data-v="'+d+'" aria-label="Agregar turno este día">+</button></div>'+
      list.slice(0,3).map(function(a){return '<button class="cal-chip st-'+a.status+'" data-action="appt-view" data-id="'+a.id+'">'+apptLabel(a)+'</button>';}).join('')+
      (list.length>3?'<button class="cal-more" data-action="cal-day" data-v="'+d+'">+'+(list.length-3)+' más</button>':'')+'</div>';
    d=shiftDays(1,d);
  }
  return '<div class="cal-month">'+cells+'</div>';
}
function viewAgenda(){
  if(!ui.appts)return loadingView('Agenda');
  var body;
  if(ui.cal.view==='month')body=calMonthGrid();
  else if(ui.cal.view==='day'){
    var L=dayAppts(ui.cal.anchor);
    body='<div class="daylist">'+(L.map(function(a){return apptBtn(a,true);}).join('')||'<p class="empty">No hay turnos este día.</p>')+'</div>';
  }else{
    var r=calRange(),cells='',d=r[0];
    while(d<=r[1]){cells+=calDayColumn(d);d=shiftDays(1,d);}
    body='<div class="cal-week fit">'+cells+'</div>';
  }
  return '<section class="farm"><div class="head"><h1>Agenda de peluquería</h1><button class="btn primary" data-action="new-appt">Nuevo turno</button></div>'+
    '<div class="cal-head"><div class="cal-nav"><button data-action="cal-prev" aria-label="Anterior">‹</button><button class="btn" data-action="cal-today">Hoy</button><button data-action="cal-next" aria-label="Siguiente">›</button></div>'+
    '<div class="cal-title">'+calTitle()+'</div>'+segHTML('cal-view',APPT_VIEWS,ui.cal.view)+'</div>'+
    '<div class="cal-legend">'+APPT_STATUS.map(function(s){return '<span><i class="st-'+s[0]+'"></i>'+s[1]+'</span>';}).join('')+'</div>'+body+'</section>';
}

/* ============================================================
   Proveedores, copias de seguridad y usuarios
   ============================================================ */
function supplierRows(){
  var admin=isAdmin(),q=norm(ui.sq).trim(),qd=ui.sq.replace(/\D/g,'');
  var L=(ui.suppliers||[]).filter(function(s){return !q||norm(s.name+' '+s.phone+' '+s.email+' '+s.description).indexOf(q)>=0||(qd.length>=3&&s.phone.replace(/\D/g,'').indexOf(qd)>=0);});
  var rows=L.map(function(s){
    var name=admin?'<button class="link namebtn" data-action="supplier-view" data-id="'+s.id+'">'+esc(s.name)+'</button>':'<b>'+esc(s.name)+'</b>';
    return '<tr><td>'+name+(s.description?'<br><small>'+esc(s.description)+'</small>':'')+'</td><td>'+esc(s.phone)+'</td><td>'+esc(s.email)+'</td><td class="num">'+s.productCount+'</td>'+
      (admin?'<td class="act"><button class="link" data-action="edit-supplier" data-id="'+s.id+'">Editar</button><button class="link bad" data-action="del-supplier" data-id="'+s.id+'">Eliminar</button></td>':'')+'</tr>';
  }).join('');
  var empty=(ui.suppliers||[]).length?'No hay proveedores con esa búsqueda.':admin?'Todavía no cargaste proveedores. Empezá con “Agregar proveedor”.':'Todavía no hay proveedores cargados.';
  return rows||'<tr><td colspan="'+(admin?5:4)+'" class="empty">'+empty+'</td></tr>';
}
function viewProveedores(){
  if(!ui.suppliers)return loadingView('Proveedores');
  var admin=isAdmin();
  return '<section class="farm"><div class="head"><h1>Proveedores</h1>'+(admin?'<button class="btn primary" data-action="new-supplier">Agregar proveedor</button>':'')+'</div>'+
    '<input id="sq" type="search" placeholder="Buscar por nombre, teléfono, email o descripción" value="'+esc(ui.sq)+'" aria-label="Buscar proveedor" style="margin-bottom:1rem">'+
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Proveedor</th><th>Teléfono</th><th>Email</th><th class="num">Productos</th>'+(admin?'<th></th>':'')+'</tr></thead><tbody id="srows">'+supplierRows()+'</tbody></table></div></section>';
}
function usagePanel(){
  var u=ui.usage;if(!u)return '';
  var p=Math.min(100,Math.round(u.bytes/u.limit*100));
  return '<section class="sec"><h3>Espacio de la base de datos</h3><p><b>'+fmtBytes(u.bytes)+' de '+fmtBytes(u.limit)+'</b> <small>(plan gratuito de Supabase; las copias guardadas ocupan '+fmtBytes(u.backupBytes)+')</small></p>'+
    '<div class="meter'+(p>=80?' hot':'')+'" role="img" aria-label="'+p+'% del espacio usado"><i style="width:'+Math.max(p,1)+'%"></i></div>'+
    (p>=80?'<p class="warnbox">Queda poco espacio. Descargá una copia y borrá copias guardadas viejas, o pasá a un plan pago de Supabase.</p>':'')+'</section>';
}
function viewBackups(){
  if(!ui.backups)return loadingView('Copias de seguridad');
  var d=lastExportDays(),lastAuto=ui.backups.filter(function(b){return b.auto;})[0];
  var rows=ui.backups.length?ui.backups.map(function(b){
    var c=b.counts||{};
    return '<div class="bk"><div><b>'+esc(b.label)+'</b><br><small>'+fmtTs(b.createdAt)+' · '+plural(c.products||0,'producto','productos')+' · '+plural(c.sales||0,'venta','ventas')+' · '+plural(c.clients||0,'cliente','clientes')+'</small></div>'+
      '<div><button class="link" data-action="restore" data-id="'+b.id+'">Restaurar</button><button class="link bad" data-action="del-backup" data-id="'+b.id+'">Eliminar</button></div></div>';
  }).join(''):'<p class="empty">Todavía no hay copias guardadas.</p>';
  return '<section class="farm"><div class="head"><h1>Copias de seguridad</h1></div>'+
    '<p class="warnbox">La base de datos gratuita no incluye copias propias. Por eso el sistema guarda una copia por día dentro de la misma base (te sirve si borrás algo por error), pero <b>si se perdiera la base, esas copias también se pierden</b>. Descargá un archivo a tu computadora o a un pendrive, por lo menos una vez por semana.'+
    (d===null?' Todavía no descargaste ninguno desde esta computadora.':' La última descarga desde esta computadora fue hace '+plural(d,'día','días')+'.')+'</p>'+
    '<div class="cashbox" style="margin-top:1rem"><div class="panel"><h3>Copia automática diaria</h3><p>'+(lastAuto?'Última: '+fmtTs(lastAuto.createdAt)+'.':'Todavía no se hizo ninguna.')+' Se hace sola una vez por día y se conservan las últimas 7.</p></div>'+
    '<div class="panel"><h3>Archivo y copias manuales</h3><div class="filerow"><button class="btn primary" data-action="backup-download">Descargar copia a mi computadora</button><button class="btn" data-action="backup-now">Crear copia ahora</button><button class="btn" data-action="pick-file">Cargar desde archivo</button><input id="bfile" type="file" accept=".json,application/json" hidden></div></div></div>'+
    usagePanel()+'<section class="sec"><h3>Copias guardadas en el sistema</h3><div class="bk-list">'+rows+'</div></section></section>';
}
function viewUsers(){
  if(!ui.users)return loadingView('Usuarios');
  var rows=ui.users.map(function(u){
    return '<tr><td><b>'+esc(u.name)+'</b><br><small>'+esc(u.email)+'</small></td><td>'+(u.role==='admin'?'Dueño / administrador':'Empleado')+'</td><td>'+(u.active?'<span class="chip ok">Activo</span>':'<span class="chip none">Desactivado</span>')+'</td><td class="act"><button class="link" data-action="edit-user" data-id="'+u.id+'">Editar</button></td></tr>';
  }).join('');
  return '<section class="farm"><div class="head"><h1>Usuarios</h1><button class="btn primary" data-action="new-user">Nuevo usuario</button></div>'+
    '<p class="empty">El dueño ve todo. El empleado puede vender, cobrar servicios, abrir bolsas, ver el stock y manejar la agenda y los clientes, pero no ve costos, ganancias, la caja, los reportes ni las copias, y no puede cambiar precios ni anular ventas.</p>'+
    '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div></section>';
}

function render(){
  if(!S.user)return;
  var adminOnly={resumen:1,caja:1,reportes:1,copias:1,usuarios:1};
  if(adminOnly[ui.view]&&!isAdmin())ui.view='vender';
  renderNav();renderAlerts();renderUserBox();
  var v=ui.view;
  main.innerHTML=v==='resumen'?viewResumen():v==='vender'?viewVender():v==='ventas'?viewVentas():v==='stock'?viewStock():v==='servicios'?viewServicios():
    v==='agenda'?viewAgenda():v==='clientes'?viewClientes():v==='proveedores'?viewProveedores():v==='caja'?viewCaja():v==='reportes'?viewReportes():
    v==='copias'?viewBackups():viewUsers();
}
/* ============================================================
   Lector de códigos de barras con la cámara (opcional)
   Usa el detector nativo del navegador cuando existe (Chrome en Android) y, si no, la librería ZXing guardada en
   /vendor (iPhone/Safari y otros). Siempre se puede escribir el código a mano, y un lector USB funciona como teclado.
   ============================================================ */
var zxingLoading=null;
function loadZXing(){
  if(window.ZXing)return Promise.resolve();
  if(!zxingLoading)zxingLoading=new Promise(function(ok,fail){
    var sc=document.createElement('script');sc.src='/vendor/zxing-library.min.js';
    sc.onload=ok;sc.onerror=function(){zxingLoading=null;fail(new Error('No se pudo cargar el lector de códigos.'));};
    document.head.appendChild(sc);
  });
  return zxingLoading;
}
// Devuelve una promesa con el código leído (o escrito a mano), o null si se cancela.
function openScanner(title){
  return new Promise(function(resolve){
    var d=document.createElement('dialog');d.className='scan';
    d.innerHTML='<form class="dform"><h2>'+esc(title||'Escanear código de barras')+'</h2>'+
      '<div class="scanbox"><video playsinline muted autoplay></video><div class="scanline" aria-hidden="true"></div></div>'+
      '<p class="scanmsg" role="status">Abriendo la cámara…</p>'+
      '<div class="scanmanual"><label class="fld"><span>¿No lo lee? Escribí el código</span><input type="text" inputmode="numeric" autocomplete="off" id="scanman" placeholder="Ej.: 7791234567890"></label><button type="button" class="btn primary" id="scanuse">Usar</button></div>'+
      '<div class="actions"><button type="button" class="btn ghost" id="scancancel">Cancelar</button></div></form>';
    document.body.appendChild(d);
    var video=d.querySelector('video'),msg=d.querySelector('.scanmsg'),stream=null,timer=null,done=false,reader=null;
    var finish=function(code){
      if(done)return;done=true;clearTimeout(timer);
      if(stream)stream.getTracks().forEach(function(t){t.stop();});
      try{if(navigator.vibrate&&code)navigator.vibrate(60);}catch(e){}
      if(d.open)d.close();
    };
    d.addEventListener('close',function(){finish(null);d.remove();resolve(d._code||null);});
    var take=function(code){d._code=String(code).trim();finish(d._code);};
    d.querySelector('#scancancel').addEventListener('click',function(){finish(null);});
    var man=d.querySelector('#scanman');
    var useMan=function(){var v=man.value.trim();if(v)take(v);else msg.textContent='Escribí el código y tocá “Usar”.';};
    d.querySelector('#scanuse').addEventListener('click',useMan);
    man.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();useMan();}});
    d.showModal();
    if(!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)){
      msg.textContent='Este navegador no permite usar la cámara (hace falta abrir el sistema con https). Podés escribir el código.';return;
    }
    navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false}).then(function(st){
      if(done){st.getTracks().forEach(function(t){t.stop();});return;}
      stream=st;video.srcObject=st;return video.play().catch(function(){});
    }).then(function(){
      if(done||!stream)return;
      msg.textContent='Apuntá la cámara al código de barras y mantenelo quieto.';
      var cv=document.createElement('canvas'),cx=cv.getContext('2d',{willReadFrequently:true});
      var native=null,tick;
      var setup=window.BarcodeDetector?BarcodeDetector.getSupportedFormats().then(function(f){
        var want=['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf'].filter(function(x){return f.indexOf(x)>=0;});
        if(want.length)native=new BarcodeDetector({formats:want});
      }).catch(function(){}):Promise.resolve();
      return setup.then(function(){return native?null:loadZXing();}).then(function(){
        if(!native){
          var Z=window.ZXing,hints=new Map();
          hints.set(Z.DecodeHintType.POSSIBLE_FORMATS,[Z.BarcodeFormat.EAN_13,Z.BarcodeFormat.EAN_8,Z.BarcodeFormat.UPC_A,Z.BarcodeFormat.UPC_E,Z.BarcodeFormat.CODE_128,Z.BarcodeFormat.CODE_39,Z.BarcodeFormat.ITF]);
          hints.set(Z.DecodeHintType.TRY_HARDER,true);
          reader=new Z.MultiFormatReader();reader.setHints(hints);
        }
        tick=function(){
          if(done)return;
          var w=video.videoWidth,h=video.videoHeight;
          if(!w||!h){timer=setTimeout(tick,150);return;}
          var p=native?native.detect(video).then(function(r){return r&&r[0]?r[0].rawValue:null;}).catch(function(){return null;}):new Promise(function(ok){
            var k=Math.min(1,900/w);cv.width=Math.round(w*k);cv.height=Math.round(h*k);cx.drawImage(video,0,0,cv.width,cv.height);
            try{
              var Z=window.ZXing,bmp=new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(cv)));
              ok(reader.decode(bmp).getText());
            }catch(e){ok(null);}
          });
          p.then(function(code){if(code)take(code);else timer=setTimeout(tick,native?120:180);});
        };
        tick();
      });
    }).catch(function(err){
      var denied=err&&(err.name==='NotAllowedError'||err.name==='SecurityError');
      msg.textContent=denied?'No se pudo usar la cámara: permitila en el navegador (candado de la barra de direcciones). Podés escribir el código.':'No se pudo abrir la cámara'+(err&&err.message?' ('+err.message+')':'')+'. Podés escribir el código.';
    });
  });
}
// Producto que tiene ese código de barras (o undefined).
var prodByBarcode=function(code){var c=String(code||'').trim();return c?S.products.find(function(x){return x.barcode===c;}):undefined;};
// Vender con el escáner: en "Vender" lo suma a la venta; en otra pantalla abre la venta rápida.
async function scanToSell(code){
  var x=prodByBarcode(code);
  if(!x){toast('No hay ningún producto con el código '+code+'. Asignale el código desde “Editar” en Stock.',true);return;}
  if(ui.view==='vender'){addToCart('product',x.id);renderCart();return;}
  sellForm(x);
}
// Ingresar stock con el escáner: si el producto existe, abre "Llegó mercadería"; si no, ofrece cargarlo con el código ya puesto.
async function scanToStock(code){
  var x=prodByBarcode(code);
  if(x){buyForm(x);return;}
  var ch=await choiceDialog('Producto nuevo','<p>No hay ningún producto con el código <b>'+esc(code)+'</b>. ¿Querés cargarlo como producto nuevo? El código queda guardado para reconocerlo después.</p>',
    [{label:'Cancelar',value:null,cls:'ghost'},{label:'Cargar producto nuevo',value:'new',cls:'primary'}]);
  if(ch==='new')productForm(null,{barcode:code});
}

/* ============================================================
   Formularios
   ============================================================ */
async function confirmDuplicate(exists){
  if(!exists)return true;
  var ch=await choiceDialog('Posible duplicado','<p>Ya existe uno con ese nombre. ¿Crear igual?</p>',[{label:'Cancelar',value:'no',cls:'ghost'},{label:'Crear igual',value:'ok',cls:'primary'}]);
  return ch==='ok';
}
var sameName=function(a,b){return norm(a).trim()===norm(b).trim();};
var supplierOpts=function(){return [['','Sin proveedor']].concat((S.suppliers||[]).map(function(x){return [x.id,x.name];}));};
// Si un egreso en efectivo deja la caja en negativo, se avisa antes de guardar.
async function confirmNegativeCash(amount,method){
  if(method!=='Efectivo'||!S.summary||!(amount>0))return true;
  var after=r2(S.summary.drawer-amount);
  if(after>=0)return true;
  var ch=await choiceDialog('La caja queda en negativo','<p>Con este egreso la caja queda en <b>-'+money(-after)+'</b>. ¿Lo pagaste con otro fondo?</p>',
    [{label:'Cambiar forma de pago',value:'change',cls:'ghost'},{label:'Continuar igual',value:'go',cls:'primary'}]);
  return ch==='go';
}
// Muestra en vivo "Total: 20 × $800 = $16.000" debajo de los campos de cantidad y precio.
function bindTotalPreview(f,qtyName,priceName,label){
  var box=document.createElement('p');box.className='preview';
  f.querySelector('.fields').insertAdjacentElement('afterend',box);
  var q=f.querySelector('[name="'+qtyName+'"]'),u=f.querySelector('[name="'+priceName+'"]');
  var sync=function(){var n=Number(q.value),pr=Number(u.value);box.textContent=n>0&&pr>0?(label||'Total')+': '+String(n).replace('.',',')+' × '+money(pr)+' = '+money(r2(n*pr)):'';};
  q.addEventListener('input',sync);u.addEventListener('input',sync);sync();
}
var qtyStep=function(unit){return unit==='kg'?'0.001':'1';};

function productForm(x,preset){
  var admin=isAdmin(),isNew=!x;
  x=x||Object.assign({category:'Alimento balanceado',unit:'u',min:2,price:'',cost:''},preset||{});
  var looseOpts=[['','No se abre para vender suelto']].concat(S.products.filter(function(p){return p.unit==='kg'&&(!x.id||p.id!==x.id);}).map(function(p){return [p.id,p.name];}));
  var pf=openForm({title:isNew?'Nuevo producto':'Editar '+esc(x.name),
    body:'<div class="fields">'+fld('Nombre','name',{value:x.name,req:true,full:true,ph:'Ej.: Alimento perro adulto 15 kg'})+
      fld('Marca','brand',{value:x.brand,ph:'Ej.: Royal Canin'})+fld('Categoría','category',{opts:PROD_CATS,value:x.category})+
      fld('Para','species',{opts:SPECIES_OPTS,value:x.species})+fld('Se vende','unit',{opts:UNIT_OPTS,value:x.unit})+
      fld('Precio de venta','price',{type:'number',min:0,step:'0.01',value:x.price,req:true})+
      (admin?fld('Costo (lo que te cuesta)','cost',{type:'number',min:0,step:'0.01',value:x.cost||''}):'')+
      fld('Código de barras (opcional)','barcode',{value:x.barcode,full:true,ph:'Escribilo o escanealo con la cámara',pattern:'[0-9A-Za-z._\\-]{4,64}',title:'Entre 4 y 64 caracteres: letras, números, punto y guion'})+
      fld('Stock mínimo (para avisar)','min',{type:'number',min:0,step:qtyStep(x.unit),value:x.min,req:true})+
      fld('Vencimiento (opcional)','expires',{type:'date',value:x.expires})+
      fld('Proveedor habitual','supplierId',{opts:supplierOpts(),value:x.supplierId,full:true})+
      (isNew?fld('Stock inicial','stock',{type:'number',min:0,step:qtyStep(x.unit),value:0,req:true})+fld('Forma de pago','method',{opts:PAY,value:'Transferencia'})+
        fld('Registrar la compra del stock inicial como egreso en caja','cash',{type:'checkbox',value:false,full:true}):'')+
      '<fieldset class="full bagset"><legend>Bolsa que se abre para vender suelto (opcional)</legend><div class="fields">'+
        fld('Kilos que trae la bolsa','packKg',{type:'number',min:0.001,step:'0.001',value:x.packKg||'',ph:'Ej.: 15'})+fld('Producto suelto (por kilo)','looseId',{opts:looseOpts,value:x.looseId})+'</div></fieldset>'+
    '</div><p class="margin-preview preview"></p>'+(isNew?'':'<p>Para cambiar la cantidad usá el botón + (llegó mercadería) o “Ajustar stock”.</p>'),
    submit:isNew?'Agregar producto':'Guardar cambios',
    onSubmit:async function(d){
      var body={name:d.name,brand:d.brand,category:d.category,species:d.species,unit:d.unit,price:d.price,min:d.min,barcode:d.barcode,expires:d.expires,supplierId:d.supplierId||null,
        packKg:d.unit==='u'?d.packKg:'',looseId:d.unit==='u'&&d.looseId?Number(d.looseId):null};
      if(admin)body.cost=d.cost;
      if(isNew){
        if(!(await confirmDuplicate(S.products.some(function(p){return sameName(p.name,d.name);}))))return false;
        body.stock=d.stock;body.method=d.method;body.cash=!!d.cash;
        if(d.cash&&!(await confirmNegativeCash(Number(d.stock)*Number(d.cost),d.method)))return false;
        await api('/products',{body:body});await reload();toast('Producto agregado');
      }else{await api('/products/'+x.id,{method:'PUT',body:body});await reload();toast('Producto guardado');}
    }});
  // Unidad: los pasos de cantidad y la sección "bolsa" dependen de si se vende por unidad o por kilo.
  var unitSel=pf.querySelector('[name="unit"]'),bagset=pf.querySelector('.bagset');
  var syncUnit=function(){var st=qtyStep(unitSel.value);pf.querySelectorAll('[name="min"],[name="stock"]').forEach(function(i){i.step=st;});bagset.hidden=unitSel.value!=='u';};
  unitSel.addEventListener('change',syncUnit);syncUnit();
  // Margen en vivo (solo el dueño ve el costo).
  var mp=pf.querySelector('.margin-preview'),pr=pf.querySelector('[name="price"]'),co=pf.querySelector('[name="cost"]');
  var syncM=function(){var p=Number(pr.value),c=co?Number(co.value):0;mp.textContent=p>0&&c>0?'Ganás '+money(p-c)+' por '+(unitSel.value==='kg'?'kilo':'unidad')+' (margen '+pct((p-c)/p*100)+')':'';mp.classList.toggle('negtxt',p>0&&c>p);};
  pr.addEventListener('input',syncM);if(co)co.addEventListener('input',syncM);unitSel.addEventListener('change',syncM);syncM();
  // Botón de cámara junto al campo del código de barras.
  var bcIn=pf.querySelector('[name="barcode"]'),row=document.createElement('div');row.className='withbtn';
  bcIn.parentNode.insertBefore(row,bcIn);row.appendChild(bcIn);
  var sb=document.createElement('button');sb.type='button';sb.className='btn';sb.textContent='📷 Escanear';row.appendChild(sb);
  sb.addEventListener('click',async function(){
    var code=await openScanner('Escanear el código del producto');
    if(!code)return;
    var other=prodByBarcode(code);
    if(other&&(isNew||other.id!==x.id)){pf.querySelector('.err').textContent='Ese código ya pertenece al producto “'+other.name+'”.';return;}
    pf.querySelector('.err').textContent='';bcIn.value=code;
  });
}
function buyForm(x){
  var f=openForm({title:'Llegó mercadería: '+esc(x.name),
    body:'<div class="fields">'+fld('Cantidad que llegó'+(x.unit==='kg'?' (kg)':''),'qty',{type:'number',min:qtyStep(x.unit),step:qtyStep(x.unit),value:1,req:true})+
      fld('Precio de compra por '+(x.unit==='kg'?'kilo':'unidad'),'unitPrice',{type:'number',min:0.01,step:'0.01',value:x.cost||''})+
      fld('Forma de pago','method',{opts:PAY,value:'Transferencia'})+fld('Fecha','date',{type:'date',value:todayIso(),max:todayIso(),req:true})+
      fld('Proveedor','supplierId',{opts:supplierOpts(),value:x.supplierId})+fld('Vencimiento de este lote (opcional)','expires',{type:'date'})+
      fld('Registrar como egreso en caja','cash',{type:'checkbox',value:true,full:true})+'</div><p>Stock actual: '+fmtQty(x.stock,x.unit)+'. El precio de compra pasa a ser el costo del producto.</p>',
    submit:'Agregar al stock',
    onSubmit:async function(d){
      if(d.cash&&!(Number(d.unitPrice)>0))throw new Error('Ingresá el precio de compra para registrar el egreso en caja (o destildá “Registrar como egreso en caja”).');
      var cost=r2(Number(d.qty)*Number(d.unitPrice||0));
      if(d.cash&&!(await confirmNegativeCash(cost,d.method)))return false;
      var r=await api('/products/'+x.id+'/purchase',{body:{qty:d.qty,unitPrice:d.unitPrice||'',method:d.method,date:d.date,cash:!!d.cash,supplierId:d.supplierId||null,expires:d.expires}});
      await reload();toast('Se agregaron '+fmtQty(Number(d.qty),x.unit)+' al stock'+(d.cash&&r.cost>0?' · egreso de '+money(r.cost):''));
    }});
  bindTotalPreview(f,'qty','unitPrice','Total de la compra');
}
function movementsDialog(x){
  infoDialog('Historial de '+esc(x.name),'<p class="empty">Cargando…</p>');
  api('/products/'+x.id+'/movements').then(function(r){
    if(!dlg.open)return;
    var rows=r.items.map(function(m){
      return '<tr class="'+(m.voided?'voided':'')+'"><td>'+fmtDate(m.date)+'</td><td>'+esc(m.reason)+(m.saleId?' <small>(venta N° '+m.saleId+')</small>':'')+(m.note?'<br><small>'+esc(m.note)+'</small>':'')+'</td><td class="num '+(m.qty<0?'out':'in')+'">'+(m.qty>0?'+':'')+fmtQty(m.qty,x.unit)+'</td>'+
        '<td class="num">'+(m.unitPrice>0?money(m.unitPrice):'—')+'</td><td class="num">'+(m.unitPrice>0?money(m.unitPrice*Math.abs(m.qty)):'—')+'</td></tr>';
    }).join('');
    var p=dlg.querySelector('p.empty');
    if(p)p.outerHTML='<div class="tbl-wrap"><table class="tbl slim"><thead><tr><th>Fecha</th><th>Motivo</th><th class="num">Cantidad</th><th class="num">Precio</th><th class="num">Total</th></tr></thead><tbody>'+
      (rows||'<tr><td colspan="5" class="empty">Todavía no hay movimientos.</td></tr>')+'</tbody></table></div>';
  }).catch(function(e){if(dlg.open)toast(e.message);});
}
function adjustForm(x){
  openForm({title:'Ajustar stock de '+esc(x.name),
    body:'<div class="fields">'+fld('Cantidad a sumar o restar','delta',{type:'number',step:qtyStep(x.unit),req:true,ph:'Ej.: -2 para restar 2',full:true})+
      fld('Motivo','reason',{opts:ADJUST_REASONS,full:true})+fld('Nota (opcional)','note',{full:true,ph:'Ej.: se rompió la bolsa'})+'</div>'+
      '<p>Stock actual: '+fmtQty(x.stock,x.unit)+'. Sirve para corregir el stock (roturas, vencidos, lo que se usa en la peluquería). No modifica la caja.</p>',
    submit:'Ajustar stock',
    onSubmit:async function(d){await api('/products/'+x.id+'/adjust',{body:{delta:d.delta,reason:d.reason,note:d.note}});await reload();toast('Stock ajustado');}});
}
// Venta rápida de un producto (botón "Vender" del stock): cantidad y forma de pago, y listo.
function sellForm(x){
  if(x.stock<=0){toast('No queda stock de '+x.name,true);return;}
  var f=openForm({title:'Vender '+esc(x.name),
    body:'<div class="fields">'+fld('Cantidad'+(x.unit==='kg'?' (kg)':''),'qty',{type:'number',min:qtyStep(x.unit),max:x.stock,step:qtyStep(x.unit),value:1,req:true})+
      fld('Forma de pago','method',{opts:PAY,value:'Efectivo'})+'</div><p>Precio: '+money(x.price)+(x.unit==='kg'?' por kilo':' c/u')+'. Quedan '+fmtQty(x.stock,x.unit)+'.</p>'+
      '<p><button type="button" class="link" data-x="tocart">Agregar al carrito para vender varias cosas juntas →</button></p>',
    submit:'Registrar venta',
    onSubmit:async function(d){
      var r=await api('/sales',{body:{method:d.method,items:[{type:'product',id:x.id,qty:d.qty}]}});
      await reload();saleDoneDialog(r.id,r.total);return false;
    }});
  var box=document.createElement('p');box.className='preview';f.querySelector('.fields').insertAdjacentElement('afterend',box);
  var q=f.querySelector('[name="qty"]');
  var sync=function(){var n=Number(q.value);box.textContent=n>0?'Total: '+money(r2(n*x.price)):'';};
  q.addEventListener('input',sync);sync();
  f.querySelector('[data-x="tocart"]').addEventListener('click',function(){addToCart('product',x.id,Number(q.value)||1);dlg.close();go('vender');});
}
function openBagForm(x){
  var loose=prodById(x.looseId);
  if(!loose){toast('El producto suelto de esta bolsa ya no existe. Revisalo en “Editar”.',true);return;}
  var f=openForm({title:'Abrir bolsa de '+esc(x.name),
    body:'<div class="fields">'+fld('Cantidad de bolsas a abrir','bags',{type:'number',min:1,max:x.stock,step:'1',value:1,req:true,full:true})+'</div>'+
      '<p>Cada bolsa trae '+fmtQty(x.packKg,'kg')+'. Se restan del stock de “'+esc(x.name)+'” (quedan '+fmtQty(x.stock,x.unit)+') y se suman a “'+esc(loose.name)+'” (hay '+fmtQty(loose.stock,'kg')+').</p>',
    submit:'Abrir bolsa',
    onSubmit:async function(d){var r=await api('/products/'+x.id+'/open-bag',{body:{bags:d.bags}});await reload();toast('Se sumaron '+fmtQty(r.kg,'kg')+' a '+r.loose);}});
  var p=document.createElement('p');p.className='preview';f.querySelector('.fields').insertAdjacentElement('afterend',p);
  var b=f.querySelector('[name="bags"]'),s=function(){p.textContent=Number(b.value)>0?'Pasan '+fmtQty(r3(Number(b.value)*x.packKg),'kg')+' al suelto':'';};b.addEventListener('input',s);s();
}
function bulkPriceForm(){
  var brands=[];S.products.forEach(function(p){if(p.brand&&brands.indexOf(p.brand)<0)brands.push(p.brand);});brands.sort();
  var f=openForm({title:'Actualizar precios',
    body:'<div class="fields">'+fld('Aplicar a','scope',{opts:[['all','Todos los productos'],['category','Una categoría'],['brand','Una marca'],['supplier','Un proveedor']],full:true})+
      fld('Categoría','vcat',{opts:PROD_CATS})+fld('Marca','vbrand',{opts:brands.length?brands:[['','No hay marcas cargadas']]})+fld('Proveedor','vsup',{opts:(S.suppliers||[]).map(function(s){return [s.id,s.name];})})+
      fld('Porcentaje','percent',{type:'number',step:'0.1',min:-90,max:1000,req:true,ph:'Ej.: 10 para subir 10%, -5 para bajar'})+
      fld('Redondear a','round',{opts:[['0','Sin redondeo'],['10','$10'],['50','$50'],['100','$100']],value:'10'})+'</div><p class="preview"></p>',
    submit:'Actualizar precios',
    onSubmit:async function(d){
      var v=d.scope==='category'?d.vcat:d.scope==='brand'?d.vbrand:d.scope==='supplier'?d.vsup:'';
      if(d.scope!=='all'&&!v)throw new Error('Elegí a qué productos aplicarlo');
      var r=await api('/products/bulk-price',{body:{scope:d.scope,value:v,percent:d.percent,round:Number(d.round)}});
      await reload();toast('Precios actualizados: '+plural(r.updated,'producto','productos'));
    }});
  var sc=f.querySelector('[name="scope"]'),pv=f.querySelector('.preview');
  var labs={vcat:'category',vbrand:'brand',vsup:'supplier'};
  var match=function(){
    var s=sc.value;
    return S.products.filter(function(p){
      if(s==='category')return p.category===f.querySelector('[name="vcat"]').value;
      if(s==='brand')return norm(p.brand)===norm(f.querySelector('[name="vbrand"]').value);
      if(s==='supplier')return String(p.supplierId)===f.querySelector('[name="vsup"]').value;
      return true;
    });
  };
  var sync=function(){
    Object.keys(labs).forEach(function(k){f.querySelector('[name="'+k+'"]').closest('label').hidden=sc.value!==labs[k];});
    var L=match(),p=Number(f.querySelector('[name="percent"]').value),rd=Number(f.querySelector('[name="round"]').value);
    if(!p){pv.textContent=plural(L.length,'producto','productos')+' afectados.';return;}
    var ex=L[0];var nv=ex?(rd?Math.max(Math.round(ex.price*(1+p/100)/rd)*rd,0):r2(ex.price*(1+p/100))):0;
    pv.textContent=plural(L.length,'producto','productos')+' afectados.'+(ex?' Ejemplo: '+ex.name+' pasa de '+money(ex.price)+' a '+money(nv)+'.':'');
  };
  f.addEventListener('input',sync);f.addEventListener('change',sync);sync();
}
function serviceForm(s){
  var isNew=!s;s=s||{category:'Baño',price:'',duration:60};
  openForm({title:isNew?'Nuevo servicio':'Editar servicio',
    body:'<div class="fields">'+fld('Servicio','name',{value:s.name,req:true,full:true,ph:'Ej.: Baño y corte perro mediano'})+fld('Categoría','category',{opts:SERV_CATS,value:s.category})+
      fld('Precio','price',{type:'number',min:0,step:'0.01',value:s.price,req:true})+fld('Duración aproximada (minutos)','duration',{type:'number',min:5,max:600,step:'5',value:s.duration,req:true})+'</div>',
    submit:isNew?'Agregar servicio':'Guardar cambios',
    onSubmit:async function(d){
      var body={name:d.name,category:d.category,price:d.price,duration:d.duration};
      if(isNew&&!(await confirmDuplicate(S.services.some(function(x){return sameName(x.name,d.name);}))))return false;
      if(isNew)await api('/services',{body:body});else await api('/services/'+s.id,{method:'PUT',body:body});
      await reload();toast(isNew?'Servicio agregado':'Servicio guardado');
    }});
}
function petFields(p){
  p=p||{species:'Perro'};
  return fld('Nombre de la mascota','pname',{value:p.name,full:true})+fld('Especie','pspecies',{opts:PET_SPECIES,value:p.species})+fld('Tamaño','psize',{opts:PET_SIZES,value:p.size})+
    fld('Raza','pbreed',{value:p.breed,ph:'Ej.: Caniche'})+fld('Fecha de nacimiento (aprox.)','pbirth',{type:'date',value:p.birth,max:todayIso()})+
    fld('Notas de peluquería','pnotes',{type:'textarea',value:p.notes,full:true,ph:'Ej.: corte a tijera, se pone nervioso con el secador'});
}
var petBody=function(d){return {name:d.pname,species:d.pspecies,size:d.psize,breed:d.pbreed,birth:d.pbirth,notes:d.pnotes};};
function clientForm(c){
  var isNew=!c;c=c||{};
  openForm({title:isNew?'Nuevo cliente':'Editar datos de '+esc(c.name),
    body:'<div class="fields">'+fld('Nombre','firstName',{value:c.firstName,req:true})+fld('Apellido','lastName',{value:c.lastName})+
      fld('Teléfono','phone',{type:'tel',value:c.phone,pattern:PHONE_PAT,title:'Solo números, espacios, + , - y paréntesis (mínimo 6 dígitos)'})+fld('Email','email',{type:'email',value:c.email})+
      fld('Dirección','address',{value:c.address,full:true})+fld('Notas','notes',{type:'textarea',value:c.notes,full:true,ph:'Ej.: compra alimento cada mes'})+
      (isNew?'<fieldset class="full"><legend>Primera mascota (opcional)</legend><div class="fields">'+petFields()+'</div></fieldset>':'')+'</div>',
    submit:isNew?'Agregar cliente':'Guardar cambios',
    onSubmit:async function(d){
      var body={firstName:d.firstName,lastName:d.lastName,phone:d.phone,email:d.email,address:d.address,notes:d.notes};
      if(isNew){
        if(!(await confirmDuplicate(S.clients.some(function(x){return sameName(x.name,(d.firstName+' '+d.lastName).trim());}))))return false;
        if(d.pname)body.pet=petBody(d);
        var r=await api('/clients',{body:body});ui.csel=r.id;ui.cdetail=null;
        if(ui.view!=='clientes'){await reload();toast('Cliente agregado');return;}
      }else await api('/clients/'+c.id,{method:'PUT',body:body});
      await reload();toast(isNew?'Cliente agregado':'Cliente guardado');
    }});
}
function petForm(p,clientId){
  var isNew=!p;
  var cOpts=S.clients.map(function(x){return [x.id,x.name];});
  openForm({title:isNew?'Nueva mascota':'Editar a '+esc(p.name),
    body:'<div class="fields">'+(isNew?'':fld('Cliente (dueño)','clientId',{opts:cOpts,value:p.clientId,full:true}))+petFields(p)+'</div>',
    submit:isNew?'Agregar mascota':'Guardar cambios',
    onSubmit:async function(d){
      if(!d.pname)throw new Error('Completá el nombre de la mascota');
      var body=petBody(d);
      if(isNew)await api('/clients/'+clientId+'/pets',{body:body});
      else{body.clientId=Number(d.clientId);await api('/pets/'+p.id,{method:'PUT',body:body});}
      await reload();toast(isNew?'Mascota agregada':'Mascota guardada');
    }});
}

// Turnos: el aviso de superposición no bloquea (se puede agendar igual).
async function confirmNoOverlap(body,selfId){
  var list=(await api('/appointments?from='+body.date+'&to='+body.date)).items.filter(function(a){return a.id!==selfId&&a.status!=='cancelado';});
  var s0=toMin(body.time),e0=s0+Number(body.duration);
  var hit=list.find(function(a){var as=toMin(a.time);return s0<as+a.duration&&as<e0;});
  if(!hit)return true;
  var ch=await choiceDialog('Turno superpuesto','<p>Ya hay un turno a esa hora: '+esc(hit.pet)+' ('+esc(hit.clientLast)+') – '+esc(hit.service||'sin servicio')+'. ¿Agendar igual?</p>',
    [{label:'Cambiar la hora',value:'no',cls:'ghost'},{label:'Agendar igual',value:'ok',cls:'primary'}]);
  return ch==='ok';
}
function appointmentForm(a,presetDate,presetPet){
  var isNew=!a;
  var pets=[];S.clients.forEach(function(c){c.pets.forEach(function(p){pets.push([p.id,p.name+' ('+c.name+')']);});});
  if(!pets.length){toast('Primero cargá un cliente con su mascota en “Clientes”.',true);return;}
  pets.sort(function(x,y){return x[1].localeCompare(y[1],'es');});
  a=a||{date:presetDate||todayIso(),time:'10:00',duration:60,status:'reservado',petId:presetPet||''};
  var svOpts=[['','Sin servicio definido']].concat(S.services.map(function(s){return [s.id,s.name+' · '+money(s.price)];}));
  var f=openForm({title:isNew?'Nuevo turno':'Editar turno',
    body:'<div class="fields">'+fld('Mascota','petId',{opts:pets,value:a.petId,full:true})+fld('Servicio','serviceId',{opts:svOpts,value:a.serviceId,full:true})+
      fld('Fecha','date',{type:'date',value:a.date,req:true})+fld('Hora','time',{type:'time',value:a.time,req:true})+
      fld('Duración (minutos)','duration',{type:'number',min:5,max:600,step:'5',value:a.duration,req:true})+fld('Estado','status',{opts:APPT_STATUS,value:a.status})+
      fld('Notas (opcional)','notes',{type:'textarea',value:a.notes,full:true,ph:'Ej.: lo trae a las 10 y lo retira a las 13'})+'</div>',
    submit:isNew?'Agendar turno':'Guardar cambios',
    onSubmit:async function(d){
      var body={petId:Number(d.petId),serviceId:d.serviceId?Number(d.serviceId):null,date:d.date,time:d.time,duration:Number(d.duration),status:d.status,notes:d.notes};
      if(d.status!=='cancelado'&&!(await confirmNoOverlap(body,isNew?null:a.id)))return false;
      if(isNew)await api('/appointments',{body:body});else await api('/appointments/'+a.id,{method:'PUT',body:body});
      if(ui.view==='agenda')await reloadCal();else await reload();
      toast(isNew?'Turno agendado':'Turno guardado');
    }});
  // La duración sigue al servicio elegido.
  f.querySelector('[name="serviceId"]').addEventListener('change',function(e){var s=servById(e.target.value);if(s)f.querySelector('[name="duration"]').value=s.duration;});
}
async function setApptStatus(a,status){
  await api('/appointments/'+a.id+'/status',{body:{status:status}});
  dlg.close();await reloadCal();toast('Turno: '+APPT_LABEL[status]);
}
// Cobrar un turno: arma la venta con el servicio, el cliente y la mascota, y lleva a "Vender".
function chargeAppt(a){
  ui.cart=newCart();
  if(a.serviceId&&servById(a.serviceId))addToCart('service',a.serviceId,1);
  ui.cart.clientId=String(a.clientId);ui.cart.petId=String(a.petId);ui.cart.apptId=a.id;
  dlg.close();go('vender');
}
function appointmentDetails(a){
  var tel=String(a.phone||'').replace(/[^\d+]/g,'');
  var btns=[];
  if(a.status==='reservado')btns.push({label:'Empezar',fn:function(){return setApptStatus(a,'en_curso');}});
  if(a.status==='reservado'||a.status==='en_curso')btns.push({label:'Listo para retirar',fn:function(){return setApptStatus(a,'listo');}});
  if(!a.saleId&&a.status!=='cancelado'&&a.status!=='no_vino')btns.push({label:'Cobrar'+(a.servicePrice!=null?' '+money(a.servicePrice):''),cls:'primary',fn:function(){chargeAppt(a);}});
  if(a.status==='reservado')btns.push({label:'No vino',fn:function(){return setApptStatus(a,'no_vino');}});
  btns.push({label:'Editar',fn:function(){dlg.close();appointmentForm(a);}});
  btns.push({label:'Eliminar',cls:'danger-o',fn:function(){
    confirmForm('Eliminar turno','Se elimina el turno de '+esc(a.pet)+' del '+fmtDate(a.date)+' a las '+a.time+'.','Eliminar',async function(){await api('/appointments/'+a.id,{method:'DELETE'});await reloadCal();toast('Turno eliminado');});
  }});
  infoDialog(esc(a.pet)+' · '+a.time+' hs',
    '<p><b>'+esc(a.service||'Sin servicio definido')+'</b>'+(a.servicePrice!=null?' · '+money(a.servicePrice):'')+'</p>'+
    '<p>'+fmtDate(a.date)+' de '+a.time+' a '+a.endTime+' · <span class="chip st-'+a.status+'">'+esc(APPT_LABEL[a.status])+'</span>'+(a.saleId?' <span class="chip ok">Cobrado (venta N° '+a.saleId+')</span>':'')+'</p>'+
    '<p><b>Mascota:</b> '+esc([a.species,a.breed,a.size].filter(Boolean).join(' · '))+'</p>'+(a.petNotes?'<p class="warnbox">✂️ '+esc(a.petNotes)+'</p>':'')+
    '<p><b>Dueño:</b> '+esc(a.client)+(a.phone?' · <a href="tel:'+esc(tel)+'">'+esc(a.phone)+'</a>':'')+'</p>'+(a.notes?'<p><b>Notas:</b> '+esc(a.notes)+'</p>':''),btns);
}

function cashForm(type){
  openForm({title:type==='in'?'Registrar ingreso':'Registrar gasto',
    body:'<div class="fields">'+fld('Fecha','date',{type:'date',value:todayIso(),req:true})+fld('Monto','amount',{type:'number',min:0.01,step:'0.01',req:true})+
    fld('Concepto','concept',{req:true,full:true,ph:type==='in'?'Ej.: Aporte del dueño':'Ej.: Pago de luz'})+
    fld('Categoría','category',{opts:type==='in'?CASH_IN_CATS:CASH_OUT_CATS,value:type==='in'?'Otros ingresos':'Alquiler y servicios'})+fld('Forma de pago','method',{opts:PAY,value:'Efectivo'})+
    (type==='out'?fld('Proveedor (opcional)','supplierId',{opts:supplierOpts(),full:true}):'')+'</div>'+(type==='in'?'<p>Las ventas entran solas a la caja: esto es para otros ingresos.</p>':''),
    submit:'Registrar',
    onSubmit:async function(d){
      var future=d.date>todayIso();
      if(future){
        var ch=await choiceDialog('Fecha posterior a hoy','<p>La fecha es posterior a hoy, ¿es correcto?</p>',[{label:'Corregir la fecha',value:'no',cls:'ghost'},{label:'Sí, es correcta',value:'ok',cls:'primary'}]);
        if(ch!=='ok')return false;
      }
      if(type==='out'&&!future&&!(await confirmNegativeCash(Number(d.amount),d.method)))return false;
      await api('/cash',{body:{date:d.date,type:type,concept:d.concept,category:d.category,method:d.method,amount:d.amount,confirmFuture:future,supplierId:d.supplierId||null}});await reload();toast('Movimiento registrado');
    }});
}
function supplierForm(s){
  var isNew=!s;s=s||{};
  openForm({title:isNew?'Nuevo proveedor':'Editar proveedor',
    body:'<div class="fields">'+fld('Nombre','name',{value:s.name,req:true,full:true})+fld('Teléfono','phone',{type:'tel',value:s.phone,pattern:PHONE_PAT,title:'Solo números, espacios, + , - y paréntesis (mínimo 6 dígitos)'})+fld('Email','email',{type:'email',value:s.email})+
    fld('Qué se le compra (opcional)','description',{type:'textarea',value:s.description,full:true,ph:'Ej.: alimento balanceado, piedras sanitarias'})+'</div>',
    submit:isNew?'Agregar proveedor':'Guardar cambios',
    onSubmit:async function(d){
      var body={name:d.name,phone:d.phone,email:d.email,description:d.description};
      if(isNew&&!(await confirmDuplicate(S.suppliers.some(function(x){return sameName(x.name,d.name);}))))return false;
      if(isNew)await api('/suppliers',{body:body});else await api('/suppliers/'+s.id,{method:'PUT',body:body});
      await reload();toast(isNew?'Proveedor agregado':'Proveedor guardado');
    }});
}
function supplierDetail(id){
  infoDialog('Proveedor','<p class="empty">Cargando…</p>');
  api('/suppliers/'+id+'/detail').then(function(r){
    if(!dlg.open)return;
    var sp=r.supplier;
    var prods=r.products.length?'<ul class="plainlist">'+r.products.map(function(p){return '<li><b>'+esc(p.name)+'</b> <small>'+esc(p.category)+' · stock '+fmtQty(p.stock,p.unit)+(p.stock<=p.min?' · <span class="negtxt">pedir</span>':'')+'</small></li>';}).join('')+'</ul>':'<p class="empty">Todavía no hay productos con este proveedor.</p>';
    var buys=r.purchases.length?'<div class="tbl-wrap"><table class="tbl slim"><thead><tr><th>Fecha</th><th>Concepto</th><th class="num">Total</th></tr></thead><tbody>'+r.purchases.map(function(x){
      return '<tr><td>'+fmtDate(x.date)+'</td><td>'+esc(x.concept)+'</td><td class="num">'+money(x.total)+'</td></tr>';}).join('')+'</tbody></table></div>':'<p class="empty">Todavía no hay pagos registrados a este proveedor.</p>';
    infoDialog(esc(sp.name),'<p>'+[sp.phone,sp.email].filter(Boolean).map(esc).join(' · ')+'</p>'+(sp.description?'<p><small>'+esc(sp.description)+'</small></p>':'')+
      '<h3>Productos</h3>'+prods+'<h3>Pagos y compras</h3>'+buys+'<div class="ctotals"><div class="grand"><span>Total pagado</span><span>'+money(r.totalSpent)+'</span></div></div>');
  }).catch(function(e){if(dlg.open){dlg.close();toast(e.message);}});
}
function userForm(u){
  var isNew=!u;u=u||{role:'staff',active:true};
  openForm({title:isNew?'Nuevo usuario':'Editar usuario',
    body:'<div class="fields">'+fld('Nombre','name',{value:u.name,req:true,full:true})+
    (isNew?fld('Email (es el usuario para ingresar)','email',{type:'email',req:true,full:true,auto:'off'}):'<p class="full" style="grid-column:1/-1">'+esc(u.email)+'</p>')+
    fld('Rol','role',{opts:[['staff','Empleado'],['admin','Dueño / administrador']],value:u.role})+
    fld(isNew?'Contraseña (mínimo 8 caracteres)':'Nueva contraseña (dejala vacía para no cambiarla)','password',{type:'password',req:isNew,minlength:8,auto:'new-password'})+
    (isNew?'':fld('Usuario activo','active',{type:'checkbox',value:u.active,full:true}))+'</div>',
    submit:isNew?'Crear usuario':'Guardar cambios',
    onSubmit:async function(d){
      if(isNew){await api('/users',{body:{name:d.name,email:d.email,role:d.role,password:d.password}});await reload();toast('Usuario creado');}
      else{await api('/users/'+u.id,{method:'PATCH',body:{name:d.name,role:d.role,active:!!d.active,password:d.password}});await reload();toast('Usuario guardado');}
    }});
}
function passwordForm(){
  openForm({title:'Cambiar contraseña',
    body:'<div class="fields">'+fld('Contraseña actual','current',{type:'password',req:true,full:true,auto:'current-password'})+
    fld('Contraseña nueva (mínimo 8 caracteres)','password',{type:'password',req:true,full:true,minlength:8,auto:'new-password'})+
    fld('Repetí la contraseña nueva','repeat',{type:'password',req:true,full:true,auto:'new-password'})+'</div>',
    submit:'Cambiar contraseña',
    onSubmit:async function(d){
      if(d.password!==d.repeat)throw new Error('Las contraseñas nuevas no coinciden');
      await api('/me/password',{body:{current:d.current,password:d.password}});
      toast('Contraseña cambiada');
    }});
}
async function downloadExport(){
  await downloadFile('/backup/export','copia-petshop-'+todayIso()+'.json');
  try{localStorage.setItem('petshop_last_export',String(Date.now()));}catch(e){}
  render();
  toast('Copia descargada. Guardala en un lugar seguro.');
}
var COUNT_LABELS=[['products','producto','productos'],['sales','venta','ventas'],['clients','cliente','clientes'],['cash_movements','movimiento de caja','movimientos de caja']];
var countsText=function(c){return COUNT_LABELS.map(function(l){return plural(c[l[0]]||0,l[1],l[2]);}).join(', ');};
var countsTotal=function(c){return Object.keys(c).reduce(function(n,k){return n+(Number(c[k])||0);},0);};
// Confirmación reforzada: cuántos registros hay hoy y cuántos tiene la copia. Si la copia está vacía, se avisa fuerte.
function restoreConfirm(label,copyCounts,curCounts,doRestore){
  var empty=countsTotal(copyCounts)===0;
  openForm({title:'Restaurar copia',danger:empty,submit:'Restaurar',
    body:'<p>Vas a reemplazar los datos actuales ('+esc(countsText(curCounts))+') por esta copia ('+esc(countsText(copyCounts))+').</p>'+
      '<p><small>Copia: '+esc(label)+'. Antes se guarda una copia de los datos de ahora. Los usuarios no cambian.</small></p>'+
      (empty?'<p class="warnbox"><b>⚠️ Esta copia está vacía, restaurarla borra todo</b></p><label class="fld check"><input type="checkbox" name="understand" required><span>Entiendo que se borran todos los datos actuales</span></label>':''),
    onSubmit:function(){return doRestore(empty);}});
}
async function restoreFileForm(data,label){
  toast('Revisando la copia…');
  var cur=(await api('/backups/current')).counts;
  var cc={};Object.keys(data).forEach(function(k){if(Array.isArray(data[k]))cc[k]=data[k].length;});
  restoreConfirm(label,cc,cur,async function(empty){
    await api('/restore',{body:{data:data,confirmEmpty:empty}});ui.csel=null;ui.cdetail=null;ui.cart=newCart();await reload();toast('Copia restaurada');
  });
}

/* ============================================================
   Acciones (botones de la pantalla)
   ============================================================ */
var byId=function(list,id){return (list||[]).find(function(x){return String(x.id)===String(id);});};
function salesRange(v){
  var t=todayIso();
  if(v==='today')return ['',''];
  if(v==='yesterday'){var y=shiftDays(-1);return [y,y];}
  if(v==='week')return [shiftDays(-6),t];
  return [t.slice(0,8)+'01',t];
}
var actions={
  nav:function(id,b){return go(b.dataset.v);},
  // Vender
  'cart-add':function(id,b){addToCart(b.dataset.type,id);renderCart();var q=$('#posq');if(q)q.focus();},
  'cart-del':function(id,b){ui.cart.items.splice(Number(b.dataset.i),1);renderCart();},
  'cart-clear':function(){ui.cart=newCart();renderCart();},
  'cart-method':function(id,b){ui.cart.method=b.dataset.v;renderCart();},
  'cart-pay':function(){return payCart();},
  'sell-service':function(id){addToCart('service',id);return go('vender');},
  'client-sell':function(){var c=ui.cdetail;if(!c)return;ui.cart.clientId=String(c.id);ui.cart.petId=c.pets.length===1?String(c.pets[0].id):'';return go('vender');},
  // Ventas
  'sale-view':function(id){return saleDetail(id);},
  'sale-print':function(id){return printSale(id);},
  'sale-void':function(id){voidSale(id);},
  'sales-period':function(id,b){var r=salesRange(b.dataset.v);ui.sfrom=r[0];ui.sto=r[1];return refreshView();},
  'sales-export':function(){
    var from=ui.sfrom||todayIso(),to=ui.sto||todayIso();
    return downloadFile('/reports/sales-export?from='+from+'&to='+to,'ventas-'+from+'_a_'+to+'.csv');
  },
  // Stock
  'goto-stock':function(id,b){ui.stab='products';ui.stf=b.dataset.v||'all';ui.cat='all';ui.stq='';return go('stock');},
  stab:function(id,b){ui.stab=b.dataset.v;render();},
  stf:function(id,b){ui.stf=b.dataset.v;render();},
  'new-product':function(){productForm();},
  'scan-sell':async function(){var c=await openScanner('Vender: escanear el producto');if(c)await scanToSell(c);},
  'scan-stock':async function(){var c=await openScanner('Ingresar stock: escanear el producto');if(c)await scanToStock(c);},
  'edit-product':function(id){productForm(prodById(id));},
  'del-product':function(id){
    var x=prodById(id);if(!x)return;
    confirmForm('Eliminar '+esc(x.name),'El producto se quita del catálogo. Las ventas ya registradas no cambian.','Eliminar',async function(){
      await api('/products/'+id,{method:'DELETE'});await reload();toast('Producto eliminado');
    });
  },
  'stock-add':function(id){buyForm(prodById(id));},
  'stock-adjust':function(id){adjustForm(prodById(id));},
  'stock-history':function(id){movementsDialog(prodById(id));},
  sell:function(id){sellForm(prodById(id));},
  'open-bag':function(id){openBagForm(prodById(id));},
  'bulk-price':function(){bulkPriceForm();},
  'copy-order':async function(id,b){
    var g=restockGroups()[Number(b.dataset.i)];if(!g)return;
    var txt='Hola'+(g.supplier?' '+g.supplier.name:'')+', te hago el siguiente pedido para '+S.shop+':\n'+g.items.map(function(it){return '- '+fmtQty(it.qty,it.p.unit)+' × '+it.p.name+(it.p.brand?' ('+it.p.brand+')':'');}).join('\n')+'\nGracias.';
    try{await navigator.clipboard.writeText(txt);toast('Pedido copiado: pegalo en WhatsApp o en un mail');}
    catch(e){infoDialog('Pedido','<textarea rows="10" readonly>'+esc(txt)+'</textarea>');}
  },
  // Servicios
  'new-service':function(){serviceForm();},
  'edit-service':function(id){serviceForm(servById(id));},
  'del-service':function(id){
    var s=servById(id);if(!s)return;
    confirmForm('Eliminar '+esc(s.name),'Se quita de la lista de precios. Las ventas y turnos ya registrados no cambian.','Eliminar',async function(){
      await api('/services/'+id,{method:'DELETE'});await reload();toast('Servicio eliminado');
    });
  },
  // Clientes
  'select-client':function(id){ui.csel=Number(id);ui.cdetail=null;window.scrollTo(0,0);return refreshView();},
  'back-client':function(){ui.csel=null;ui.cdetail=null;render();},
  'new-client':function(){clientForm();},
  'edit-client':function(){if(ui.cdetail)clientForm(ui.cdetail);},
  'add-pet':function(){if(ui.cdetail)petForm(null,ui.cdetail.id);},
  'edit-pet':function(id){var p=byId(ui.cdetail&&ui.cdetail.pets,id);if(p)petForm(p);},
  'del-pet':function(id){
    var p=byId(ui.cdetail&&ui.cdetail.pets,id);if(!p)return;
    confirmForm('Quitar a '+esc(p.name),'Se quita la mascota y sus turnos. Las compras del cliente no cambian.','Quitar',async function(){
      await api('/pets/'+id,{method:'DELETE'});await reload();toast('Mascota quitada');
    });
  },
  'pet-appt':function(id){appointmentForm(null,todayIso(),Number(id));},
  'del-client':function(){
    var c=ui.cdetail;if(!c)return;
    confirmForm('Eliminar a '+esc(c.name),'Se elimina el cliente'+(c.pets.length?', sus '+plural(c.pets.length,'mascota','mascotas')+' y sus turnos':'')+'. Sus compras quedan registradas (sin cliente). Esta acción no se puede deshacer.','Eliminar cliente',async function(){
      await api('/clients/'+c.id,{method:'DELETE'});ui.csel=null;ui.cdetail=null;await reload();toast('Cliente eliminado');
    });
  },
  // Agenda
  'new-appt':function(){appointmentForm(null,ui.cal.anchor);},
  'cal-add-day':function(id,b){appointmentForm(null,b.dataset.v);},
  'appt-view':function(id){var a=byId(ui.appts,id);if(a)appointmentDetails(a);},
  'cal-prev':function(){calShift(-1);return reloadCal();},
  'cal-next':function(){calShift(1);return reloadCal();},
  'cal-today':function(){ui.cal.anchor=todayIso();return reloadCal();},
  'cal-view':function(id,b){ui.cal.view=b.dataset.v;return reloadCal();},
  'cal-day':function(id,b){ui.cal.anchor=b.dataset.v;ui.cal.view='day';return reloadCal();},
  // Caja
  cashp:function(id,b){ui.cashp=b.dataset.v;ui.cfrom='';ui.cto='';return refreshView();},
  cashf:function(id,b){ui.cashf=b.dataset.v;return refreshView();},
  cashm:function(id,b){ui.cashm=b.dataset.v;return refreshView();},
  'cash-clear-filters':function(){ui.cashp='month';ui.cfrom='';ui.cto='';ui.cashf='all';ui.cashm='all';ui.cq='';return refreshView();},
  'cash-export':function(){
    if(ui.cashp==='range'&&!(ui.cfrom&&ui.cto))throw new Error('Completá las dos fechas del rango');
    return downloadFile('/cash/export?'+cashQuery(),'movimientos-'+todayIso()+'.csv');
  },
  'cash-in':function(){cashForm('in');},
  'cash-out':function(){cashForm('out');},
  'del-cash':function(id){
    var c=byId(ui.cash&&ui.cash.items,id);
    var d=c?c.stockDelta:0;
    confirmForm('Eliminar movimiento','Se borra este movimiento de la caja.'+(d<0?' Como era una compra de mercadería, también se resta del stock lo que se había sumado.':'')+' Esta acción no se puede deshacer.','Eliminar',async function(){
      await api('/cash/'+id,{method:'DELETE'});await reload();toast('Movimiento eliminado');
    });
  },
  'cash-close':async function(){
    var v=$('#close-counted').value,note=$('#close-note').value;
    if(v===''){toast('Escribí cuánto efectivo contaste',true);return;}
    var r=await api('/cash/closings',{body:{counted:v,note:note}});
    await refreshView();
    toast(r.difference===0?'Caja cerrada: sin diferencias':'Caja cerrada con una diferencia de '+money(r.difference),r.difference!==0);
  },
  // Reportes
  rep:function(id,b){ui.rep=b.dataset.v;ui.rfrom='';ui.rto='';return refreshView();},
  'rep-export':function(){
    var p=ui.rep_p;if(!p)return;
    return downloadFile('/reports/sales-export?from='+p.from+'&to='+p.to,'ventas-'+p.from+'_a_'+p.to+'.csv');
  },
  // Copias de seguridad
  'backup-download':function(){return downloadExport();},
  'backup-now':async function(){await api('/backups',{body:{}});await reload();toast('Copia creada');},
  'pick-file':function(){var f=$('#bfile');if(f)f.click();},
  restore:async function(id,btn){
    var b=byId(ui.backups,id);if(!b)return;
    var label=btn.textContent;btn.disabled=true;btn.classList.add('busy');btn.textContent='Cargando…';
    try{
      var cur=(await api('/backups/current')).counts;
      restoreConfirm('“'+b.label+'” del '+fmtTs(b.createdAt),b.counts||{},cur,async function(empty){
        await api('/backups/'+id+'/restore',{body:{confirmEmpty:empty}});ui.csel=null;ui.cdetail=null;ui.cart=newCart();await reload();toast('Copia restaurada');
      });
    }finally{btn.disabled=false;btn.classList.remove('busy');btn.textContent=label;}
  },
  'del-backup':function(id){
    confirmForm('Eliminar copia','Se borra esta copia guardada en el sistema.','Eliminar',async function(){
      await api('/backups/'+id,{method:'DELETE'});await reload();toast('Copia eliminada');
    });
  },
  // Usuarios
  'new-user':function(){userForm();},
  'edit-user':function(id){userForm(byId(ui.users,id));},
  'change-pass':function(){passwordForm();},
  // Proveedores
  'new-supplier':function(){supplierForm();},
  'edit-supplier':function(id){supplierForm(byId(ui.suppliers,id));},
  'del-supplier':function(id){
    var s=byId(ui.suppliers,id);if(!s)return;
    var extra=s.productCount||s.purchaseCount?' Sus productos y compras no se borran: quedan sin proveedor.':'';
    confirmForm('Eliminar '+esc(s.name),'Se quita este proveedor de la lista.'+extra+' Esta acción no se puede deshacer.','Eliminar',async function(){
      await api('/suppliers/'+id,{method:'DELETE'});await reload();toast('Proveedor eliminado');
    });
  },
  'supplier-view':function(id){supplierDetail(id);},

  logout:async function(){
    try{await api('/logout',{body:{}});}catch(e){}
    S.user=null;ui.cart=newCart();ui.dash=null;ui.sales=null;ui.cash=null;ui.closings=null;ui.rep_m=null;ui.rep_p=null;ui.backups=null;ui.users=null;
    ui.suppliers=null;ui.csel=null;ui.cdetail=null;ui.appts=null;ui.cal={view:'week',anchor:todayIso()};
    main.innerHTML='';
    showLogin();
  }
};

/* ============================================================
   Eventos y arranque
   ============================================================ */
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-action]');
  if(!b||dlg.contains(b))return;
  var fn=actions[b.dataset.action];
  if(!fn)return;
  if(b.dataset.busy)return; // evita el doble clic mientras responde el servidor
  b.dataset.busy='1';
  Promise.resolve().then(function(){return fn(b.dataset.id,b);}).catch(function(err){toast(err.message||'Ocurrió un error',true);}).then(function(){delete b.dataset.busy;});
});
// Menú ⋮ de las filas de Stock: se posiciona con "fixed" (la tabla tiene scroll) y se cierra al hacer clic afuera.
document.addEventListener('toggle',function(e){
  var d=e.target;
  if(d.id==='cfilters'){ui.cfopen=d.open;return;}
  if(!d.classList||!d.classList.contains('rowmenu')||!d.open)return;
  document.querySelectorAll('details.rowmenu[open]').forEach(function(o){if(o!==d)o.open=false;});
  var m=d.querySelector('.menu'),r=d.getBoundingClientRect();
  m.style.top=Math.min(r.bottom+4,window.innerHeight-m.offsetHeight-8)+'px';
  m.style.left=Math.max(8,r.right-m.offsetWidth)+'px';
},true);
document.addEventListener('click',function(e){
  document.querySelectorAll('details.rowmenu[open]').forEach(function(o){if(!o.contains(e.target)||e.target.closest('.menu button'))o.open=false;});
});
window.addEventListener('scroll',function(){document.querySelectorAll('details.rowmenu[open]').forEach(function(o){o.open=false;});},true);
// Lector USB/bluetooth (se comporta como un teclado): un código + Enter en "Vender" lo agrega a la venta;
// en el buscador de Stock abre la venta rápida.
document.addEventListener('keydown',function(e){
  if(e.key!=='Enter'||!e.target)return;
  var id=e.target.id;
  if(id!=='posq'&&id!=='stq')return;
  var code=e.target.value.trim();if(!code)return;
  var x=prodByBarcode(code);
  e.preventDefault();
  if(id==='posq'){
    if(x){addToCart('product',x.id);ui.posq='';e.target.value='';$('#posres').innerHTML=posResults();renderCart();}
    else{var first=$('#posres [data-action="cart-add"]:not([disabled])');if(first)first.click();else toast('No hay ningún producto con el código '+code,true);}
  }else if(x)scanToSell(code);
});
document.addEventListener('input',function(e){
  var id=e.target.id;
  if(id==='posq'){ui.posq=e.target.value;$('#posres').innerHTML=posResults();}
  else if(id==='stq'||id==='cq'){ui[id]=e.target.value;render();var el=$('#'+id);if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}}
  else if(id==='cliq'){ui.cliq=e.target.value;$('#clist').innerHTML=clientListHTML();}
  else if(id==='sq'){ui.sq=e.target.value;$('#srows').innerHTML=supplierRows();}
  else if(id==='cart-dval'){ui.cart.discValue=e.target.value;}
});
document.addEventListener('change',function(e){
  var t=e.target,id=t.id;
  // Carrito: cantidades, precios, descuento, cliente y mascota.
  if(t.classList.contains('cqty')||t.classList.contains('cprice')){
    var it=ui.cart.items[Number(t.dataset.i)];if(!it)return;
    var v=Number(t.value);
    if(t.classList.contains('cqty')){
      if(!(v>0)){toast('La cantidad tiene que ser mayor a cero',true);}
      else it.qty=it.unit==='kg'?r3(v):Math.max(1,Math.round(v));
    }else if(v>=0)it.price=r2(v);
    renderCart();return;
  }
  if(id==='cart-dtype'){ui.cart.discType=t.value;renderCart();return;}
  if(id==='cart-dval'){ui.cart.discValue=t.value;renderCart();return;}
  if(id==='cart-client'){ui.cart.clientId=t.value;var c=clientById(t.value);ui.cart.petId=c&&c.pets.length===1?String(c.pets[0].id):'';renderCart();return;}
  if(id==='cart-pet'){ui.cart.petId=t.value;return;}
  if(id==='stcat'){ui.cat=t.value;render();return;}
  if(id==='sfrom'||id==='sto'||id==='cfrom'||id==='cto'||id==='rfrom'||id==='rto'){
    var k=id[0]==='s'?['sfrom','sto']:id[0]==='c'?['cfrom','cto']:['rfrom','rto'];
    ui[id]=t.value;
    if(ui[k[0]]&&ui[k[1]]&&ui[k[1]]<ui[k[0]]){toast('"Hasta" no puede ser anterior a "Desde"',true);ui[id]='';t.value='';return;}
    if(ui[k[0]]&&ui[k[1]]){if(id[0]==='c')ui.cashp='range';refreshView();}
    else if(id[0]==='c'&&ui.cashp==='range'){ui.cashp='month';refreshView();}
    return;
  }
  if(id==='bfile'&&t.files&&t.files[0]){
    var f=t.files[0],r=new FileReader();
    r.onload=function(){
      var x;
      try{var j=JSON.parse(r.result);x=j.data||j;if(!x||!Array.isArray(x.products)||!Array.isArray(x.sales)||!Array.isArray(x.cash_movements))throw new Error('formato');}
      catch(err){toast('El archivo no es una copia válida de este sistema',true);return;}
      restoreFileForm(x,'el archivo '+f.name).catch(function(err){toast(err.message,true);});
    };
    r.readAsText(f);
    t.value='';
  }
});
$('#loginform').addEventListener('submit',async function(e){
  e.preventDefault();
  var err=$('#lerror'),btn=$('#lbtn');
  if(btn.disabled)return;
  err.textContent='';btn.disabled=true;btn.textContent='Entrando…';
  try{
    await api('/login',{body:{email:$('#lemail').value,password:$('#lpass').value}});
    $('#lpass').value='';
    await start();
  }catch(ex){err.textContent=ex.message;}
  btn.disabled=false;btn.textContent='Entrar';
});
$('#boot-retry').addEventListener('click',function(){
  $('#boot-retry').hidden=true;
  $('#boot-msg').textContent='Iniciando el sistema…';
  $('#boot-sub').textContent='La primera vez del día puede tardar hasta un minuto.';
  boot();
});
/* ============================================================
   Sesión compartida entre pestañas
   La sesión es una cookie: si en otra pestaña se inicia sesión con otro usuario, ésta seguiría mostrando la interfaz del
   anterior. Al volver a la pestaña se vuelve a preguntar quién es el usuario y, si cambió, se avisa de forma clara.
   ============================================================ */
var sessionCheckedAt=0;
function showStaleSession(u){
  document.body.dataset.stale='1';
  if(dlg.open)dlg.close();
  var bar=document.createElement('div');bar.id='sessbar';bar.setAttribute('role','alert');
  bar.innerHTML='<span><b>Tu sesión cambió en otra pestaña</b>'+(u&&u.name?' (ahora figura '+esc(u.name)+(u.role==='admin'?', Administrador':', Ayudante')+')':'')+'. Recargá la página para continuar.</span>'+
    '<button type="button" class="btn primary">Recargar</button>';
  bar.querySelector('button').addEventListener('click',function(){location.reload();});
  document.body.appendChild(bar);
}
async function checkSession(){
  if(!S.user||document.body.dataset.stale||document.body.dataset.state!=='app')return;
  var now=Date.now();if(now-sessionCheckedAt<2000)return;sessionCheckedAt=now;
  try{
    var r=await api('/me'); // si la sesión venció o se cerró en otra pestaña, api() ya muestra el ingreso
    var u=r&&r.user;
    if(u&&S.user&&(u.id!==S.user.id||u.role!==S.user.role))showStaleSession(u);
  }catch(e){/* sin conexión: no se molesta al usuario */}
}
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')checkSession();});
window.addEventListener('focus',checkSession);
boot();
})();
