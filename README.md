# TITANFIT

Aplicació fitness amb React, TypeScript, Vite, Express i SQLite. La interfície continua en català. El servidor és la font principal de les dades personals; `localStorage` es conserva com a còpia de migració i memòria cau local.

## Arquitectura i dades

- **Frontend:** React 19, TypeScript i Vite.
- **Backend:** Express 5 sobre Node.js 22.16 o superior. S'utilitza el mòdul `node:sqlite` inclòs amb Node; en algunes versions mostra un avís d'API experimental.
- **Autenticació:** contrasenyes noves amb scrypt, sessions aleatòries guardades com a hash a SQLite i cookies `HttpOnly`, `SameSite=Lax`; en `NODE_ENV=production` també s'afegeix `Secure`. Les sessions duren 14 dies.
- **Base de dades:** `server-data/titanfit.db` per defecte. `DB_PATH` permet indicar una altra ruta. Foreign keys i WAL estan activats. La base de dades no es desa a `dist`.
- **Dades personals:** rutines, exercicis de les rutines, entrenaments i sèries, pesos, mesures, perfil, preferits, calendari, nutrició, reptes i altres llistes de l'aplicació. Les dades s'aïllen per l'usuari de la cookie; no s'accepta un `userId` del navegador per concedir accés.
- **Marketplace:** els anuncis es comparteixen entre comptes i només el propietari autenticat pot canviar o eliminar els seus. Els favorits són privats.

Durant el primer inici del backend, els comptes de `server-data/users.json` s'importen a SQLite sense copiar contrasenyes en text pla. En iniciar sessió, les dades locals de l'usuari s'importen de manera idempotent i es conserven sota les claus `tf_migration_backup_*`; les dades que ja existeixin al servidor tenen prioritat.

## Desenvolupament local

Requereix Node.js 22.16 o superior. Instal·la les dependències i inicia **dues terminals**:

```sh
npm install
npm run server
```

```sh
npm run dev
```

El backend escolta a `http://localhost:4174`; Vite serveix la interfície i envia `/api` al backend. La base de dades local queda a `server-data/titanfit.db`. Per compilar i provar:

```sh
npm run build
npm run test:server
npm run test:e2e  # requereix Chrome o Chromium
```

Per servir la compilació amb Express:

```sh
npm start
```

El port per defecte és `4174`; el proveïdor pot assignar-ne un de diferent mitjançant `PORT`.

## Variables d'entorn

| Variable | Ús |
| --- | --- |
| `PORT` | Port HTTP del servidor (per defecte `4174`). |
| `HOST` | Interfície d'escolta (per defecte `0.0.0.0`). |
| `TRUST_PROXY` | Estableix `1` només si el servidor està darrere d'un proxy invers de confiança; permet aplicar els límits d'inici de sessió a la IP real del client. |
| `DB_PATH` | Ruta absoluta de `titanfit.db`; per exemple `C:\dades\titanfit.db` en Windows o `/data/titanfit.db` en un allotjament amb disc persistent. |
| `NODE_ENV` | Estableix `production` en producció per activar l'atribut `Secure` de les cookies. |
| `BACKUP_DIR` | Ruta opcional per desar còpies de seguretat. |

No hi ha claus d'API al frontend. La recuperació de contrasenya per correu no està activada perquè encara falta configurar un proveïdor de correu.

## Còpies de seguretat

Executa:

```sh
npm run backup
```

Es crea una còpia coherent de SQLite a `server-data/backups` (o a `BACKUP_DIR`). Conserva còpies fora del servidor i comprova periòdicament que es poden restaurar. No copiïs només el fitxer `.db` mentre el servidor és actiu: WAL pot contenir canvis encara no consolidats.

## Publicació

La publicació requereix un allotjament Node.js que permeti mantenir un directori de dades persistent:

1. Compila amb `npm run build`.
2. Executa `npm run server` i configura `PORT`, `NODE_ENV=production` i `DB_PATH` cap a un volum persistent fora del directori públic; per exemple `/data/titanfit.db`.
3. Publica el frontend i l'API sota el **mateix origen HTTPS**. El servidor Express serveix `dist`; evita posar el frontend en un domini diferent sense dissenyar explícitament CORS i protecció CSRF.
4. Configura còpies de seguretat externes i un health check a `/api/health`.

SQLite és adequat per a una instància de backend amb un disc persistent. No és una solució de producció vàlida si el proveïdor esborra el disc en reiniciar, desplega diverses instàncies independents o necessita escalat horitzontal. En aquests casos cal migrar l'emmagatzematge a PostgreSQL gestionat abans del desplegament; aquesta migració i la configuració del proveïdor encara no estan incloses.

### Render

El fitxer `render.yaml` prepara un servei web a Frankfurt amb els comandos de compilació i inici, el health check i un disc persistent de 1 GB muntat a `/var/data`. El pla Starter és necessari perquè Render ofereix discos persistents en serveis de pagament. El servei fixa Node.js 22.22.0, compatible amb `node:sqlite`; `.node-version` manté la mateixa versió localment. Revisa el pla, la regió i la mida del disc al Blueprint abans de crear el servei.

Render proporciona `PORT`; no cal definir-lo manualment. El Blueprint estableix `NODE_ENV=production`, `HOST=0.0.0.0`, `TRUST_PROXY=1`, `DB_PATH=/var/data/titanfit.db` i `BACKUP_DIR=/var/data/backups`. Express serveix `dist` directament, de manera que el servei no necessita Vite en temps d'execució. Les fotografies del Marketplace estan guardades com a dades SQLite i queden al mateix disc que la base de dades.

No despleguis amb la base de dades local inclosa al repositori. Si cal conservar comptes antics de `server-data/users.json`, planifica'n la importació al disc abans de donar accés públic; aquesta còpia està exclosa de Git i Render no la rep en un desplegament normal.

## Integracions i límits pendents

- No s'ha configurat cap proveïdor d'allotjament, domini, HTTPS ni disc persistent. La sincronització entre dispositius només funcionarà quan aquest backend estigui publicat i accessible; la base de dades del desenvolupador no és accessible des d'altres xarxes.
- Les amistats s'envien entre comptes reals i es guarden en SQLite. El progrés dels reptes és personal i deriva dels entrenaments. Els missatges del mercat encara no s'envien al venedor; es guarden com a notes personals.
- Les imatges dels anuncis es guarden actualment amb el registre SQLite. Firebase Storage o un emmagatzematge d'objectes encara no està configurat.
- La recuperació de contrasenya no envia correus; necessita un servei de correu verificat.
- Catàleg d'exercicis, receptes, gimnasos i estimacions d'afluència són dades públiques de l'aplicació, no registres personals ni ocupació en temps real.
