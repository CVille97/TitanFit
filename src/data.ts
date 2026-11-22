export type Exercise = {
  name: string;
  muscle: string;
  secondary: string;
  equipment: string;
  level: "Principiant"|"Intermedi"|"Avançat";
  icon: string;
  description: string;
};

const add=(muscle:string,secondary:string,equipment:string,level:Exercise["level"],items:[string,string][])=>
  items.map(([name,description])=>({name,muscle,secondary,equipment,level,icon:name.split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase(),description}));

export const exercises:Exercise[]=[
...add("Pit","Espatlles i tríceps","Barra","Intermedi",[
["Press de banca amb barra","Treballa el pectoral principal amb empenta horitzontal."],
["Press inclinat amb barra","Treballa especialment la part superior del pit."],
["Press declinat amb barra","Incideix especialment en el pit inferior."],
["Press de banca amb agafada tancada","Treballa el tríceps i el pit amb agafada estreta."]]),
...add("Pit","Espatlles i tríceps","Manuelles","Intermedi",[
["Press inclinat amb manuelles","Treballa la part superior del pectoral i el deltoide anterior."],
["Obertures amb manuelles","Aïlla el pectoral mitjançant adducció horitzontal."]]),
...add("Pit","Tríceps i deltoide anterior","Màquina","Intermedi",[
["Press de pit en màquina","Treballa el pectoral amb trajectòria guiada."],
["Peck deck","Treballa el pectoral mitjançant adducció horitzontal."]]),
...add("Pit","Tríceps","Pes corporal","Avançat",[
["Fons en paral·leles inclinant el tors","Incideixen especialment en el pit inferior i tríceps."]]),
...add("Esquena","Bíceps i romboides","Polea","Intermedi",[
["Jaló al pit amb agafada ampla","Treballa el dorsal ample amb abducció vertical."],
["Jaló al pit amb agafada neutra","Treballa el dorsal ample i els braços."],
["Rem amb politja baixa","Treballa el dorsal, romboides i trapezi."],
["Pullover amb politja","Treballa principalment el dorsal ample."]]),
...add("Esquena","Bíceps i romboides","Barra","Intermedi",[
["Rem amb barra","Treballa l'esquena mitjana i el dorsal."]]),
...add("Esquena","Bíceps i trapezi","Màquina","Intermedi",[
["Rem en màquina amb el pit recolzat","Treballa l'esquena mitjana amb suport."]]),
...add("Esquena","Bíceps i trapezi","Manuelles","Intermedi",[
["Rem unilateral amb manuella","Treballa principalment el dorsal i l'esquena mitjana."]]),
...add("Espatlles","Tríceps i trapeci","Manuelles","Intermedi",[
["Press militar amb manuelles","Treballa els deltoides, especialment l'anterior."],
["Elevacions laterals amb manuelles","Treballa el deltoide lateral."],
["Elevacions frontals","Treballa el deltoide anterior."]]),
...add("Espatlles","Trapezi superior","Màquina","Principiant",[
["Press d'espatlles en màquina","Treballa els deltoides amb trajectòria guiada."]]),
...add("Espatlles","Romboides i trapeci","Polea","Intermedi",[
["Elevacions laterals amb politja","Treballa el deltoide lateral amb tensió constant."],
["Face pull","Treballa el deltoide posterior i l'esquena superior."]]),
...add("Espatlles","Esquena mitjana","Màquina","Intermedi",[
["Peck deck invers","Treballa especialment el deltoide posterior."]]),
...add("Bíceps","Avantbraç","Barra","Principiant",[
["Curl amb barra Z","Treballa el bíceps braquial."],
["Curl invers amb barra Z","Treballa el braquioradial i l'avantbraç."]]),
...add("Bíceps","Braquioradial","Manuelles","Intermedi",[
["Curl altern amb manuelles","Treballa els bíceps braquials de manera alterna."],
["Curl inclinat amb manuelles","Incideix especialment en la porció llarga del bíceps."],
["Curl martell","Treballa el braquial i el braquioradial."]]),
...add("Bíceps","Braquial","Màquina","Principiant",[
["Curl predicador","Treballa el bíceps amb els braços recolzats."]]),
...add("Bíceps","Braquial","Polea","Intermedi",[
["Curl amb politja baixa","Treballa el bíceps amb tensió constant."]]),
...add("Tríceps","Pectoral i espatlles","Polea","Intermedi",[
["Extensió de tríceps amb corda","Treballa els tres caps del tríceps."],
["Extensió unilateral amb politja","Treballa cada braç individualment."],
["Extensió per sobre del cap amb corda","Incideix especialment en el cap llarg del tríceps."]]),
...add("Tríceps","Pectoral i espatlles","Barra","Intermedi",[
["Extensió de tríceps amb barra recta","Treballa el tríceps amb agafada fixa."],
["Press francès amb barra Z","Treballa especialment el tríceps."]]),
...add("Avantbraços","Bíceps i força d'agafada","Barra","Principiant",[
["Curl de canell amb agafada supinada","Treballa els flexors del canell."],
["Extensió de canell amb agafada pronada","Treballa els extensors del canell."]]),
...add("Avantbraços","Braquioradial","Manuelles","Principiant",[
["Pronació i supinació amb manuella","Treballa la musculatura rotadora de l'avantbraç."]]),
...add("Avantbraços","Dorsal i bíceps","Pes corporal","Avançat",[
["Farmer Walk","Treballa la força d'agafada i l'avantbraç."],
["Dead Hang","Treballa la força d'agafada i l'avantbraç."]]),
...add("Quàdriceps","Glutis i adductors","Barra","Intermedi",[
["Squat amb barra","Treballa els quàdriceps i els glutis."]]),
...add("Quàdriceps","Glutis","Màquina","Principiant",[
["Premsa de cames","Treballa principalment els quàdriceps."],
["Extensió de quàdriceps en màquina","Aïlla els quàdriceps."],
["Hack squat","Treballa especialment els quàdriceps."]]),
...add("Quàdriceps","Glutis","Manuelles","Intermedi",[
["Goblet squat","Treballa els quàdriceps i els glutis."],
["Gambades amb manuelles","Treballa els quàdriceps i els glutis."]]),
...add("Quàdriceps","Glutis","Pes corporal","Intermedi",[
["Bulgarian split squat","Treballa els quàdriceps i els glutis."]]),
...add("Isquiotibials","Glutis i lumbar","Barra","Intermedi",[
["Pes mort romanès","Treballa els isquiotibials i els glutis."],
["Good Morning","Treballa isquiotibials, glutis i lumbar."]]),
...add("Isquiotibials","Glutis","Màquina","Principiant",[
["Curl femoral assegut","Aïlla els isquiotibials."],
["Curl femoral estirat","Treballa els isquiotibials."],
["Curl femoral unilateral","Treballa cada cama individualment."]]),
...add("Isquiotibials","Glutis","Pes corporal","Avançat",[
["Nordic curl","Treballa intensament els isquiotibials."],
["Glute Ham Raise","Treballa els isquiotibials i els glutis."]]),
...add("Glutis","Isquiotibials i quàdriceps","Barra","Intermedi",[
["Hip Thrust","Treballa principalment el gluti major."],
["Squat sumo","Treballa els glutis i els adductors."]]),
...add("Glutis","Core i isquiotibials","Pes corporal","Principiant",[
["Glute Bridge","Treballa el gluti major."]]),
...add("Glutis","Quàdriceps","Polea","Principiant",[
["Patada de glutis amb politja","Treballa el gluti major amb extensió."]]),
...add("Glutis","Tensor de la fàscia lata","Màquina","Principiant",[
["Abducció de maluc en màquina","Incideix en el gluti mitjà."]]),
...add("Glutis","Quàdriceps","Pes corporal","Intermedi",[
["Step Up","Treballa els glutis i els quàdriceps."]]),
...add("Bessons","Soli","Pes corporal","Principiant",[
["Elevacions de bessons dempeus","Treballa el tríceps sural."]]),
...add("Bessons","Soli","Màquina","Principiant",[
["Elevacions de bessons assegut","Incideix especialment en el soli."],
["Elevacions de bessons a la premsa","Treballa els bessons."]]),
...add("Bessons","Soli","Pes corporal","Intermedi",[
["Elevacions unilaterals de bessons","Treballa cada cama individualment."],
["Donkey Calf Raise","Treballa els bessons."]]),
...add("Bessons","Soli","Barra","Intermedi",[
["Elevacions de bessons a la Smith","Treballa els bessons."]]),
...add("Abdominals","Oblics i core","Màquina","Principiant",[
["Crunch en màquina","Treballa el recte abdominal."]]),
...add("Abdominals","Oblics","Polea","Intermedi",[
["Crunch amb politja","Treballa el recte abdominal."]]),
...add("Abdominals","Core i flexors","Pes corporal","Intermedi",[
["Elevació de genolls penjats","Treballa els abdominals i el core."],
["Elevació de cames estirat","Treballa principalment el recte abdominal."],
["Planxa abdominal","Treballa el core de manera isomètrica."],
["Roda abdominal","Treballa el core i els abdominals."],
["Reverse Crunch","Treballa especialment la zona abdominal inferior."]]),
];
