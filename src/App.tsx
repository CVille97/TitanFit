import { useEffect, useMemo, useState } from "react";
import { exercises, type Exercise } from "./data";
import { activateCloudAccount, confirmCloudWrite, confirmPendingCloudWrites, deactivateCloudAccount, read, write } from "./persistence";

type Section = "inici" | "entrenar" | "progres" | "nutricio" | "mercat" | "gimnasos" | "calendari" | "social" | "perfil";
type Account = { id: string; name: string; email: string };
type WorkoutSet = { kg: number; reps: number; done: boolean };
type Session = { id: string; workoutId?: string; exercise: string; date: string; sets: WorkoutSet[]; duration?: number };
type Listing = { id: string; name: string; price: number; category: string; state: string; location: string; seller: string; description: string; owner: string; status: "Disponible" | "Reservat" | "Venut"; brand?: string; delivery?: string; photo?: string };
type RoutineItem={
  exercise:string;
  exerciseId?:string;
  exerciseName?:string;
  primaryMuscle?:string;
  secondaryMuscles?:string[];
  order?:number;
  sets:number;
  targetReps?:number;
  targetWeight?:number;
  restSeconds?:number;
  reps:number;
  kg:number;
  rest:number;
};
type Routine={
  id:string;
  userId?:string;
  name:string;
  description:string;
  trainingDays?:string[];
  exercises?:RoutineItem[];
  items:RoutineItem[];
  days:string[];
  createdAt:string;
};


function uid() { return crypto.randomUUID(); }
function workoutKey(session:Session){return session.workoutId||session.date||session.id;}
function today() { return new Intl.DateTimeFormat("ca-ES").format(new Date()); }
function estimate1RM(kg: number, reps: number) { if (kg <= 0 || reps <= 0) return 0; return reps <= 10 ? kg * (1 + reps / 30) : kg; }
function normalizeRoutineItem(item:RoutineItem,index:number):RoutineItem {
  const exercise=exercises.find(e=>e.name===item.exercise);
  return {
    ...item,
    exerciseId: item.exerciseId || exercise?.name || item.exercise,
    exerciseName: item.exerciseName || item.exercise,
    primaryMuscle: item.primaryMuscle || exercise?.muscle || "",
    secondaryMuscles: item.secondaryMuscles || (exercise?.secondary ? [exercise.secondary] : []),
    order:index,
    targetReps:item.targetReps || item.reps,
    targetWeight:item.targetWeight || item.kg,
    restSeconds:item.restSeconds || item.rest,
  };
}

export default function App() {
  const [current, setCurrent] = useState<Account | null>(null);
  const [checkingSession,setCheckingSession]=useState(true);
  const [section, setSection] = useState<Section>("inici");
  const [authMode, setAuthMode] = useState<"login" | "register" | "reset">("login");
  const [notice, setNotice] = useState("");
  const [mobilePreview,setMobilePreview]=useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { credentials: "same-origin" })
      .then(async response => {
        if (response.status === 401) {
          deactivateCloudAccount();
          return null;
        }
        if (!response.ok) throw new Error("No s'ha pogut comprovar la sessió.");
        return response.json() as Promise<{user:Account}>;
      })
      .then(async data => {
        if (!data) return;
        await activateCloudAccount(data.user);
        if (!cancelled) setCurrent(data.user);
      })
      .catch(error => {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "No s'ha pogut sincronitzar el compte.");
      })
      .finally(() => { if (!cancelled) setCheckingSession(false); });
    return () => { cancelled = true; };
  },[]);
  function notify(message: string) {
    const show = (value: string) => {
      setNotice(value);
      window.setTimeout(() => setNotice(""), 2600);
    };
    void confirmPendingCloudWrites()
      .then(() => show(message))
      .catch(error => show(error instanceof Error ? `Canvi no confirmat pel servidor: ${error.message}` : "Canvi no confirmat pel servidor."));
  }

  useEffect(() => {
    const handleSyncError = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      notify(`Error de sincronització: ${message}`);
    };
    window.addEventListener("titanfit:sync-error", handleSyncError);
    return () => window.removeEventListener("titanfit:sync-error", handleSyncError);
  }, []);

  async function logout() {
    try {
      await confirmPendingCloudWrites();
      const response = await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("No s'ha pogut tancar la sessió al servidor.");
      deactivateCloudAccount();
      setCurrent(null);
      notify("Sessió tancada.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "No s'ha pogut tancar la sessió.");
    }
  }

  async function authenticate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email")).trim().toLowerCase();
    const password = String(data.get("password") || "");
    const name = String(data.get("name") || "").trim();
    if(authMode==="reset"){
      try{
        const response=await fetch("/api/reset-request",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})});
        const result=await response.json();
        notify(result.message||"Sol·licitud registrada.");
      }catch{notify("No s'ha pogut contactar amb el servidor.");}
      return;
    }
    const endpoint=authMode==="register"?"/api/register":"/api/login";
    try{
      const response=await fetch(endpoint,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,email,password})});
      const result=await response.json();
      if(!response.ok)return notify(result.error||"No s'ha pogut iniciar la sessió.");
      await activateCloudAccount(result.user);
      setCurrent(result.user);
      notify(authMode==="register"?"Compte creat correctament.":`Benvingut, ${result.user.name}.`);
    }catch(error){notify(error instanceof Error?error.message:"No s'ha pogut contactar amb el servidor.");}
  }

  if(checkingSession)return <main className="auth-screen"><div className="auth-card"><h1>Comprovant sessió…</h1></div></main>;

  if (!current) return (
    <main className="auth-screen">
      <div className="auth-brand"><span>T</span><div><strong>TITANFIT</strong><small>ENTRENAMENT · PROGRESSIÓ · MERCAT</small></div></div>
      <form className="auth-card" onSubmit={authenticate}>
        <div className="eyebrow">TITANFIT ACCOUNT</div>
        <h1>{authMode === "register" ? "Crea el teu compte" : authMode === "reset" ? "Recupera l'accés" : "Torna al teu progrés"}</h1>
        {authMode === "register" && <label>Nom<input name="name" placeholder="El teu nom" required /></label>}
        <label>Correu electrònic<input name="email" type="email" placeholder="nom@exemple.cat" required /></label>
        {authMode !== "reset" && <label>Contrasenya<input name="password" type="password" minLength={8} maxLength={256} placeholder="Mínim 8 caràcters" required /></label>}
        <button className="primary" type="submit">{authMode === "register" ? "Crear compte" : authMode === "reset" ? "Enviar sol·licitud" : "Iniciar sessió"}</button>
        <div className="auth-links">
          {authMode !== "login" && <button type="button" onClick={() => setAuthMode("login")}>Tornar a l'inici de sessió</button>}
          {authMode === "login" && <><button type="button" onClick={() => setAuthMode("register")}>Crear compte</button><button type="button" onClick={() => setAuthMode("reset")}>He oblidat la contrasenya</button></>}
        </div>
        <p className="privacy-note">El compte i les dades se sincronitzen amb el servidor de TITANFIT. Les dades locals anteriors s'importen en iniciar sessió.</p>
      </form>
    </main>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setSection("inici")}><span className="brand-icon">T</span><strong>TITANFIT</strong></button>
        <nav>
          <NavButton active={section === "inici"} icon="⌂" label="Inici" onClick={() => setSection("inici")} />
          <NavButton active={section === "entrenar"} icon="◆" label="Entrenar" onClick={() => setSection("entrenar")} />
          <NavButton active={section === "progres"} icon="↗" label="Progrés" onClick={() => setSection("progres")} />
          <NavButton active={section === "nutricio"} icon="◒" label="Nutrició" onClick={() => setSection("nutricio")} />
          <NavButton active={section === "mercat"} icon="▦" label="Mercat" onClick={() => setSection("mercat")} />
          <NavButton active={section === "gimnasos"} icon="⌖" label="Gimnasos" onClick={() => setSection("gimnasos")} />
          <NavButton active={section === "calendari"} icon="□" label="Calendari" onClick={() => setSection("calendari")} />
          <NavButton active={section === "social"} icon="◎" label="Comunitat" onClick={() => setSection("social")} />
        </nav>
        <button className="profile-nav" onClick={() => setSection("perfil")}><span className="avatar">{current.name.slice(0, 1).toUpperCase()}</span><span><strong>{current.name}</strong><small>Perfil privat</small></span></button>
      </aside>
      <main className="main">
        <header className="topbar"><div><small>{today()}</small><strong>{sectionTitle(section)}</strong></div><div className="topbar-actions"><button className="mobile-preview-button" onClick={()=>setMobilePreview(true)}>Vista mòbil</button><button className="icon-btn" title="Tancar sessió" onClick={logout}>↪</button></div></header>
        {section === "inici" && <Dashboard account={current} go={setSection} notify={notify} />}
        {section === "entrenar" && <Training account={current} notify={notify} />}
        {section === "progres" && <Progress account={current} notify={notify} />}
        {section === "nutricio" && <Nutrition account={current} notify={notify} />}
        {section === "mercat" && <Marketplace account={current} notify={notify} />}
        {section === "gimnasos" && <Gyms account={current} notify={notify} />}
        {section === "calendari" && <Calendar account={current} />}
        {section === "social" && <Social account={current} notify={notify} />}
        {section === "perfil" && <Profile account={current} setCurrent={setCurrent} notify={notify} />}
      </main>
      <nav className="mobile-nav">
        {([["inici","⌂","Inici"],["entrenar","◆","Entrenar"],["progres","↗","Progrés"],["mercat","▦","Mercat"],["perfil","●","Perfil"]] as [Section,string,string][]).map(([id,icon,label]) =>
          <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}><span>{icon}</span><small>{label}</small></button>)}
      </nav>
      {mobilePreview&&<div className="mobile-preview-overlay" role="dialog" aria-modal="true" aria-label="Vista prèvia mòbil">
        <div className="mobile-preview-toolbar"><strong>Vista prèvia mòbil · 390 × 844</strong><button onClick={()=>setMobilePreview(false)}>Tornar a l'escriptori</button><button className="mobile-preview-close" onClick={()=>setMobilePreview(false)} aria-label="Tancar vista mòbil">×</button></div>
        <div className="phone-shell"><iframe src={`${window.location.pathname}`} title="TITANFIT mòbil" /></div>
      </div>}
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

function sectionTitle(section: Section) {
  return ({inici:"Bon dia", entrenar:"Entrenament", progres:"Progrés", nutricio:"Nutrició", mercat:"Mercat", gimnasos:"Gimnasos", calendari:"Calendari", social:"Comunitat", perfil:"Perfil"})[section];
}
function NavButton({active, icon, label, onClick}: {active:boolean; icon:string; label:string; onClick:()=>void}) {
  return <button className={active ? "active" : ""} onClick={onClick}><span>{icon}</span>{label}</button>;
}

