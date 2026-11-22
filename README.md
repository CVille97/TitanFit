# TITANFIT

Aplicació fitness amb React, TypeScript, Vite, Express i SQLite. La interfície continua en català. El servidor és la font principal de les dades personals; `localStorage` es conserva com a còpia de migració i memòria cau local.

## Arquitectura i dades

- **Frontend:** React 19, TypeScript i Vite.
- **Backend:** Express 5 i Node.js 22.16 o superior. Les consultes passen per una capa asíncrona basada en @libsql/client.
- **Autenticació:** contrasenyes amb scrypt, sessions aleatòries persistides com a hash i cookies HttpOnly, SameSite=Lax; en producció també Secure. Les sessions duren 14 dies.
- **Base de dades:** sense Turso, localment utilitza server-data/titanfit.db (o DB_PATH). Amb TURSO_DATABASE_URL i TURSO_AUTH_TOKEN, connecta a Turso.
- **Dades personals:** rutines, entrenaments i sèries, mesures, perfil, nutrició, amistats, reptes i llistes s'aïllen pel compte de la sessió.
- **Marketplace:** els anuncis són compartits, les accions de propietari estan protegides i les fotos s'emmagatzemen a SQLite/Turso.

La importació de server-data/users.json s'executa només en el mode SQLite local. La migració cap a Turso és una operació explícita i independent.

## Desenvolupament local

Requereix Node.js 22.16 o superior. Instal·la les dependències i inicia dues terminals:

npm install
npm run server

En una segona terminal, inicia Vite:

npm run dev

El backend escolta a http://localhost:4174; Vite serveix la interfície i envia /api al backend. Per compilar i provar executa npm run build, npm run test:server i npm run test:e2e (requereix Chrome o Chromium).

npm start compila i inicia Express servint el frontend de dist.

## Variables d'entorn

| Variable | Ús |
| --- | --- |
| PORT | Port HTTP (4174 per defecte). Render el proporciona automàticament. |
| HOST | Interfície d'escolta (0.0.0.0 per defecte). |
| TRUST_PROXY | Estableix 1 només darrere d'un proxy de confiança, com Render. |
| DB_PATH | Ruta de la base SQLite local; per defecte server-data/titanfit.db. |
| TURSO_DATABASE_URL | URL Turso (libsql://...). Si no existeix, s'utilitza SQLite local. |
| TURSO_AUTH_TOKEN | Secret obligatori amb la URL Turso; no s'inclou al frontend. |
| NODE_ENV | En production activa la cookie segura Secure. |
| BACKUP_DIR | Carpeta per a còpies locals fetes amb npm run backup; no fa còpies remotes de Turso. |

No hi ha credencials al frontend. La recuperació de contrasenya per correu encara no està configurada.
## Còpies de seguretat

Executa:

```sh
npm run backup
```

Es crea una còpia coherent de SQLite a `server-data/backups` (o a `BACKUP_DIR`). Conserva còpies fora del servidor i comprova periòdicament que es poden restaurar. No copiïs només el fitxer `.db` mentre el servidor és actiu: WAL pot contenir canvis encara no consolidats.

## Publicació

Render serveix el frontend compilat i l'API Express al mateix origen. Les dades persistents s'emmagatzemen a Turso, no al sistema de fitxers efímer de Render.

### Crear Turso i migrar la base local

1. Autentica el CLI amb turso auth login, crea una base buida amb turso db create titanfit, consulta la URL amb turso db show titanfit i crea un token amb turso db tokens create titanfit. Consulta el [CLI oficial de Turso](https://github.com/tursodatabase/turso-cli) i el [quickstart](https://github.com/tursodatabase/turso-docs/blob/main/quickstart.mdx).
2. Atura el servidor local per obtenir una còpia consistent. Conserva server-data/titanfit.db i fes una còpia privada fora del repositori.
3. A PowerShell, assigna DB_PATH, TURSO_DATABASE_URL i TURSO_AUTH_TOKEN com a variables només per a la sessió local; no les desis al codi ni a Git.
4. Executa primer npm run migrate:turso. El dry-run comprova la integritat SQLite, l'esquema, els índexs i que el destí no contingui dades. No escriu a Turso.
5. Només després de revisar l'informe, inicia la transferència explícitament amb npm run migrate:turso -- --apply --confirm-empty-remote. El procés copia totes les taules, files i fotos, verifica els recomptes i la integritat, i no modifica el fitxer local.

La migració rebutja taules remotes amb dades o esquemes incompatibles. Si s'interromp després d'escriure dades, no es pot repetir sobre aquell destí poblat: conserva l'origen i prepara un altre destí buit. Les files de sessió es copien, però els usuaris hauran d'iniciar sessió al domini nou perquè les cookies locals no s'hi envien.

### Connectar Render

El render.yaml configura pla Free, Node.js 22.22.0, npm install && npm run build, npm run server, /api/health, HOST=0.0.0.0 i TRUST_PROXY=1. En crear el servei, introdueix TURSO_DATABASE_URL i TURSO_AUTH_TOKEN com a secrets. En serveis existents, afegeix les variables manualment perquè Render només sol·licita les marcades sync: false durant la creació inicial ([referència de Blueprints](https://render.com/docs/blueprint-spec)).

Els serveis Render Free s'aturen per inactivitat i tenen disc efímer; Turso és per això el magatzem persistent ([límits oficials](https://render.com/docs/free)). No s'ha fet cap desplegament ni s'ha connectat cap compte Turso real.
## Integracions i límits pendents

- Encara falten el compte/base de dades Turso reals, els secrets de Render, la migració real després de revisar el dry-run i el desplegament.
- El progrés dels reptes és personal i deriva dels entrenaments. Els missatges del Marketplace encara no s'envien al venedor; es guarden com a notes personals.
- La recuperació de contrasenya per correu necessita un proveïdor de correu verificat.
- El catàleg d'exercicis, receptes, gimnasos i estimacions d'afluència són dades públiques de l'aplicació, no ocupació en temps real.