function Dashboard({account, go, notify}: {account: Account; go:(s:Section)=>void; notify:(s:string)=>void}) {
  const key = `tf_sessions_${account.id}`;
  const sessions = read<Session[]>(key, []);
  const madridNow=new Date(new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Madrid",hour:"numeric",hour12:false}).format());
  const hour=Number(new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Madrid",hour:"numeric",hour12:false}).format(new Date()));
  const greeting=hour<12?"Bon dia":hour<20?"Bona tarda":"Bona nit";
  const volume = sessions.flatMap((s)=>s.sets).filter((s)=>s.done).reduce((sum,s)=>sum+s.kg*s.reps,0);
  const week = new Set(sessions.filter((s)=>{ const d=new Date(s.date); return !Number.isNaN(d.getTime()) && Date.now()-d.getTime()<7*86400000; }).map(workoutKey)).size;
  const plan=read<Record<string,string>>(`tf_calendar_${account.id}`,{});
  const now=new Date();
  const todayKey=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  const todayPlan=plan[todayKey];
  const records=exercises.map(e=>sessions.filter(s=>s.exercise===e.name).flatMap(s=>s.sets).filter(s=>s.done).map(s=>estimate1RM(s.kg,s.reps)));
  const validRecords=records.filter(values=>values.length>0);
  const generalLevel=validRecords.length>=3?Math.round(validRecords.reduce((sum,values)=>sum+Math.max(...values),0)/validRecords.length):0;
  const levelName=generalLevel>=340?"TITAN":generalLevel>=270?"Elite":generalLevel>=210?"Advanced":generalLevel>=160?"Intermediate":generalLevel>=120?"Novice":generalLevel>=90?"Beginner":generalLevel>=60?"Rookie":"Sense dades";
  return <div className="page">
    <section className="hero">
      <div><div className="eyebrow">{greeting} · EUROPA/MADRID</div><h1>Hola, {account.name}</h1><p>{sessions.length?"El teu resum esportiu actual":"Encara no tens entrenaments registrats"}</p></div>
      <div className="level-ring"><strong>{levelName==="Sense dades"?"—":levelName.slice(0,2).toUpperCase()}</strong><span>{levelName}</span></div>
    </section>
    <section className="stats">
      <article><small>Planificació d'avui</small><strong>{todayPlan||"Descans o sense planificar"}</strong><span>{todayPlan?"Segons el teu calendari":"Sense sessió prevista"}</span></article>
      <article><small>Aquesta setmana</small><strong>{week} entrenaments</strong><span>Dades reals registrades</span></article>
      <article><small>Volum completat</small><strong>{Math.round(volume).toLocaleString("ca-ES")} kg</strong><span>{new Set(sessions.map(workoutKey)).size} entrenaments guardats</span></article>
    </section>
    <div className="section-heading"><div><span>ACCIONS RÀPIDES</span><h2>Continua avançant</h2></div></div>
    <section className="quick-grid">
      <Quick icon="◆" title="Començar entrenament" text="Obre una sessió i registra les sèries" onClick={()=>go("entrenar")} />
      <Quick icon="↗" title="Veure el progrés" text="Pesos, rècords i volum" onClick={()=>go("progres")} />
      <Quick icon="◒" title="Planificar nutrició" text="Diari i llista de la compra" onClick={()=>go("nutricio")} />
      <Quick icon="▦" title="Explorar el mercat" text="Compra i venda local" onClick={()=>go("mercat")} />
      <Quick icon="⌖" title="Trobar gimnàs" text="Consulta les opcions disponibles" onClick={()=>go("gimnasos")} />
    </section>
  </div>;
}
function Quick({icon,title,text,onClick}:{icon:string;title:string;text:string;onClick:()=>void}) {
  return <button className="quick-card" onClick={onClick}><span className="quick-icon">{icon}</span><div><strong>{title}</strong><small>{text}</small></div><b>›</b></button>;
}

function Training({account,notify}:{account:Account;notify:(s:string)=>void}) {
  const [tab,setTab]=useState<"rutines"|"crear"|"biblioteca"|"smart">("rutines");
  const [search,setSearch]=useState("");
  const [muscle,setMuscle]=useState("Tots");
  const [equipment,setEquipment]=useState("Tot");
  const [difficulty,setDifficulty]=useState("Tots");
  const [session,setSession]=useState<RoutineItem[]|null>(null);
  const muscles=["Tots",...Array.from(new Set(exercises.map(e=>e.muscle)))];
  const equipments=["Tot",...Array.from(new Set(exercises.map(e=>e.equipment)))];
  const filtered=exercises.filter(e=>(muscle==="Tots"||e.muscle===muscle)&&(equipment==="Tot"||e.equipment===equipment)&&(difficulty==="Tots"||e.level===difficulty)&&`${e.name} ${e.description} ${e.muscle}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="page">
    {session?<WorkoutSession account={account} items={session} onExit={()=>setSession(null)} notify={notify}/>:<>
      <div className="training-entry"><div><span className="eyebrow">ELS MEUS ENTRENAMENTS</span><h1>Els meus entrenaments</h1></div><div className="training-actions"><button className={tab==="rutines"?"primary":""} onClick={()=>setTab("rutines")}>Les meves rutines</button><button className={tab==="crear"?"primary":""} onClick={()=>setTab("crear")}>Crear una rutina</button><button className={tab==="biblioteca"?"secondary":"secondary"} onClick={()=>setTab("biblioteca")}>Biblioteca d'exercicis</button><button className={tab==="smart"?"secondary":"secondary"} onClick={()=>setTab("smart")}>Smart Workout</button></div></div>
      {tab==="biblioteca"?<section className="panel exercise-library"><div className="list-toolbar"><div><span className="eyebrow">BIBLIOTECA TITANFIT</span><h2>{filtered.length} exercicis</h2></div></div><div className="exercise-filters"><input className="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cerca exercicis"/><select value={muscle} onChange={e=>setMuscle(e.target.value)}>{muscles.map(v=><option key={v}>{v}</option>)}</select><select value={equipment} onChange={e=>setEquipment(e.target.value)}>{equipments.map(v=><option key={v}>{v}</option>)}</select><select value={difficulty} onChange={e=>setDifficulty(e.target.value)}>{["Tots","Principiant","Intermedi","Avançat"].map(v=><option key={v}>{v}</option>)}</select></div><div className="exercise-grid">{filtered.map(e=><article className="exercise-card" key={e.name}><span className="exercise-icon">{e.icon}</span><div><strong>{e.name}</strong><small>{e.muscle} · {e.equipment} · {e.level}</small><p>{e.description}</p></div></article>)}</div></section>:tab==="smart"?<SmartWorkout account={account} onStart={items=>{const key=`tf_routine_starts_${account.id}`;write(key,read<number>(key,0)+1);setSession(items);}} notify={notify}/>:<Routines account={account} mode={tab==="crear"?"create":"list"} onModeCreate={()=>setTab("crear")} onModeList={()=>setTab("rutines")} onStart={items=>{const key=`tf_routine_starts_${account.id}`;write(key,read<number>(key,0)+1);setSession(items);}} notify={notify}/>}
    </>}
  </div>;
}

function Routines({account,mode,onModeCreate,onModeList,onStart,notify}:{account:Account;mode:'list'|'create';onModeCreate:()=>void;onModeList:()=>void;onStart:(items:RoutineItem[])=>void;notify:(message:string)=>void}) {
  const [routines,setRoutines]=useState<Routine[]>(()=>read<Routine[]>(`tf_routines_${account.id}`,[]));
  const [editing,setEditing]=useState<Routine|null>(null);
  const [viewing,setViewing]=useState<Routine|null>(null);
  const [selector,setSelector]=useState(false);
  const [name,setName]=useState("");
  const [description,setDescription]=useState("");
  const [days,setDays]=useState<string[]>([]);
  const [items,setItems]=useState<RoutineItem[]>([]);
  const [search,setSearch]=useState("");
  const [category,setCategory]=useState("Pit");
  const [selectedNames,setSelectedNames]=useState<string[]>([]);
  const categories=["Pit","Esquena","Espatlles","Bíceps","Tríceps","Avantbraços","Quàdriceps","Isquiotibials","Glutis","Bessons","Abdominals"];
  const filtered=exercises.filter(e=>e.muscle===category&&e.name.toLowerCase().includes(search.toLowerCase()));
  function openCreate(r?:Routine){if(r){setEditing(r);setName(r.name);setDescription(r.description);setDays(r.days||[]);setItems(r.items);}else{setEditing(null);setName("");setDescription("");setDays([]);setItems([]);}onModeCreate();}
  function toggleDay(d:string){setDays(v=>v.includes(d)?v.filter(x=>x!==d):[...v,d]);}
  function openSelector(){setSelectedNames(items.map(i=>i.exercise));setSelector(true);}
  function confirmSelection(){const next=selectedNames.map(exercise=>items.find(i=>i.exercise===exercise)||{exercise,sets:3,reps:10,kg:0,rest:90});setItems(next);setSelector(false);}
  function moveItem(index:number,direction:-1|1){setItems(v=>{const next=v.map(i=>({...i}));const target=index+direction;if(target<0||target>=next.length)return next;[next[index],next[target]]=[next[target],next[index]];return next;});}
  async function save(){if(!name.trim()){notify("Escriu el nom de la rutina.");return;}if(!items.length){notify("Afegeix almenys un exercici.");return;}const normalizedItems=items.map((item,index)=>normalizeRoutineItem(item,index));const routine:Routine={id:editing?.id||uid(),userId:account.id,name:name.trim(),description:description.trim(),trainingDays:[...days],days:[...days],exercises:normalizedItems,items:normalizedItems,createdAt:editing?.createdAt||new Date().toISOString()};const next=editing?routines.map(r=>r.id===editing.id?routine:r):[...routines,routine];if(!write(`tf_routines_${account.id}`,next)){notify("No s'ha pogut desar la rutina.");return;}try{await confirmCloudWrite(`tf_routines_${account.id}`);}catch(error){notify(error instanceof Error?`No s'ha pogut sincronitzar la rutina: ${error.message}`:"No s'ha pogut sincronitzar la rutina.");return;}setRoutines(next);setEditing(null);setName("");setDescription("");setDays([]);setItems([]);onModeList();notify("Rutina desada al servidor.");}
  async function duplicate(r:Routine){const copy={...r,id:uid(),name:`${r.name} (còpia)`,createdAt:new Date().toISOString(),items:r.items.map(i=>({...i}))};const next=[...routines,copy];if(!write(`tf_routines_${account.id}`,next)){notify("No s'ha pogut duplicar la rutina.");return;}try{await confirmCloudWrite(`tf_routines_${account.id}`);setRoutines(next);notify("Rutina duplicada al servidor.");}catch(error){notify(error instanceof Error?`No s'ha pogut sincronitzar: ${error.message}`:"No s'ha pogut sincronitzar la rutina.");}}
  async function remove(r:Routine){if(!window.confirm(`Eliminar la rutina «${r.name}»?`))return;const next=routines.filter(x=>x.id!==r.id);if(!write(`tf_routines_${account.id}`,next)){notify("No s'ha pogut eliminar la rutina.");return;}try{await confirmCloudWrite(`tf_routines_${account.id}`);setRoutines(next);notify("Rutina eliminada del servidor.");}catch(error){notify(error instanceof Error?`No s'ha pogut sincronitzar: ${error.message}`:"No s'ha pogut sincronitzar l'eliminació.");}}
  if(selector)return <section className="exercise-selector"><div className="selector-heading"><div><span className="eyebrow">AFEGIR EXERCICIS</span><h1>Tria per grup muscular</h1></div><button className="secondary" onClick={()=>setSelector(false)}>Tornar a la rutina</button></div><div className="muscle-category-grid">{categories.map(c=><button key={c} className={category===c?"active":""} onClick={()=>{setCategory(c);setSearch("");}}><span>{exercises.find(e=>e.muscle===c)?.icon||c[0]}</span><strong>{c}</strong></button>)}</div><div className="selector-panel"><div className="list-toolbar"><h2>{category}</h2><input className="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cerca exercicis"/></div><div className="exercise-select-grid">{filtered.map(e=><button key={e.name} className={selectedNames.includes(e.name)?"selected":""} onClick={()=>setSelectedNames(v=>v.includes(e.name)?v.filter(n=>n!==e.name):[...v,e.name])}><span className="exercise-icon">{e.icon}</span><strong>{e.name}</strong><small>Principal: {e.muscle}</small><p>{e.description}</p><small>Secundaris: {e.secondary} · {e.equipment}</small><b>{selectedNames.includes(e.name)?"✓ Seleccionat":"Seleccionar"}</b></button>)}</div></div><div className="selector-footer"><strong>{selectedNames.length} exercicis seleccionats</strong><button className="primary" onClick={confirmSelection}>Afegir {selectedNames.length} exercicis a la rutina</button></div></section>;
  if(viewing)return <section className="routine-view"><div className="view-heading"><button className="secondary" onClick={()=>setViewing(null)}>← Tornar</button><div><span className="eyebrow">DETALL DE LA RUTINA</span><h1>{viewing.name}</h1></div><button className="primary" onClick={()=>onStart(viewing.items)}>Començar</button></div><p>{viewing.description||"Sense descripció"}</p><div className="routine-detail-grid">{viewing.items.map((item,index)=><article className="panel" key={item.exercise}><span>{index+1}</span><div><h3>{item.exercise}</h3><small>{exercises.find(e=>e.name===item.exercise)?.muscle||""}</small></div><strong>{item.sets} × {item.reps}</strong><small>{item.kg} kg · descans {item.rest}s</small></article>)}</div></section>;
  if(mode==="create"||editing)return <section className="routine-builder-page"><div className="routine-form panel"><span className="eyebrow">{editing?"EDITAR RUTINA":"CREAR UNA RUTINA"}</span><h1>{editing?"Modificar rutina":"Nova rutina"}</h1><label>Nom de la rutina<input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Pit i tríceps"/></label><label>Descripció opcional<textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="Objectiu i notes"/></label><fieldset><legend>Dies d'entrenament</legend><div className="day-options">{["Dilluns","Dimarts","Dimecres","Dijous","Divendres","Dissabte","Diumenge"].map(d=><button type="button" key={d} className={days.includes(d)?"active":""} onClick={()=>toggleDay(d)}>{d}</button>)}</div></fieldset><div className="routine-form-exercises"><div className="list-toolbar"><h2>Exercicis</h2><button className="primary" onClick={openSelector}>+ Afegir exercicis</button></div>{items.length?items.map((item,index)=><article className="routine-config-row" key={item.exercise}><b>{index+1}</b><div><strong>{item.exercise}</strong><small>{exercises.find(e=>e.name===item.exercise)?.muscle||""}</small></div><label>Sèries<input type="number" min="1" value={item.sets} onChange={e=>setItems(v=>v.map((x,i)=>i===index?{...x,sets:Number(e.target.value)}:x))}/></label><label>Reps<input type="number" min="1" value={item.reps} onChange={e=>setItems(v=>v.map((x,i)=>i===index?{...x,reps:Number(e.target.value)}:x))}/></label><label>Kg<input type="number" min="0" step="0.5" value={item.kg} onChange={e=>setItems(v=>v.map((x,i)=>i===index?{...x,kg:Number(e.target.value)}:x))}/></label><label>Descans<select value={item.rest} onChange={e=>setItems(v=>v.map((x,i)=>i===index?{...x,rest:Number(e.target.value)}:x))}><option value="60">60 s</option><option value="90">90 s</option><option value="120">120 s</option><option value="150">150 s</option></select></label><div className="routine-order-buttons"><button type="button" className="secondary" disabled={index===0} onClick={()=>moveItem(index,-1)}>Pujar</button><button type="button" className="secondary" disabled={index===items.length-1} onClick={()=>moveItem(index,1)}>Baixar</button></div><button className="danger" onClick={()=>setItems(v=>v.filter((_,i)=>i!==index))}>Eliminar</button></article>):<div className="empty-state"><span>＋</span><h3>Encara no hi ha exercicis</h3><p>Prem “Afegir exercicis” per començar.</p></div>}</div><div className="form-actions"><button className="secondary" onClick={()=>onModeList()}>Cancel·lar</button><button className="primary" onClick={save}>Guardar rutina</button></div></div></section>;
  return <section className="routines-home"><div className="routines-toolbar"><div><span className="eyebrow">RUTINES GUARDADES</span><h2>{routines.length?"Les teves rutines":"Encara no tens cap rutina creada"}</h2></div>{routines.length>0&&<button className="primary" onClick={()=>openCreate()}>+ Crear una rutina</button>}</div>{routines.length?routines.map(r=><article className="panel saved-routine-card" key={r.id}><div className="saved-routine-main"><span className="routine-mark">◆</span><div><h3>{r.name}</h3><small>{r.items.length} exercicis · {r.items.reduce((n,i)=>n+i.sets,0)} sèries · aprox. {Math.max(15,Math.round(r.items.length*7+r.items.reduce((n,i)=>n+i.sets*i.rest/60,0)))} min</small><p>{Array.from(new Set(r.items.map(i=>exercises.find(e=>e.name===i.exercise)?.muscle).filter(Boolean))).join(" · ")||"Grups no especificats"}</p></div></div><div className="saved-routine-footer"><small>Creada el {new Intl.DateTimeFormat("ca-ES").format(new Date(r.createdAt))}</small><div><button className="secondary" onClick={()=>setViewing(r)}>Veure rutina</button><button className="primary" onClick={()=>onStart(r.items)}>Començar</button><button className="secondary" onClick={()=>openCreate(r)}>Editar</button><button className="danger" onClick={()=>duplicate(r)}>Duplicar</button><button className="danger" onClick={()=>remove(r)}>Eliminar</button></div></div></article>):<div className="empty-routines panel"><span>◆</span><h2>Encara no tens cap rutina creada</h2><p>Crea la teva primera rutina i organitza els teus entrenaments.</p><button className="primary" onClick={()=>openCreate()}>Crear la primera rutina</button></div>}</section>;
}

function SmartWorkout({account,onStart,notify}:{account:Account;onStart:(items:RoutineItem[])=>void;notify:(message:string)=>void}) {
  const [objective,setObjective]=useState("Hipertrofia");
  const [level,setLevel]=useState("Intermedi");
  const [days,setDays]=useState("3");
  const [minutes,setMinutes]=useState("45");
  const [preference,setPreference]=useState("Sense preferències");
  const [groups,setGroups]=useState<string[]>([]);
  const [equipment,setEquipment]=useState<string[]>(["Combinació"]);
  const [weekly,setWeekly]=useState<{day:string;title:string;items:RoutineItem[];rest:boolean}[]>([]);
  const [modifyDay,setModifyDay]=useState<number|null>(null);
  const muscleNames=["Pit","Esquena","Espatlles","Bíceps","Tríceps","Quàdriceps","Isquiotibials","Glutis","Abdominals"];
  const equipmentNames=["Màquines","Manuelles","Barres","Polees","Pes corporal","Combinació"];
  function matchingEquipment(e:Exercise){
    if(equipment.includes("Combinació")) return true;
    return (equipment.includes("Màquines")&&e.equipment==="Màquina")||(equipment.includes("Manuelles")&&e.equipment==="Manuelles")||(equipment.includes("Barres")&&e.equipment==="Barra")||(equipment.includes("Polees")&&e.equipment==="Polea")||(equipment.includes("Pes corporal")&&e.equipment==="Pes corporal");
  }
  function generate(){
    const names=["Dilluns","Dimarts","Dimecres","Dijous","Divendres","Dissabte","Diumenge"];
    const count=Number(days);
    let chosen:number[]=[0,2,4];
    if(count===2) chosen=[0,3];
    if(count===4) chosen=[0,1,3,5];
    if(count===5) chosen=[0,1,3,4,5];
    if(count===6) chosen=[0,1,2,3,4,5];
    const upper=["Pit","Tríceps","Esquena","Bíceps","Espatlles"];
    const lower=["Quàdriceps","Isquiotibials","Glutis","Bessons","Abdominals"];
    const split=[
      ["Pit","Tríceps"],["Esquena","Bíceps"],["Quàdriceps","Glutis","Bessons"],["Espatlles","Abdominals"],["Pit","Esquena"],["Quàdriceps","Isquiotibials","Glutis"],["Pit","Tríceps"]
    ];
    const result=names.map((day,index)=>{
      if(!chosen.includes(index))return {day,title:"Descans",items:[],rest:true};
      let target: string[];
      if(preference==="Tren superior") target=index%2===0?["Pit","Tríceps"]:["Esquena","Bíceps","Espatlles"];
      else if(preference==="Tren inferior") target=index%2===0?["Quàdriceps","Glutis"]:["Isquiotibials","Bessons","Abdominals"];
      else if(preference==="Tot el cos") target=["Pit","Esquena","Quàdriceps","Glutis","Abdominals"];
      else if(preference==="Grups musculars concretos"&&groups.length) target=[...groups];
      else target=split[index%split.length];
      if(groups.length&&preference==="Sense preferències") target=[...groups];
      const unique=Array.from(new Set(target));
      const items:RoutineItem[]=[];
      unique.forEach((muscle,mIndex)=>{
        const pool=exercises.filter(e=>e.muscle===muscle&&matchingEquipment(e));
        const source=pool;
        const base=level==="Principiant"?2:level==="Intermedi"?3:4;
        const countPerMuscle=Number(minutes)<=30?1:2;
        source.slice(mIndex%Math.max(1,source.length),mIndex%Math.max(1,source.length)+countPerMuscle).forEach((e,part)=>{
          items.push({exercise:e.name,sets:objective==="Força"?level==="Avançat"?5:4:objective==="Resistència"?3:level==="Principiant"?base:base,reps:objective==="Força"?5:objective==="Resistència"?15:objective==="Condicionament general"?12:level==="Principiant"?12:10,kg:0,rest:objective==="Força"?120:objective==="Resistència"?60:90});
        });
      });
      const title=unique.length<=2?unique.join(" i "):"Cos complet";
      return {day,title,items:items.slice(0,Number(minutes)<=30?3:Number(minutes)<=45?5:Number(minutes)<=60?6:8),rest:false};
    });
    setWeekly(result);setModifyDay(null);
  }
  async function save(){
    if(!weekly.length)return notify("Genera una setmana abans de guardar.");
    const routines=read<Routine[]>(`tf_routines_${account.id}`,[]);
    const next=[...routines];
    weekly.filter(d=>!d.rest).forEach(d=>{const normalized=d.items.map((item,index)=>normalizeRoutineItem(item,index));next.push({id:uid(),userId:account.id,name:`${d.day} — ${d.title}`,description:`Smart Workout · ${objective} · ${level} · ${minutes} min`,trainingDays:[d.day],days:[d.day],exercises:normalized,items:normalized,createdAt:new Date().toISOString()});});
    if(!write(`tf_routines_${account.id}`,next)){notify("No s'ha pogut desar la planificació. Comprova l'emmagatzematge.");return;}
    try{await confirmCloudWrite(`tf_routines_${account.id}`);notify("Setmana desada al servidor i a Les meves rutines.");}
    catch(error){notify(error instanceof Error?`No s'ha pogut sincronitzar la planificació: ${error.message}`:"No s'ha pogut sincronitzar la planificació.");}
  }
  function replaceExercise(dayIndex:number,itemIndex:number){const day=weekly[dayIndex];if(!day)return;const alternatives=exercises.filter(e=>e.muscle===exercises.find(x=>x.name===day.items[itemIndex].exercise)?.muscle&&matchingEquipment(e));if(!alternatives.length)return notify("No hi ha alternatives compatibles amb el material seleccionat.");const current=day.items[itemIndex].exercise;const index=alternatives.findIndex(e=>e.name===current);const next=alternatives[(index+1)%alternatives.length];setWeekly(v=>v.map((d,i)=>i===dayIndex?{...d,items:d.items.map((x,j)=>j===itemIndex?{...x,exercise:next.name}:x)}:d));notify(`Exercici substituït per ${next.name}.`);}
  function toggleGroup(g:string){setGroups(v=>v.includes(g)?v.filter(x=>x!==g):[...v,g]);}
  function toggleEquipment(e:string){setEquipment(v=>e==="Combinació"?["Combinació"]:v.includes(e)?v.filter(x=>x!==e):[...v.filter(x=>x!="Combinació"),e]);}
  return <section className="smart-week"><div className="panel smart-form"><span className="eyebrow">PLANIFICACIÓ SETMANAL</span><h1>Smart Workout</h1><div className="smart-grid"><label>Objectiu<select value={objective} onChange={e=>setObjective(e.target.value)}><option>Hipertrofia</option><option>Força</option><option>Resistència</option><option>Condicionament general</option></select></label><label>Experiència<select value={level} onChange={e=>setLevel(e.target.value)}><option>Principiant</option><option>Intermedi</option><option>Avançat</option></select></label><label>Dies disponibles<select value={days} onChange={e=>setDays(e.target.value)}>  {[2,3,4,5,6].map(d=><option key={d} value={d}>{d} dies</option>)}</select></label><label>Temps per sessió<select value={minutes} onChange={e=>setMinutes(e.target.value)}>  {[30,45,60,75,90].map(m=><option key={m} value={m}>{m} minuts</option>)}</select></label><label>Preferència<select value={preference} onChange={e=>setPreference(e.target.value)}><option>Sense preferències</option><option>Tren superior</option><option>Tren inferior</option><option>Tot el cos</option><option>Grups musculars concretos</option></select></label></div><fieldset><legend>Grups musculars</legend><div className="muscle-options">{muscleNames.map(m=><button type="button" key={m} className={groups.includes(m)?"active":""} onClick={()=>toggleGroup(m)}>{m}</button>)}</div></fieldset><fieldset><legend>Material disponible</legend><div className="muscle-options">{equipmentNames.map(e=><button type="button" key={e} className={equipment.includes(e)?"active":""} onClick={()=>toggleEquipment(e)}>{e}</button>)}</div></fieldset><button className="primary" onClick={generate}>Generar la meva rutina</button></div>{weekly.length>0&&<div className="week-preview"><div className="list-toolbar"><div><span className="eyebrow">SETMANA PERSONALITZADA</span><h2>De dilluns a diumenge</h2></div><div className="smart-actions"><button className="secondary" onClick={generate}>Regenerar rutina</button><button className="primary" onClick={save}>Guardar rutina</button></div></div><div className="week-grid">{weekly.map((d,dayIndex)=><article className={d.rest?"panel rest-day":"panel training-day"} key={d.day}><span>{d.day}</span><h3>{d.title}</h3>{d.rest?<p>Descans</p>:<>{d.items.map((i,index)=><div className="week-exercise" key={i.exercise}><b>{index+1}</b><strong>{i.exercise}</strong><small>{i.sets} × {i.reps} · {i.rest}s descans</small>{modifyDay===dayIndex&&<button className="secondary week-modify" onClick={()=>replaceExercise(dayIndex,index)}>Modificar exercici</button>}</div>)}<button className="secondary full week-modify-toggle" onClick={()=>setModifyDay(modifyDay===dayIndex?null:dayIndex)}>Modificar exercicis</button><button className="primary full" onClick={()=>onStart(d.items)}>Començar entrenament</button></>}</article>)}</div></div>}</section>;
}

function WorkoutSession({account,items,onExit,notify}:{account:Account;items:RoutineItem[];onExit:()=>void;notify:(message:string)=>void}) {
  const [current,setCurrent]=useState(0);
  const [sets,setSets]=useState<Record<string,WorkoutSet[]>>(()=>Object.fromEntries(items.map(i=>[i.exercise,Array.from({length:i.sets},()=>({kg:i.kg,reps:i.reps,done:false}))])));
  const [seconds,setSeconds]=useState(0);
  const [running,setRunning]=useState(false);
  const [summary,setSummary]=useState<{volume:number;sets:number;duration:number}|null>(null);
  const started=useMemo(()=>Date.now(),[]);
  useEffect(()=>{if(!running)return;const id=window.setInterval(()=>setSeconds(s=>{if(s<=1){setRunning(false);notify("Descans finalitzat.");return 0;}return s-1;}),1000);return()=>window.clearInterval(id);},[running,notify]);
  const item=items[current];
  if(!item)return null;
  const rows=sets[item.exercise]||[];
  function complete(index:number){setSets(v=>({...v,[item.exercise]:v[item.exercise].map((x,i)=>i===index?{...x,done:true}:x)}));setSeconds(item.rest);setRunning(true);}
  async function finish(){const hasCompleted=items.some(i=>(sets[i.exercise]||[]).some(s=>s.done&&s.kg>=0&&s.reps>0));if(!hasCompleted){notify("Completa almenys una sèrie abans de finalitzar.");return;}const existing=read<Session[]>(`tf_sessions_${account.id}`,[]);const date=new Date().toISOString();const workoutId=uid();const duration=Math.max(1,Math.round((Date.now()-started)/60000));const sessions:Session[]=[];items.forEach(i=>{const valid=(sets[i.exercise]||[]).filter(s=>s.done&&s.kg>=0&&s.reps>0);if(valid.length)sessions.push({id:uid(),workoutId,exercise:i.exercise,date,sets:valid,duration});});const next=[...existing,...sessions];if(!write(`tf_sessions_${account.id}`,next)){notify("No s'ha pogut desar l'entrenament.");return;}try{await confirmCloudWrite(`tf_sessions_${account.id}`);}catch(error){notify(error instanceof Error?`L'entrenament no s'ha pogut sincronitzar: ${error.message}`:"No s'ha pogut sincronitzar l'entrenament.");return;}const volume=sessions.flatMap(s=>s.sets).reduce((n,s)=>n+s.kg*s.reps,0);const count=sessions.flatMap(s=>s.sets).length;setSummary({volume,sets:count,duration});notify("Entrenament desat al servidor.");}
  if(summary)return <section className="panel workout-summary"><span className="eyebrow">ENTRENAMENT FINALITZAT</span><h1>Bon treball</h1><div className="stats"><article><small>Durada</small><strong>{summary.duration} min</strong></article><article><small>Sèries</small><strong>{summary.sets}</strong></article><article><small>Volum</small><strong>{Math.round(summary.volume)} kg</strong></article></div><button className="primary" onClick={onExit}>Tornar a Entrenar</button></section>;
  return <section className="workout-layout"><div className="panel workout-main"><div className="workout-heading"><div><small>EXERCICI {current+1} DE {items.length}</small><h2>{item.exercise}</h2></div><span>{item.sets} sèries · descans {item.rest}s</span></div>{rows.map((set,index)=><div className={`set-row ${set.done?"done":""}`} key={index}><b>{index+1}</b><label><input type="number" min="0" step="0.5" value={set.kg} onChange={e=>setSets(v=>({...v,[item.exercise]:v[item.exercise].map((x,i)=>i===index?{...x,kg:Number(e.target.value)}:x)}))}/><small>kg</small></label><label><input type="number" min="1" value={set.reps} onChange={e=>setSets(v=>({...v,[item.exercise]:v[item.exercise].map((x,i)=>i===index?{...x,reps:Number(e.target.value)}:x)}))}/><small>reps</small></label><button className={set.done?"complete done":"complete"} onClick={()=>complete(index)}>{set.done?"✓":"Completar"}</button></div>)}</div><aside className="panel timer-panel"><small>DESCANS</small><div className={`timer ${running?"running":""}`}>{seconds?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`:"—"}</div><button className="secondary full" onClick={()=>{setRunning(!running);if(!running&&seconds===0)setSeconds(item.rest);}}>{running?"Aturar":"Iniciar descans"}</button></aside><div className="workout-actions"><button className="secondary" disabled={current===0} onClick={()=>setCurrent(v=>v-1)}>Exercici anterior</button>{current<items.length-1?<button className="primary" onClick={()=>setCurrent(v=>v+1)}>Següent exercici</button>:<button className="primary" onClick={finish}>Finalitzar entrenament</button>}</div></section>;
}

function Progress({account,notify}:{account:Account;notify:(message:string)=>void}) {
  type Weight={id:string;date:string;weight:number};
  type Measures={id:string;date:string;waist:string;chest:string;arm:string;thigh:string;calves:string};
  const [weights,setWeights]=useState<Weight[]>(()=>read(`tf_weights_${account.id}`,[]));
  const [measures,setMeasures]=useState<Measures[]>(()=>read(`tf_measures_${account.id}`,[]));
  const [weight,setWeight]=useState("");
  const [weightDate,setWeightDate]=useState(new Date().toISOString().slice(0,10));
  const [editingWeight,setEditingWeight]=useState<Weight|null>(null);
  const [editingMeasure,setEditingMeasure]=useState<Measures|null>(null);
  async function saveWeight(e:React.FormEvent){e.preventDefault();const value=Number(weight);if(!Number.isFinite(value)||value<20||value>400){notify("Introdueix un pes vàlid entre 20 i 400 kg.");return;}if(!weightDate){notify("Selecciona la data del pes.");return;}const entry={id:editingWeight?.id||uid(),date:new Date(`${weightDate}T12:00:00`).toISOString(),weight:value};const key=`tf_weights_${account.id}`;const next=editingWeight?weights.map(w=>w.id===entry.id?entry:w):[...weights,entry];if(!write(key,next)){notify("No s'ha pogut desar el pes.");return;}try{await confirmCloudWrite(key);}catch(error){notify(error instanceof Error?`No s'ha pogut sincronitzar el pes: ${error.message}`:"No s'ha pogut sincronitzar el pes.");return;}setWeights(next);const profileKey=`tf_profile_${account.id}`;const profile=read<any>(profileKey,{});write(profileKey,{...profile,weight:String(value)});setWeight("");setWeightDate(new Date().toISOString().slice(0,10));setEditingWeight(null);notify("Pes desat al servidor.");}
  async function saveMeasures(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;const d=new FormData(form);const entry:Measures={id:editingMeasure?.id||uid(),date:String(d.get("date")),waist:String(d.get("waist")||""),chest:String(d.get("chest")||""),arm:String(d.get("arm")||""),thigh:String(d.get("thigh")||""),calves:String(d.get("calves")||"")};if(!entry.waist&&!entry.chest&&!entry.arm&&!entry.thigh&&!entry.calves){notify("Introdueix almenys una mesura.");return;}const key=`tf_measures_${account.id}`;const next=editingMeasure?measures.map(m=>m.id===entry.id?entry:m):[...measures,entry];if(!write(key,next)){notify("No s'han pogut desar les mesures.");return;}try{await confirmCloudWrite(key);}catch(error){notify(error instanceof Error?`No s'han pogut sincronitzar les mesures: ${error.message}`:"No s'han pogut sincronitzar les mesures.");return;}setMeasures(next);setEditingMeasure(null);form.reset();notify("Mesures desades al servidor.");}
  async function removeWeight(w:Weight){if(!window.confirm("Eliminar aquest pes?"))return;const key=`tf_weights_${account.id}`;const next=weights.filter(x=>x.id!==w.id);if(!write(key,next))return;try{await confirmCloudWrite(key);setWeights(next);notify("Pes eliminat del servidor.");}catch(error){notify(error instanceof Error?`No s'ha pogut sincronitzar: ${error.message}`:"No s'ha pogut sincronitzar l'eliminació.");}}
  async function removeMeasures(m:Measures){if(!window.confirm("Eliminar aquestes mesures?"))return;const key=`tf_measures_${account.id}`;const next=measures.filter(x=>x.id!==m.id);if(!write(key,next))return;try{await confirmCloudWrite(key);setMeasures(next);notify("Mesures eliminades del servidor.");}catch(error){notify(error instanceof Error?`No s'ha pogut sincronitzar: ${error.message}`:"No s'ha pogut sincronitzar l'eliminació.");}}
  const chart=weights.slice().sort((a,b)=>new Date(a.date).getTime()-new Date(b.date).getTime()).slice(-12);
  return <div className="page"><div className="section-heading"><div><span>EL MEU PROGRÉS</span><h1>El meu progrés</h1></div></div><section className="simple-progress"><div className="panel progress-form"><span className="eyebrow">PES CORPORAL</span><h2>{editingWeight?"Editar pes":"Pes actual"}</h2><form onSubmit={saveWeight}><label>Pes en kg<input type="number" step="0.1" min="20" max="400" value={weight} onChange={e=>setWeight(e.target.value)} placeholder="70.0"/></label><label>Data del registre<input type="date" value={weightDate} onChange={e=>setWeightDate(e.target.value)} required/></label>{editingWeight&&<button type="button" className="secondary" onClick={()=>{setEditingWeight(null);setWeight("");setWeightDate(new Date().toISOString().slice(0,10));}}>Cancel·lar edició</button>}<button className="primary" type="submit">Guardar pes</button></form></div><div className="panel progress-form"><span className="eyebrow">MESURES CORPORALS</span><h2>Mesures en cm</h2>  <form onSubmit={saveMeasures}><label>Data<input name="date" type="date" defaultValue={editingMeasure?.date.slice(0,10)||new Date().toISOString().slice(0,10)} required/></label><div className="measure-grid"><label>Cintura<input name="waist" type="number" min="1" defaultValue={editingMeasure?.waist||""}/></label><label>Pit<input name="chest" type="number" min="1" defaultValue={editingMeasure?.chest||""}/></label><label>Braç<input name="arm" type="number" min="1" defaultValue={editingMeasure?.arm||""}/></label><label>Cuixa<input name="thigh" type="number" min="1" defaultValue={editingMeasure?.thigh||""}/></label><label>Bessons<input name="calves" type="number" min="1" defaultValue={editingMeasure?.calves||""}/></label></div>{editingMeasure&&<button type="button" className="secondary" onClick={()=>setEditingMeasure(null)}>Cancel·lar edició</button>}<button className="primary" type="submit">{editingMeasure?"Guardar canvis":"Guardar mesures"}</button></form></div></section><section className="progress-history panel"><div className="panel-title"><h2>Historial</h2></div>{weights.length===0&&measures.length===0?<div className="empty-state"><span>↗</span><h3>Encara no tens registres</h3><p>Afegeix el teu primer pes per començar l'evolució.</p></div>:<><div className="history-list">{weights.slice().reverse().map(w=><div className="history-row" key={w.id}><div><strong>{w.weight} kg</strong><small>{new Intl.DateTimeFormat("ca-ES",{dateStyle:"medium"}).format(new Date(w.date))}</small></div><div>  <button className="secondary" onClick={()=>{setEditingWeight(w);setWeight(String(w.weight));setWeightDate(w.date.slice(0,10));}}>Editar</button><button className="danger" onClick={()=>removeWeight(w)}>Eliminar</button></div></div>)}{measures.slice().reverse().map(m=><div className="history-row" key={m.id}><div><strong>Mesures corporals</strong><small>{new Intl.DateTimeFormat("ca-ES",{dateStyle:"medium"}).format(new Date(m.date))} · Cintura {m.waist||"—"} cm · Pit {m.chest||"—"} cm · Braç {m.arm||"—"} cm · Cuixa {m.thigh||"—"} cm · Bessons {m.calves||"—"} cm</small></div>  <div><button className="secondary" onClick={()=>setEditingMeasure(m)}>Editar</button><button className="danger" onClick={()=>removeMeasures(m)}>Eliminar</button></div></div>)}</div>{chart.length>=2&&<div className="weight-chart"><div className="chart-head"><span className="eyebrow">EVOLUCIÓ DEL PES</span></div><div className="bar-chart">{chart.map(w=>{const max=Math.max(...chart.map(x=>x.weight));const min=Math.min(...chart.map(x=>x.weight));const h=max===min?50:Math.max(12,Math.round((w.weight-min)/(max-min)*80+20));return <div key={w.id}><i style={{height:`${h}%`}}/><small>{new Intl.DateTimeFormat("ca-ES",{day:"numeric",month:"numeric"}).format(new Date(w.date))}</small></div>;})}</div></div>}</>}</section></div>;
}

function Nutrition({account,notify}:{account:Account;notify:(s:string)=>void}) {
  const [items,setItems]=useState<{id?:string;date?:string;name:string;grams:number;cal:number;protein:number;carbs:number;fat:number}[]>(()=>read(`tf_food_${account.id}`,[]));
  useEffect(()=>{const reload=()=>setItems(read(`tf_food_${account.id}`,[]));window.addEventListener("titanfit:nutrition-updated",reload);return()=>window.removeEventListener("titanfit:nutrition-updated",reload);},[account.id]);
  const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};
  const [selectedDate,setSelectedDate]=useState(localDate);
  const [tab,setTab]=useState<"diari"|"receptes"|"llista">("diari");
  const dailyItems=items.filter(item=>item.date===selectedDate||(!item.date&&selectedDate===localDate()));
  const total=dailyItems.reduce((n,i)=>n+i.cal*i.grams/100,0);
  const protein=dailyItems.reduce((n,i)=>n+i.protein*i.grams/100,0);
  const carbs=dailyItems.reduce((n,i)=>n+(i.carbs||0)*i.grams/100,0);
  const fat=dailyItems.reduce((n,i)=>n+(i.fat||0)*i.grams/100,0);
  function add(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const d=new FormData(e.currentTarget);const next=[...items,{id:uid(),date:selectedDate,name:String(d.get("name")),grams:Number(d.get("grams")),cal:Number(d.get("cal")),protein:Number(d.get("protein")),carbs:Number(d.get("carbs")||0),fat:Number(d.get("fat")||0)}];setItems(next);write(`tf_food_${account.id}`,next);e.currentTarget.reset();notify("Aliment afegit al diari.");}
  return <div className="page"><div className="tabs"><button className={tab==="diari"?"active":""} onClick={()=>setTab("diari")}>Diari d'alimentació</button><button className={tab==="receptes"?"active":""} onClick={()=>setTab("receptes")}>Receptes</button><button className={tab==="llista"?"active":""} onClick={()=>setTab("llista")}>Llista de la compra</button></div>
    {tab==="diari"?<> <label className="nutrition-date">Data del diari<input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)}/></label><section className="stats nutrition-stats"><article><small>Calories</small><strong>{Math.round(total)} kcal</strong></article><article><small>Proteïnes</small><strong>{Math.round(protein)} g</strong></article><article><small>Hidrats / Greixos</small><strong>{Math.round(carbs)} g / {Math.round(fat)} g</strong></article></section><section className="nutrition-layout"><form className="panel" onSubmit={add}><span className="eyebrow">AFEGIR ALIMENT</span><h3>Registre manual</h3><label>Aliment<input name="name" required placeholder="Nom"/></label><label>Quantitat (g)<input name="grams" type="number" min="1" required defaultValue="100"/></label><label>Calories per 100 g<input name="cal" type="number" min="0" required/></label><label>Proteïna per 100 g<input name="protein" type="number" min="0" required/></label><label>Hidrats per 100 g<input name="carbs" type="number" min="0" defaultValue="0"/></label><label>Greixos per 100 g<input name="fat" type="number" min="0" defaultValue="0"/></label><button className="primary" type="submit">Afegir al diari</button></form><div className="panel"><div className="panel-title"><h3>Aliments registrats</h3></div>{dailyItems.length?dailyItems.map((item,i)=><div className="food-row" key={item.id||i}><b>{item.name}</b><button className="danger" onClick={()=>{const next=items.filter(entry=>entry!==item);setItems(next);write(`tf_food_${account.id}`,next);}}>Eliminar</button><strong>{Math.round(item.cal*item.grams/100)} kcal</strong></div>):<div className="empty-state"><span>◒</span><h3>El teu diari està buit</h3><p>Afegeix aliments per calcular el resum nutricional.</p></div>}</div></section></>:tab==="receptes"?    <Recipes account={account} notify={notify} date={selectedDate}/>:<ShoppingList account={account}/>}
  </div>;
}
function Recipes({account,notify,date}:{account:Account;notify:(message:string)=>void;date:string}){
  const recipes=[
    {name:"Civada amb plàtan i iogurt",type:"Esmorzar",time:"5 min",items:["Civada","Plàtan","Iogurt natural"],prep:"Barreja tots els ingredients i deixa reposar.",cal:420,p:18,c:68,f:8},
    {name:"Torrades integrals amb gall dindi",type:"Esmorzar",time:"8 min",items:["Pa integral","Gall dindi","Tomàquet"],prep:"Tosta el pa i cobreix amb gall dindi i tomàquet.",cal:390,p:28,c:48,f:9},
    {name:"Ous remenats amb pa integral",type:"Esmorzar",time:"10 min",items:["Ous","Pa integral","Espinacs"],prep:"Remena els ous amb espinacs i serveix amb pa.",cal:410,p:26,c:40,f:14},
    {name:"Iogurt grec amb fruita i fruits secs",type:"Esmorzar",time:"5 min",items:["Iogurt grec","Fruita","Fruits secs"],prep:"Serveix el iogurt amb fruita i fruits secs.",cal:360,p:22,c:38,f:12},
    {name:"Porridge de civada",type:"Esmorzar",time:"10 min",items:["Civada","Llet","Canella"],prep:"Cuina la civada amb llet i acabament de canella.",cal:330,p:14,c:52,f:7},
    {name:"Batut de plàtan i civada",type:"Esmorzar",time:"5 min",items:["Plàtan","Civada","Llet"],prep:"Tritura tots els ingredients fins a obtenir una textura suau.",cal:380,p:16,c:64,f:6},
    {name:"Pollastre amb arròs i verdures",type:"Dinar",time:"30 min",items:["Pollastre","Arròs","Verdures"],prep:"Cuina els tres ingredients i combina al plat.",cal:520,p:44,c:70,f:8},
    {name:"Pasta amb tonyina",type:"Dinar",time:"20 min",items:["Pasta integral","Tonyina","Tomàquet"],prep:"Cuina la pasta i barreja amb tonyina i tomàquet.",cal:560,p:38,c:82,f:11},
    {name:"Salmó amb patata",type:"Dinar",time:"35 min",items:["Salmó","Patata","Verdures"],prep:"Enforna el salmó i les patates; acompanya amb verdures.",cal:610,p:42,c:58,f:24},
    {name:"Vedella amb arròs",type:"Dinar",time:"35 min",items:["Vedella magra","Arròs","Pebrot"],prep:"Saltura la vedella i barreja amb arròs i pebrot.",cal:590,p:46,c:70,f:16},
    {name:"Amanida de llegums amb tonyina",type:"Dinar",time:"15 min",items:["Cigrons","Tonyina","Enciam","Oliva"],prep:"Barreja tots els ingredients i adoba lleugerament.",cal:480,p:36,c:44,f:18},
    {name:"Llenties amb verdures",type:"Dinar",time:"40 min",items:["Llenties","Pastanaga","Ceba","Espinacs"],prep:"Cuina les llenties amb les verdures fins que estiguin tendres.",cal:430,p:28,c:68,f:4},
    {name:"Iogurt amb fruita",type:"Berenar",time:"3 min",items:["Iogurt natural","Fruita"],prep:"Serveix el iogurt amb la fruita tallada.",cal:180,p:10,c:28,f:3},
    {name:"Entrepà integral de gall dindi",type:"Berenar",time:"5 min",items:["Pa integral","Gall dindi","Enciam"],prep:"Muntem l'entrepà i serveix fresc.",cal:300,p:24,c:34,f:7},
    {name:"Torrades amb crema de cacauet",type:"Berenar",time:"5 min",items:["Pa integral","Crema de cacauet"],prep:"Tosta el pa i cobreix amb crema de cacauet.",cal:340,p:12,c:38,f:18},
    {name:"Batut de fruita i llet",type:"Berenar",time:"5 min",items:["Fruita","Llet","Flocs d'avena"],prep:"Tritura tots els ingredients.",cal:260,p:12,c:44,f:5},
    {name:"Formatge fresc amb fruita",type:"Berenar",time:"3 min",items:["Formatge fresc","Fruita"],prep:"Serveix el formatge fresc amb fruita.",cal:220,p:18,c:20,f:8},
    {name:"Hummus amb pastanaga",type:"Berenar",time:"5 min",items:["Hummus","Pastanaga"],prep:"Talla la pastanaga i acompanya amb hummus.",cal:240,p:8,c:26,f:12},
    {name:"Truita amb verdures",type:"Sopar",time:"15 min",items:["Ous","Espinacs","Tomàquet"],prep:"Cuina les verdures i afegeix els ous batuts.",cal:350,p:24,c:10,f:24},
    {name:"Peix blanc amb patata",type:"Sopar",time:"30 min",items:["Peix blanc","Patata","Verdures"],prep:"Enforna el peix i la patata amb verdures.",cal:440,p:38,c:48,f:8},
    {name:"Wrap de pollastre",type:"Sopar",time:"20 min",items:["Tortilla integral","Pollastre","Enciam"],prep:"Omple la tortilla i tancala abans de cuinar-la.",cal:470,p:40,c:46,f:14},
    {name:"Amanida de cigrons",type:"Sopar",time:"12 min",items:["Cigrons","Enciam","Tomàquet","Oliva"],prep:"Barreja els ingredients i serveix fred.",cal:390,p:16,c:48,f:12},
    {name:"Salmó amb arròs",type:"Sopar",time:"30 min",items:["Salmó","Arròs","Verdures"],prep:"Cuina el salmó i combina amb arròs i verdures.",cal:540,p:38,c:66,f:14},
    {name:"Pasta amb tonyina i tomàquet",type:"Sopar",time:"20 min",items:["Pasta","Tonyina","Tomàquet"],prep:"Cuina la pasta i barreja amb salsa de tomàquet i tonyina.",cal:520,p:34,c:78,f:9},
  ];
  const [filter,setFilter]=useState("Totes");
  const [query,setQuery]=useState("");
  const [favorites,setFavorites]=useState<string[]>(()=>read(`tf_recipe_favorites_${account.id}`,[]));
  const filtered=recipes.filter(r=>(filter==="Totes"||r.type===filter)&&`${r.name} ${r.items.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  function addToShopping(r:typeof recipes[number]){const saved=read<string[]>(`tf_shopping_${account.id}`,[]);write(`tf_shopping_${account.id}`,[...new Set([...saved,...r.items])]);}
  function toggleFavorite(name:string){const next=favorites.includes(name)?favorites.filter(n=>n!==name):[...favorites,name];setFavorites(next);write(`tf_recipe_favorites_${account.id}`,next);}
  function addToDiary(r:typeof recipes[number]){const key=`tf_food_${account.id}`;const items=read<{id?:string;date?:string;name:string;grams:number;cal:number;protein:number;carbs:number;fat:number}[]>(key,[]);write(key,[...items,{id:uid(),date,name:r.name,grams:100,cal:r.cal,protein:r.p,carbs:r.c,fat:r.f}]);window.dispatchEvent(new Event("titanfit:nutrition-updated"));notify("Recepta afegida al diari.");}
  return <section><div className="recipe-toolbar"><input className="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cerca receptes o ingredients"/><div className="category-pills recipe-filters">{["Totes","Esmorzar","Dinar","Berenar","Sopar"].map(v=><button key={v} className={filter===v?"active":""} onClick={()=>setFilter(v)}>{v}</button>)}</div></div><p className="nutrition-disclaimer">Valors nutricionals estimatius basats en ingredients i racions habituals.</p><div className="recipe-grid">{filtered.map(r=><article className="panel recipe-card" key={r.name}><div className="recipe-image">🥗</div><div className="recipe-head"><span className="eyebrow">{r.type} · {r.time}</span><button className={favorites.includes(r.name)?"favorite active":"favorite"} onClick={()=>toggleFavorite(r.name)}>♡</button></div><h3>{r.name}</h3><strong className="recipe-nutrients">{r.cal} kcal · P {r.p} g · HC {r.c} g · G {r.f} g</strong><ul>{r.items.map(i=><li key={i}>{i}</li>)}</ul><p>{r.prep}</p><div className="recipe-actions"><button className="secondary" onClick={()=>addToShopping(r)}>A la llista</button><button className="primary" onClick={()=>addToDiary(r)}>Afegir al diari</button></div></article>)}</div></section>;
}

function ShoppingList({account}:{account:Account}){
  const [list,setList]=useState<string[]>(()=>read(`tf_shopping_${account.id}`,["Avena","Fruita","Ou","Arròs","Verdures"]));
  const [text,setText]=useState("");
  function update(next:string[]){setList(next);write(`tf_shopping_${account.id}`,next);}
  return <section className="panel shopping"><div className="panel-title"><div><span className="eyebrow">LLISTA PERSONAL</span><h3>Comprar</h3></div></div><div className="add-inline"><input value={text} onChange={e=>setText(e.target.value)} placeholder="Afegir ingredient"/><button className="primary" onClick={()=>{if(text.trim()){update([...list,text.trim()]);setText("");}}}>Afegir</button></div>{list.map((item,i)=><label className="check-row" key={i}><input type="checkbox"/><span>{item}</span><button onClick={()=>update(list.filter((_,n)=>n!==i))}>×</button></label>)}</section>;
}

function Marketplace({account,notify}:{account:Account;notify:(s:string)=>void}) {
  const [items,setItems]=useState<Listing[]>(()=>read("tf_listings",[]));
  const [query,setQuery]=useState("");
  const [category,setCategory]=useState("Totes");
  const [showForm,setShowForm]=useState(false);
  const [favorites,setFavorites]=useState<string[]>(()=>read(`tf_fav_${account.id}`,[]));
  const [sort,setSort]=useState("recent");
  const [stateFilter,setStateFilter]=useState("Tots");
  const [messages,setMessages]=useState<{listingId:string;from:string;text:string}[]>(()=>read(`tf_messages_${account.id}`,[]));
  const [editingId,setEditingId]=useState("");
  const categories=["Totes","Roba","Accessoris","Equipament","Suplementació"];
  useEffect(()=>{write(`tf_fav_${account.id}`,favorites);},[favorites,account.id]);
  async function persistItems(next:Listing[],success:string):Promise<boolean>{if(!write("tf_listings",next)){notify("No s'ha pogut desar l'anunci.");return false;}try{await confirmCloudWrite("tf_listings");setItems(next);notify(success);return true;}catch(error){notify(error instanceof Error?`No s'ha pogut sincronitzar l'anunci: ${error.message}`:"No s'ha pogut sincronitzar l'anunci.");return false;}}
  function publish(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const d=new FormData(e.currentTarget);const photoFile=d.get("photo") as File|null;if(photoFile&&photoFile.size){if(photoFile.size>2*1024*1024){notify("La fotografia supera el límit actual de 2 MB.");return;}const reader=new FileReader();reader.onload=()=>{void finish(String(reader.result));};reader.onerror=()=>notify("No s'ha pogut llegir la fotografia.");reader.readAsDataURL(photoFile);}else void finish(editingId?items.find(i=>i.id===editingId)?.photo||"": "");
    async function finish(photoData:string){const base={name:String(d.get("name")),price:Number(d.get("price")),category:String(d.get("category")),state:String(d.get("state")),location:String(d.get("location")),seller:account.name,description:String(d.get("description")),brand:String(d.get("brand")||""),delivery:String(d.get("delivery")||""),photo:photoData};const next=editingId?items.map(i=>i.id===editingId?{...i,...base}:i):[{id:uid(),...base,owner:account.id,status:"Disponible" as const},...items];if(await persistItems(next,editingId?"Anunci actualitzat al servidor.":"Anunci publicat al servidor.")){setEditingId("");setShowForm(false);}}}
  let filtered=items.filter(i=>(category==="Totes"||i.category===category)&&(stateFilter==="Tots"||i.state===stateFilter)&&i.name.toLowerCase().includes(query.toLowerCase()));
  filtered=[...filtered].sort((a,b)=>sort==="low"?a.price-b.price:sort==="high"?b.price-a.price:items.indexOf(a)-items.indexOf(b));
  const editingItem=items.find(i=>i.id===editingId);
  return <div className="page"><div className="list-toolbar marketplace-toolbar"><div><span className="eyebrow">COMPRA I VENDA LOCAL</span><h2>Mercat TITANFIT</h2></div><button className="primary" onClick={()=>setShowForm(v=>!v)}>+ Publicar producte</button></div>
    {showForm&&<form className="panel publish-form" onSubmit={publish}><div className="publish-grid"><label>Nom del producte<input name="name" defaultValue={editingItem?.name||""} required/></label><label>Preu (€)<input name="price" type="number" min="1" step="0.01" defaultValue={editingItem?.price||""} required/></label><label>Categoria<select name="category" defaultValue={editingItem?.category||"Roba"}>{categories.slice(1).map(c=><option key={c}>{c}</option>)}</select></label><label>Estat<select name="state" defaultValue={editingItem?.state||"Nou"}><option>Nou</option><option>Usat</option></select></label><label>Marca<input name="brand" defaultValue={editingItem?.brand||""} placeholder="Marca"/></label><label>Entrega<select name="delivery" defaultValue={editingItem?.delivery||"Recollida"}><option>Recollida</option><option>Enviament</option><option>Recollida o enviament</option></select></label><label>Ubicació<input name="location" defaultValue={editingItem?.location||""} required placeholder="Sant Boi de Llobregat"/></label><label>Descripció<textarea name="description" defaultValue={editingItem?.description||""} required/></label><label>Fotografia<input name="photo" type="file" accept="image/*"/></label></div>{editingItem?.category==="Suplementació"&&<div className="notice">Per a suplementació cal confirmar que el producte està original, tancat, etiquetat i dins de caducitat. No es permet publicar suspensions obertes o caducades.</div>}<div className="form-actions"><button type="button" className="secondary" onClick={()=>{setEditingId("");setShowForm(false);}}>Cancel·lar</button><button type="submit" className="primary">{editingId?"Guardar canvis":"Publicar"}</button></div></form>}
    <div className="market-controls"><input className="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cerca productes"/><select value={stateFilter} onChange={e=>setStateFilter(e.target.value)}><option>Tots</option><option>Nou</option><option>Usat</option></select><select value={sort} onChange={e=>setSort(e.target.value)}><option value="recent">Més recents</option><option value="low">Menor preu</option><option value="high">Major preu</option></select></div><div className="category-pills">{categories.map(c=><button key={c} className={category===c?"active":""} onClick={()=>setCategory(c)}>{c}</button>)}</div>
    {filtered.length?<div className="market-grid">{filtered.map(item=><article className="listing-card" key={item.id}><div className="listing-art">{item.photo?<img src={item.photo} alt={item.name}/>:<span>{item.category==="Equipament"?"▥":item.category==="Roba"?"◈":item.category==="Suplementació"?"●":"◆"}</span>}<button className={favorites.includes(item.id)?"favorite active":"favorite"} onClick={()=>{const next=favorites.includes(item.id)?favorites.filter(x=>x!==item.id):[...favorites,item.id];setFavorites(next);}}>♡</button></div><div className="listing-body"><small>{item.category} · {item.state} · {item.status}</small><h3>{item.name}</h3><p>{item.description}</p><div className="listing-bottom"><strong>{item.price.toFixed(2).replace(".",",")} €</strong><span>{item.location}</span></div>{item.brand&&<small>Marca: {item.brand}</small>}<div className="listing-actions">{item.owner===account.id?<><button onClick={()=>{setEditingId(item.id);setShowForm(true);}}>Editar</button><button onClick={()=>{void persistItems(items.map(x=>x.id===item.id?{...x,status:"Reservat"}:x),"Anunci marcat com a reservat al servidor.");}}>Reservar</button><button onClick={()=>{void persistItems(items.map(x=>x.id===item.id?{...x,status:"Venut"}:x),"Anunci marcat com a venut al servidor.");}}>Venut</button><button onClick={()=>{void persistItems(items.filter(x=>x.id!==item.id),"Anunci eliminat del servidor.");}}>Eliminar</button></>:<button onClick={()=>{const text=window.prompt(`Missatge per a ${item.seller}:`,"Hola, segueix disponible?");if(text?.trim()){const next=[...messages,{listingId:item.id,from:account.name,text:text.trim()}];setMessages(next);write(`tf_messages_${account.id}`,next);notify("Missatge desat al registre personal; no s'envia al venedor en aquesta versió.");}}}>Contactar</button>}</div></div></article>)}</div>:<div className="empty-state panel"><span>▦</span><h3>No hi ha anuncis que coincideixin</h3><p>Pots publicar el primer producte o modificar els filtres.</p></div>}
  </div>;
}

function Gyms({account,notify}:{account:Account;notify:(s:string)=>void}) {
  const [query,setQuery]=useState("");
  const [municipality,setMunicipality]=useState("Tots");
  const [tab,setTab]=useState<"gimnasos"|"hores">("gimnasos");
  const [selected,setSelected]=useState<any|null>(null);
  const gyms=[
    {name:"Dreamfit Sant Boi",city:"Sant Boi de Llobregat",address:"C/ Alberedes, 6",hours:"Dl–Dv 06:00–23:00 · Ds i Dg 08:00–20:00 · Festius 07:00–15:00",type:"Cadena privada",facilities:"Musculació, cardio, entrenament funcional i classes dirigides",source:"Pàgina oficial Dreamfit"},
    {name:"Fitness Park Sant Boi - Parc Comercial",city:"Sant Boi de Llobregat",address:"Carrer dels Hortells, 6",hours:"Tots els dies 06:00–01:00",type:"Cadena privada",facilities:"Musculació, cardio i entrenament funcional",source:"Pàgina oficial Fitness Park"},
    {name:"CrossFit Sant Boi",city:"Sant Boi de Llobregat",address:"Carrer dels Fusos, 12",hours:"Dl–Dj 07:00–21:30 · Dv 07:00–20:00 · Ds i Dg 10:00–13:00",type:"CrossFit",facilities:"CrossFit, entrenament funcional, halterofília i classes dirigides",source:"Pàgina oficial CrossFit Sant Boi"},
    {name:"DUIN CEM Pau Gasol",city:"Sant Boi de Llobregat",address:"Carrer de Lluís Companys, 23",hours:"Dl–Dv 07:00–23:00 · Ds 08:00–20:00 · Dg i festius 09:00–14:00",type:"Centre municipal",facilities:"Sala fitness, piscina, pàdel, activitats dirigides i entrenament personal",source:"Pàgina oficial DUIN"},
    {name:"Synergym Cornellà Centre",city:"Cornellà de Llobregat",address:"C/ Joan Maragall, 25",hours:"Dl–Dv 06:00–23:00 · Ds 09:00–18:00 · Dg i festius 09:00–14:00",type:"Cadena privada",facilities:"Musculació, cardio i classes dirigides",source:"Pàgina oficial Synergym"},
    {name:"Basic-Fit Cornellà Carretera d’Esplugues",city:"Cornellà de Llobregat",address:"Carretera d’Esplugues, 195",hours:"Dl–Dv 07:00–22:30 · Ds i Dg 08:00–21:00",type:"Cadena privada",facilities:"Zona de peses, cardio i classes col·lectives",source:"Pàgina oficial Basic-Fit"},
    {name:"Basic-Fit Cornellà C. Lasarte",city:"Cornellà de Llobregat",address:"C/ Lasarte, 1",hours:"24 hores, tots els dies",type:"Cadena privada",facilities:"Musculació i cardio",source:"Fitxa oficial Basic-Fit"},
    {name:"Basic-Fit Gavà",city:"Gavà",address:"Avinguda de l’Eramprunyà, 4",hours:"24 hores, tots els dies",type:"Cadena privada",facilities:"Musculació, cardio i entrenament",source:"Pàgina oficial Basic-Fit"},
    {name:"Basic-Fit Viladecans",city:"Viladecans",address:"Avda. Siglo XXI, 6, C.C. Vilamarina",hours:"24 hores, tots els dies",type:"Cadena privada",facilities:"Musculació, cardio i entrenament funcional",source:"Pàgina oficial Basic-Fit"},
    {name:"Green Fit - Sant Boi Club",city:"Sant Boi de Llobregat",address:"Informació no verificada",hours:"Consultar horaris oficials",type:"Club esportiu",facilities:"Informació no disponible",source:"Informació no verificada"},
    {name:"CEM Sagnier",city:"El Prat de Llobregat",address:"Informació no verificada",hours:"Consultar horaris oficials",type:"Centre municipal",facilities:"Informació no disponible",source:"Informació no verificada"},
  ];
  const cities=["Tots",...Array.from(new Set(gyms.map(g=>g.city)))];
  let filtered=gyms.filter(g=>(municipality==="Tots"||g.city===municipality)&&`${g.name} ${g.city} ${g.address}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name,"ca"));
  const [favorite,setFavorite]=useState<string[]>(()=>read(`tf_gym_favs_${account.id}`,[]));
  function toggle(name:string){const next=favorite.includes(name)?favorite.filter(n=>n!==name):[...favorite,name];setFavorite(next);write(`tf_gym_favs_${account.id}`,next);notify(next.includes(name)?"Gimnàs afegit a preferits.":"Gimnàs eliminat dels preferits.");}
  return <div className="page"><div className="tabs"><button className={tab==="gimnasos"?"active":""} onClick={()=>setTab("gimnasos")}>Gimnasos</button><button className={tab==="hores"?"active":""} onClick={()=>setTab("hores")}>Smart Hours</button></div>{tab==="gimnasos"?selected?<section className="panel gym-detail"><button className="secondary" onClick={()=>setSelected(null)}>← Tornar al catàleg</button><h1>{selected.name}</h1><div className="gym-detail-grid"><article><small>Adreça</small><strong>{selected.address}</strong></article><article><small>Municipi</small><strong>{selected.city}</strong></article><article><small>Horari</small><strong>{selected.hours}</strong></article><article><small>Tipus</small><strong>{selected.type}</strong></article><article><small>Instal·lacions</small><strong>{selected.facilities}</strong></article><article><small>Font</small><strong>{selected.source}</strong></article></div><p className="notice">Els horaris poden variar en festius. Consulta la font oficial abans de visitar el centre.</p></section>:<><div className="gym-toolbar"><input className="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cerca gimnasos"/><select value={municipality} onChange={e=>setMunicipality(e.target.value)}>{cities.map(c=><option key={c}>{c}</option>)}</select></div><div className="gym-grid">{filtered.map(g=><article className="panel gym-card" key={g.name}><div className="gym-visual">⌖</div><div><small>{g.city}</small><h3>{g.name}</h3><p><strong>{g.address}</strong></p><p>{g.hours}</p><div className="service-pills"><span>{g.type}</span></div><div className="gym-card-actions"><button className="primary" onClick={()=>setSelected(g)}>Veure gimnàs</button><button className={favorite.includes(g.name)?"secondary active":"secondary"} onClick={()=>toggle(g.name)}>{favorite.includes(g.name)?"★ Preferit":"☆ Preferit"}</button></div></div></article>)}</div></>:<SmartHours/>}</div>;
}

function SmartHours(){
  const [day,setDay]=useState("Dilluns");
  const days=["Dilluns","Dimarts","Dimecres","Dijous","Divendres","Dissabte","Diumenge"];
  const patterns:Record<string,{best:string;busy:string;level:string[]}>={
    "Dilluns":{best:"14:00–16:00",busy:"18:00–20:30",level:["Mitjana","Baixa","Alta","Baixa","Mitjana","Alta","Baixa","Mitjana","Baixa"]},
    "Dimarts":{best:"14:00–16:00",busy:"18:30–20:30",level:["Baixa","Baixa","Mitjana","Baixa","Baixa","Alta","Mitjana","Alta","Baixa"]},
    "Dimecres":{best:"13:00–15:00",busy:"19:00–21:00",level:["Mitjana","Baixa","Baixa","Mitjana","Mitjana","Alta","Alta","Mitjana","Baixa"]},
    "Dijous":{best:"15:00–17:00",busy:"18:30–20:30",level:["Mitjana","Mitjana","Baixa","Mitjana","Mitjana","Alta","Mitjana","Alta","Baixa"]},
    "Divendres":{best:"12:00–14:00",busy:"17:30–19:30",level:["Baixa","Baixa","Mitjana","Baixa","Mitjana","Mitjana","Alta","Mitjana","Baixa"]},
    "Dissabte":{best:"09:00–11:00",busy:"11:00–13:00",level:["Mitjana","Baixa","Baixa","Mitjana","Alta","Mitjana","Alta","Mitjana","Mitjana"]},
    "Diumenge":{best:"09:00–11:30",busy:"11:30–13:30",level:["Baixa","Baixa","Baixa","Mitjana","Mitjana","Mitjana","Alta","Mitjana","Baixa"]},
  };
  const p=patterns[day];
  return <section className="smart-hours"><div className="notice"><strong>Estimació orientativa de demostració.</strong> No representa ocupació real ni procedent de sensors.</div><div className="smart-hours-layout"><div className="panel"><span className="eyebrow">TRIA EL DIA</span><div className="day-options">{days.map(d=><button key={d} className={day===d?"active":""} onClick={()=>setDay(d)}>{d}</button>)}</div><h2>{day}</h2><article className="hour-recommendation"><small>Millor moment per entrenar</small><strong>{p.best}</strong><p>Aquesta franja es presenta com a demostració de baixa afluència. Pot ser una bona opció si prefereixes més tranquil·litat.</p></article><article className="hour-recommendation busy"><small>Franja més concorreguda</small><strong>{p.busy}</strong><p>Les tardes poden concentrar més usuaris en el patró orientatiu. Si vols evitar esperes, prova una altra franja.</p></article></div><div className="panel hours-chart"><span className="eyebrow">FRANGES DE LA SETMANA</span><h2>Patró de demostració</h2><div className="hour-bars">{["06","08","10","12","14","16","18","20","22"].map((h,i)=><div key={h}><span>{h}:00</span><strong className={p.level[i].toLowerCase()}>{p.level[i]}</strong><i className={p.level[i].toLowerCase()}/></div>)}</div><div className="chart-legend"><span>Baixa</span><span>Mitjana</span><span>Alta</span></div></div></div></section>;
}

function Machines(){
  const [query,setQuery]=useState("");
  const machines=[
    {name:"Press de pech. convergent",muscles:"Pectoral i tríceps",use:"Ajusta el seient perquè les empunyadures quedin al mig del pit.",errors:"Treure els hombros del coixí o col·laborar amb impuls.",alts:["Press de banca","Press amb manuelles"]},
    {name:"Jambes a la pressa",muscles:"Cuàdriceps i glutis",use:"Col·loca els peus a l'alçada mitjana i baixa controladament.",errors:"Aixecar el maluc o bloquejar el genoll.",alts:["Sentadilla","Hip thrust"]},
  ].filter(m=>m.name.toLowerCase().includes(query.toLowerCase()));
  return <section><div className="list-toolbar"><div><span className="eyebrow">CONSULTA DE MAQUINÀRIA</span><h2>Fitxes de màquines</h2></div><input className="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cerca una màquina"/></div><div className="notice">Escanejar QR requereix accés a la càmera i un catàleg de codis administrat. Pots consultar totes les fitxes disponibles per cerca.</div><div className="gym-grid">{machines.map(m=><article className="panel machine-card" key={m.name}><h3>{m.name}</h3><small>{m.muscles}</small><h4>Ús correcte</h4><p>{m.use}</p><h4>Errors freqüents</h4><p>{m.errors}</p><h4>Alternatives</h4><div className="service-pills">{m.alts.map(a=><span key={a}>{a}</span>)}</div></article>)}</div></section>;
}

function Calendar({account}:{account:Account}) {
  const [plan,setPlan]=useState<Record<string,string>>(()=>read(`tf_calendar_${account.id}`,{}));
  const [selected,setSelected]=useState(new Date().getDate());
  const now=new Date();
  const days=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  const key=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(selected).padStart(2,"0")}`;
  function assign(value:string){const next={...plan,[key]:value};setPlan(next);write(`tf_calendar_${account.id}`,next);}
  const planned=Object.keys(plan).length;
  return <div className="page"><div className="section-heading"><div><span>PLANIFICACIÓ</span><h2>{new Intl.DateTimeFormat("ca-ES",{month:"long",year:"numeric"}).format(now)}</h2></div><strong>{planned} dies planificats</strong></div><section className="calendar-layout"><div className="panel month-grid">{["Dl","Dt","Dc","Dj","Dv","Ds","Dg"].map(d=><b key={d}>{d}</b>)}{Array.from({length:days},(_,i)=><button key={i} className={selected===i+1?"active":""} onClick={()=>setSelected(i+1)}><strong>{i+1}</strong>{plan[`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(i+1).padStart(2,"0")}`]&&<small>●</small>}</button>)}</div><aside className="panel day-plan"><span className="eyebrow">DIA SELECCIONAT</span><h3>{selected} {new Intl.DateTimeFormat("ca-ES",{month:"long"}).format(now)}</h3><select value={plan[key]||"Descans"} onChange={e=>assign(e.target.value)}><option>Descans</option><option>Torso</option><option>Cames</option><option>Ple cos</option><option>Cardio</option></select><p>La planificació es guarda només per a aquest usuari.</p></aside></section></div>;
}

function Social({account,notify}:{account:Account;notify:(s:string)=>void}) {
  type Friend={id:string;name:string;status:"Amics"|"Pendent";direction:"incoming"|"outgoing"};
  type AvailableUser={id:string;name:string};
  type Active={id:string};
  const [tab,setTab]=useState<"amics"|"reptes">("amics");
  const [query,setQuery]=useState("");
  const [friends,setFriends]=useState<Friend[]>([]);
  const [available,setAvailable]=useState<AvailableUser[]>([]);
  const [active,setActive]=useState<Active[]>(()=>read(`tf_challenges_${account.id}`,[]));
  const [completed,setCompleted]=useState<string[]>(()=>read(`tf_completed_challenges_${account.id}`,[]));
  const sessions=read<Session[]>(`tf_sessions_${account.id}`,[]);
  const challenges=[
    {id:"3-week",name:"3 entrenaments en una setmana",description:"Completa 3 sessions en els últims 7 dies",goal:3,reward:"Insígnia Constància"},
    {id:"4-week",name:"4 entrenaments en una setmana",description:"Completa 4 sessions en els últims 7 dies",goal:4,reward:"Insígnia Disciplina"},
    {id:"10-sessions",name:"10 entrenaments totals",description:"Completa 10 sessions registrades",goal:10,reward:"Insígnia Perseverança"},
    {id:"30-chest",name:"30 sèries de pit",description:"Completa 30 sèries registrades de pit",goal:30,reward:"Insígnia Pectoral"},
    {id:"30-back",name:"30 sèries d'esquena",description:"Completa 30 sèries registrades d'esquena",goal:30,reward:"Insígnia Esquena"},
    {id:"5-legs",name:"5 entrenaments de cames",description:"Completa cinc sessions amb exercicis de cames",goal:5,reward:"Insígnia Potència"},
    {id:"3-weeks",name:"3 setmanes consecutives",description:"Registra entrenaments en 3 setmanes",goal:3,reward:"Insígnia Regularitat"},
    {id:"record",name:"Nou rècord personal",description:"Registra una sèrie amb 1RM estimada superior",goal:1,reward:"Insígnia Rècord"},
    {id:"15-sessions",name:"15 entrenaments totals",description:"Completa 15 sessions registrades",goal:15,reward:"Insígnia Acumulació"},
    {id:"100-sets",name:"100 sèries registrades",description:"Completa 100 sèries totals",goal:100,reward:"Insígnia Volum"},
    {id:"4-muscles",name:"4 grups musculars",description:"Entrena quatre grups musculars diferents",goal:4,reward:"Insígnia Equilibri"},
    {id:"5-routines",name:"5 sessions amb rutines",description:"Completa cinc entrenaments iniciats des de rutines",goal:5,reward:"Insígnia Rutina"},
  ];
  async function refreshFriends(){
    const response=await fetch("/api/friends",{credentials:"same-origin"});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||"No s'ha pogut carregar la llista d'amics.");
    setFriends(result.friends);
  }
  useEffect(()=>{let cancelled=false;fetch("/api/friends",{credentials:"same-origin"}).then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error||"No s'ha pogut carregar la llista d'amics.");if(!cancelled)setFriends(result.friends);}).catch(error=>{if(!cancelled)notify(error instanceof Error?error.message:"No s'ha pogut carregar la llista d'amics.");});return()=>{cancelled=true;};},[account.id]);
  useEffect(()=>{if(query.trim().length<2){setAvailable([]);return;}let cancelled=false;const timer=window.setTimeout(()=>{fetch(`/api/users?q=${encodeURIComponent(query.trim())}`,{credentials:"same-origin"}).then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error||"No s'ha pogut cercar usuaris.");if(!cancelled)setAvailable(result.users);}).catch(error=>{if(!cancelled)notify(error instanceof Error?error.message:"No s'ha pogut cercar usuaris.");});},220);return()=>{cancelled=true;window.clearTimeout(timer);};},[query,account.id]);
  function progress(id:string){
    if(id==="3-week"||id==="4-week")return new Set(sessions.filter(s=>Date.now()-new Date(s.date).getTime()<7*86400000).map(workoutKey)).size;
    if(id==="10-sessions"||id==="15-sessions")return new Set(sessions.map(workoutKey)).size;
    if(id==="30-chest")return sessions.filter(s=>exercises.find(e=>e.name===s.exercise)?.muscle==="Pit").flatMap(s=>s.sets).filter(s=>s.done).length;
    if(id==="30-back")return sessions.filter(s=>exercises.find(e=>e.name===s.exercise)?.muscle==="Esquena").flatMap(s=>s.sets).filter(s=>s.done).length;
    if(id==="5-legs")return new Set(sessions.filter(s=>["Quàdriceps","Isquiotibials","Glutis","Bessons"].includes(exercises.find(e=>e.name===s.exercise)?.muscle||"")).map(workoutKey)).size;
    if(id==="100-sets")return sessions.flatMap(s=>s.sets).filter(s=>s.done).length;
    if(id==="4-muscles")return new Set(sessions.map(s=>exercises.find(e=>e.name===s.exercise)?.muscle).filter(Boolean)).size;
    if(id==="3-weeks"){const weekKeys=Array.from(new Set(sessions.map(s=>{const d=new Date(s.date);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return d.toISOString().slice(0,10);}))).sort();let longest=0,currentRun=0;for(let i=0;i<weekKeys.length;i++){if(i===0||Date.parse(weekKeys[i])-Date.parse(weekKeys[i-1])===7*86400000)currentRun++;else currentRun=1;longest=Math.max(longest,currentRun);}return longest;}
    if(id==="record"){const values=sessions.flatMap(s=>s.sets).filter(s=>s.done).map(s=>estimate1RM(s.kg,s.reps)).sort((a,b)=>b-a);return values.length>=2&&values[0]>values[1]?1:0;}
    if(id==="5-routines")return read<number>(`tf_routine_starts_${account.id}`,0);
    return 0;
  }
  useEffect(()=>{const reached=challenges.filter(c=>active.some(a=>a.id===c.id)&&progress(c.id)>=c.goal).map(c=>c.id);if(reached.length){const next=Array.from(new Set([...completed,...reached]));if(next.length!==completed.length){setCompleted(next);write(`tf_completed_challenges_${account.id}`,next);notify("Repte completat i recompensa desbloquejada.");}}},[sessions,active,completed,account.id]);
  async function addFriend(user:AvailableUser){try{const response=await fetch(`/api/friends/${encodeURIComponent(user.id)}`,{method:"POST",credentials:"same-origin"});const result=await response.json();if(!response.ok)throw new Error(result.error||"No s'ha pogut enviar la sol·licitud.");await refreshFriends();setAvailable(v=>v.filter(item=>item.id!==user.id));notify("Sol·licitud d'amistat enviada.");}catch(error){notify(error instanceof Error?error.message:"No s'ha pogut enviar la sol·licitud.");}}
  async function accept(id:string){try{const response=await fetch(`/api/friends/${encodeURIComponent(id)}`,{method:"POST",credentials:"same-origin"});const result=await response.json();if(!response.ok)throw new Error(result.error||"No s'ha pogut acceptar la sol·licitud.");await refreshFriends();notify("Amistat acceptada.");}catch(error){notify(error instanceof Error?error.message:"No s'ha pogut acceptar la sol·licitud.");}}
  async function removeFriend(id:string){if(!window.confirm("Eliminar aquesta amistat o sol·licitud?"))return;try{const response=await fetch(`/api/friends/${encodeURIComponent(id)}`,{method:"DELETE",credentials:"same-origin"});const result=await response.json();if(!response.ok)throw new Error(result.error||"No s'ha pogut eliminar l'amistat.");await refreshFriends();notify("Amistat eliminada.");}catch(error){notify(error instanceof Error?error.message:"No s'ha pogut eliminar l'amistat.");}}
  function activate(id:string){if(active.some(a=>a.id===id)||completed.includes(id))return;const next=[...active,{id}];setActive(next);write(`tf_challenges_${account.id}`,next);notify("Repte activat.");}
  const friendIds=new Set(friends.map(friend=>friend.id));
  const visibleUsers=available.filter(user=>!friendIds.has(user.id));
  return <div className="page"><div className="tabs"><button className={tab==="amics"?"active":""} onClick={()=>setTab("amics")}>Amics</button><button className={tab==="reptes"?"active":""} onClick={()=>setTab("reptes")}>Reptes</button></div>{tab==="amics"?<section><div className="friend-search"><input className="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cerca comptes per nom o correu"/><span>Busca altres comptes TITANFIT</span></div><div className="friend-columns"><div className="panel"><div className="panel-title"><h2>Comptes disponibles</h2></div>{visibleUsers.length?visibleUsers.map(user=><article className="friend-row" key={user.id}><div className="avatar">{user.name[0]}</div><div><strong>{user.name}</strong><small>Compte TITANFIT</small></div><button className="secondary" onClick={()=>addFriend(user)}>Afegir</button></article>):<div className="empty-state"><h3>{query.trim().length<2?"Cerca un compte":"No s'han trobat comptes"}</h3><p>Escriu almenys dos caràcters per cercar.</p></div>}</div><div className="panel"><div className="panel-title"><h2>Amics i sol·licituds</h2></div>{friends.length?friends.map(friend=><article className="friend-row" key={friend.id}><div className="avatar">{friend.name[0]}</div><div><strong>{friend.name}</strong><small>{friend.status}{friend.status==="Pendent"?friend.direction==="incoming"?" · Rebut":" · Enviat":""}</small></div>{friend.status==="Pendent"&&friend.direction==="incoming"?<><button className="primary" onClick={()=>accept(friend.id)}>Acceptar</button><button className="danger" onClick={()=>removeFriend(friend.id)}>Rebutjar</button></>:friend.status==="Pendent"?<button className="danger" onClick={()=>removeFriend(friend.id)}>Cancel·lar</button>:<button className="danger" onClick={()=>removeFriend(friend.id)}>Eliminar</button>}</article>):<div className="empty-state"><h3>No tens amistats</h3><p>Cerca un compte per enviar una sol·licitud.</p></div>}</div></div></section>:<section className="challenge-grid">{challenges.map(c=>{const p=progress(c.id);const pct=Math.min(100,Math.round(p/c.goal*100));const isActive=active.some(a=>a.id===c.id);const isCompleted=completed.includes(c.id)||pct>=100;return <article className="panel challenge-card" key={c.id}><span className="eyebrow">{isCompleted?"COMPLETAT":isActive?"ACTIU":"DISPONIBLE"}</span><h3>{c.name}</h3><p>{c.description}</p><small>Recompensa: {c.reward}</small><div className="bar"><i style={{width:`${pct}%`}}/></div><strong>{Math.min(p,c.goal)} / {c.goal} · {pct}%</strong>{!isActive&&!isCompleted&&<button className="primary" onClick={()=>activate(c.id)}>Activar repte</button>}{isCompleted&&<button className="secondary">Repte completat</button>}</article>;})}</section>}</div>;
}function Profile({account,setCurrent,notify}:{account:Account;setCurrent:(account:Account|null)=>void;notify:(s:string)=>void}) {
  const [name,setName]=useState(account.name);
  const [profile,setProfile]=useState(()=>read(`tf_profile_${account.id}`,{age:"",height:"",weight:"",experience:"Principiant",goal:"Millorar la forma",days:"3",gym:""}));
  async function save(e:React.FormEvent){e.preventDefault();try{const response=await fetch("/api/profile",{method:"PATCH",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim()})});const result=await response.json();if(!response.ok)throw new Error(result.error||"No s'ha pogut actualitzar el perfil.");const key=`tf_profile_${account.id}`;if(!write(key,profile))throw new Error("No s'ha pogut desar la configuració local.");await confirmCloudWrite(key);setCurrent(result.user);notify("Perfil actualitzat al servidor.");}catch(error){notify(error instanceof Error?error.message:"No s'ha pogut actualitzar el perfil.");}}
  async function deleteAccount(){if(!window.confirm("Vols eliminar aquest compte i totes les dades sincronitzades?"))return;try{const response=await fetch("/api/delete-account",{method:"POST",credentials:"same-origin"});const result=await response.json();if(!response.ok)throw new Error(result.error||"No s'ha pogut eliminar el compte.");[...Object.keys(localStorage)].filter(k=>k.endsWith(account.id)||k.startsWith(`tf_migration_backup_${account.id}_`)).forEach(k=>localStorage.removeItem(k));deactivateCloudAccount();setCurrent(null);notify("Compte i dades eliminats del servidor.");}catch(error){notify(error instanceof Error?error.message:"No s'ha pogut eliminar el compte.");}}
  return <div className="page"><div className="section-heading"><div><span>CONFIGURACIÓ PRIVADA</span><h2>Perfil</h2></div></div><section className="profile-layout"><form className="panel profile-card" onSubmit={save}><div className="profile-avatar">{account.name.slice(0,1).toUpperCase()}</div><label>Nom visible<input value={name} onChange={e=>setName(e.target.value)} required/></label><label>Correu electrònic<input value={account.email} readOnly/></label><div className="profile-grid"><label>Edat<input type="number" min="14" value={profile.age} onChange={e=>setProfile({...profile,age:e.target.value})}/></label><label>Altura (cm)<input type="number" min="100" value={profile.height} onChange={e=>setProfile({...profile,height:e.target.value})}/></label><label>Pes corporal (kg)<input type="number" step="0.1" value={profile.weight} onChange={e=>setProfile({...profile,weight:e.target.value})}/></label><label>Experiència<select value={profile.experience} onChange={e=>setProfile({...profile,experience:e.target.value})}><option>Principiant</option><option>Intermedi</option><option>Avançat</option></select></label><label>Objectiu<select value={profile.goal} onChange={e=>setProfile({...profile,goal:e.target.value})}><option>Millorar la forma</option><option>Guanyar força</option><option>Guanyar massa muscular</option><option>Pèrdua de pes</option></select></label><label>Dies disponibles<input type="number" min="1" max="7" value={profile.days} onChange={e=>setProfile({...profile,days:e.target.value})}/></label><label>Gimnàs habitual<input value={profile.gym} onChange={e=>setProfile({...profile,gym:e.target.value})} placeholder="Opcional"/></label></div><button className="primary" type="submit">Guardar canvis</button></form><aside className="panel privacy-panel"><span className="eyebrow">PRIVACITAT</span><h3>Les teves dades se sincronitzen al servidor</h3><p>La sessió és privada i les dades personals s'aïllen per compte. La sincronització funciona quan TITANFIT està desplegat en un servidor accessible.</p><button className="danger full" onClick={deleteAccount}>Eliminar el compte i les dades</button></aside></section></div>;
}
