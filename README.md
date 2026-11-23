# Gestión del retiro

Aplicación web para organizar un retiro: **cartas** que las familias envían a los participantes (a un buzón de Gmail), **participantes** (datos, contacto de emergencia, alimentación y accesibilidad), **habitaciones** y **mesas**. El proyecto se llama **retreat-manager** (antes *retreat-mail-mcp · Cartas del retiro*).

**Cartas**

- Descarga las cartas de Gmail (solo lectura) y las guarda en una base de datos local con **sincronización incremental**.
- Decide **para quién es cada carta** a partir del asunto y del cuerpo (nunca del remitente ni de la firma) y deja en «Por revisar» las dudosas.
- Muestra cuántas cartas tiene cada participante, quién lleva más y quién menos (con empates) y qué ha llegado desde la última sincronización.
- Exporta e **imprime por lotes**: cada carta en su propia hoja (con «Para: …»), agrupadas por participante y en orden cronológico, con tipografía cuidada.

**Participantes, habitaciones y mesas**

- Fichas de participantes con los datos que necesita la organización, sin diagnósticos médicos, y borrado automático al terminar el retiro.
- Habitaciones y mesas con aforo, avisos (ronquidos, accesibilidad) y resumen de alergias por mesa para la cocina.

El panel **nunca lee Gmail directamente**: todo se lee de la base de datos local. Gmail solo se consulta al sincronizar, y solo para lo que ha cambiado.

---

> **¿Vas a instalarlo para un retiro y no eres programador?** Usa la app de escritorio: [Instalar el servidor](docs/INSTALACION-SERVIDOR.md) y, para los demás, la [guía para usuarios](docs/GUIA-USUARIOS.md) (entran desde el navegador, también en tablet y móvil).

## Índice

1. [Requisitos](#requisitos)
2. [Prueba rápida (modo demostración)](#prueba-rápida-modo-demostración)
3. [Arrancar, parar y reiniciar](#arrancar-parar-y-reiniciar)
4. [Instalación paso a paso](#instalación-paso-a-paso)
5. [MongoDB con Docker](#mongodb-con-docker)
6. [Configuración OAuth2 en Google Cloud](#configuración-oauth2-en-google-cloud)
7. [Uso del panel](#uso-del-panel)
8. [Gestión de participantes](#gestión-de-participantes)
9. [Cómo se asignan las cartas](#cómo-se-asignan-las-cartas)
10. [Adjuntos](#adjuntos)
11. [Exportación en lote](#exportación-en-lote)
12. [Impresión](#impresión)
13. [Sincronización incremental](#sincronización-incremental)
14. [Etiquetas de Gmail](#etiquetas-de-gmail)
15. [Configuración desde el panel](#configuración-desde-el-panel)
16. [Panel en la red local](#panel-en-la-red-local)
17. [Arquitectura hexagonal](#arquitectura-hexagonal)
18. [Tests](#tests)
19. [Privacidad, retención y borrado](#privacidad-retención-y-borrado)
20. [Variables de entorno](#variables-de-entorno)
21. [Solución de problemas](#solución-de-problemas)

---

## Requisitos

- **Node.js 22 o superior.**
- **MongoDB 7** (recomendado). La forma más sencilla es Docker o Podman con el `docker-compose.yml` incluido. Alternativa sin base de datos: `PERSISTENCE=json`.
- Una **cuenta de Gmail o Google Workspace** con el buzón que recibe las cartas, y acceso a Google Cloud Console para crear las credenciales OAuth.
- Un navegador moderno. Bootstrap y la fuente Inter (licencia SIL OFL) van incluidos en el proyecto (`vendor/`), así que **el panel funciona sin internet**; solo la sincronización necesita conexión.
- **Logo**: dos caminantes (los discípulos de Emaús), en `src/infrastructure/web/public/img/` (`logo.svg` para la barra y el acceso, `favicon.svg` para la pestaña). Los iconos PNG se regeneran con `node scripts/generate-icons.js`.

## Prueba rápida (modo demostración)

Sin Gmail ni base de datos: cartas ficticias en memoria que llegan en tres oleadas. La primera vez instala las dependencias sola.

```powershell
.\start.cmd --demo
```

En Linux, macOS o Git Bash: `./start.sh --demo`. Se abre <http://localhost:3000>. La primera oleada (23 cartas, 18 participantes) se carga al arrancar. Cada «Buscar cartas nuevas» trae la siguiente: +4 cartas, y después +3 y una borrada. La demo incluye empates, participantes sin cartas, una carta para varios destinatarios, una respuesta automática, una carta ambigua («Querida María:» con dos Marías), cartas con adjuntos y una carta cuyo remitente se llama como un participante.

Si arrancas sin `DEMO_MODE` y sin credenciales de Gmail, el panel muestra el botón **«Activar modo demostración»**.

También hay un recorrido por consola: `npm run demo:walkthrough`.

## Arrancar, parar y reiniciar

Todo se gestiona con un único comando: `start.cmd` en Windows (PowerShell o cmd) o `./start.sh` en Linux, macOS o Git Bash. Las acciones se pueden escribir como opción (`--stop`) o como palabra (`stop`).

| Comando | Qué hace |
|---|---|
| `.\start.cmd` | Arranca el panel **en segundo plano**, espera a que responda, muestra las direcciones y abre el navegador. Si `PERSISTENCE=mongo`, arranca antes MongoDB con Docker o Podman. |
| `.\start.cmd --install` | Comprueba Node.js, instala dependencias (`npm ci`), crea `.env` (con una contraseña de MongoDB aleatoria) y `data/participants.json`, y avisa de lo que falta. |
| `.\start.cmd --stop` | Para el panel y el contenedor de MongoDB. Los datos se conservan. Con `--keep-mongo` deja MongoDB en marcha. |
| `.\start.cmd --restart` | Reinicia el panel (MongoDB sigue en marcha). |
| `.\start.cmd --status` | Muestra si está en marcha, PID, direcciones, modo (Gmail o demo), base de datos y avisos de configuración. |
| `.\start.cmd --logs` | Últimas líneas del registro, legibles. `--follow` para seguirlo y `--lines 200` para ver más. |
| `.\start.cmd --auth` | Autoriza el acceso de solo lectura a Gmail (equivale a `npm run auth`). |
| `.\start.cmd --demo` | Arranca con datos de demostración. |
| `.\start.cmd --help` | Todas las opciones. |

Otras opciones: `--no-open` (no abrir el navegador), `--no-mongo` (no tocar MongoDB, por ejemplo si usas Atlas) y `--force` (con `--stop`, parar aunque el proceso no responda). El registro y el PID se guardan en `.run/`, que no se sube al repositorio. `npm start` sigue disponible para ejecutar el panel en primer plano.

## Instalación paso a paso

1. **Dependencias y archivos de configuración**

   ```powershell
   .\start.cmd --install
   ```

2. **Configuración**: revisa `.env` (cada valor está comentado). `--install` lo crea a partir de `.env.example`. Las rutas relativas se resuelven desde la carpeta del proyecto, no desde donde ejecutes el comando.

3. **Participantes**: se gestionan en el panel, en **Participantes** (ver [Gestión de participantes](#gestión-de-participantes)). Opcionalmente puedes partir de una lista en `data/participants.json` (la carpeta `data/` no se sube al repositorio), que se **importa una sola vez** cuando el retiro aún no tiene participantes. `--install` la crea a partir de `participants.example.json`:

   ```json
   [
     { "displayName": "María García", "aliases": ["Mari"] },
     { "displayName": "Juan Martínez", "aliases": ["Juanito"] },
     { "id": "alvaro-herrera", "displayName": "Álvaro Herrera" }
   ]
   ```

   - `id` es opcional; si falta se genera a partir del nombre (`maria-garcia`).
   - Los **alias** (apodos, diminutivos) también sirven para reconocer al destinatario.
   - Esa lista solo se importa la primera vez; después los participantes se gestionan en **Participantes**.

4. **Base de datos**: [MongoDB con Docker](#mongodb-con-docker), o `PERSISTENCE=json` para usar ficheros en `data/db/`.

5. **Gmail**: [crea las credenciales OAuth](#configuración-oauth2-en-google-cloud) y autoriza el acceso:

   ```powershell
   .\start.cmd --auth
   ```

6. **Arranca el panel** y pulsa «Buscar cartas nuevas»:

   ```powershell
   .\start.cmd
   ```

| Script | Para qué sirve |
|---|---|
| `.\start.cmd` · `./start.sh` | Arrancar, parar, reiniciar, estado, registro, instalar ([ver tabla](#arrancar-parar-y-reiniciar)). |
| `npm start` | Panel web y API en primer plano. |
| `npm run dev` | Igual, reiniciando al cambiar el código. |
| `npm run auth` | Autoriza el acceso de solo lectura a Gmail y escribe `token.json`. |
| `npm test` | Tests unitarios, de aplicación y de adaptadores. |
| `npm run db:purge` | Borra las cartas y los datos de sincronización (pide confirmación). |
| `npm run demo:walkthrough` | Recorre la demo por consola, sin servidor. |
| `node scripts/generate-demo-assets.js` | Regenera los adjuntos ficticios de la demo (ya incluidos en el repositorio). |
| `npm run seed:gmail` | Crea en tu buzón de Gmail un juego de 61 cartas de prueba ([ver Tests](#tests)). |

## MongoDB con Docker

El `docker-compose.yml` arranca **MongoDB 7**:

- solo en `127.0.0.1` (no es accesible desde la red);
- **con autenticación obligatoria**: usuario y contraseña de `MONGO_ROOT_USERNAME` y `MONGO_ROOT_PASSWORD` en `.env` (sin ellas no arranca);
- con los datos en el volumen `retreat_mongo_data`.

```powershell
docker compose up -d
docker compose ps
```

Espera a que aparezca `healthy`. Con Podman se usan los mismos comandos con `podman compose`.

`MONGODB_URI` debe usar esas credenciales, por ejemplo `mongodb://retreat_admin:tu-contraseña@127.0.0.1:27017`. Si la contraseña tiene caracteres especiales, codifícalos (`@` → `%40`). La base de datos se elige con `MONGODB_DB` (por defecto `retreat_mail`).

- **Parar** (conserva los datos): `docker compose down`.
- **Borrar también el volumen** (todas las cartas): `docker compose down -v`.
- **Atlas u otro servidor compatible**: basta con cambiar `MONGODB_URI` (`mongodb+srv://…`). El driver es el oficial.

Los índices se crean solos al arrancar. Se usan estas colecciones: `letters`, `participants`, `assignment_overrides`, `print_status`, `sync_state` y `sync_runs` (esta última con caducidad automática según `SYNC_RUNS_TTL_DAYS`).

**Alternativa sin MongoDB**: `PERSISTENCE=json` guarda ficheros en `data/db/`. Sirve para un solo proceso: si hay más de un proceso, usa MongoDB, porque el bloqueo de sincronización solo funciona entre procesos con Mongo.

## Configuración OAuth2 en Google Cloud

Por defecto la aplicación pide **un único permiso: `gmail.readonly`** (lectura). No puede enviar, borrar ni modificar correo. Solo si activas las [etiquetas de Gmail](#etiquetas-de-gmail) (`GMAIL_LABELS_ENABLED=true`), `npm run auth` pide en su lugar **`gmail.modify`**, el mínimo que permite leer y cambiar etiquetas de los mensajes (no envía ni borra correo definitivamente); añádelo en **Acceso a datos** y repite `npm run auth`.

1. Entra en <https://console.cloud.google.com/> con una cuenta que pueda administrar el proyecto y **crea un proyecto** (por ejemplo, «Cartas retiro»).
2. **APIs y servicios → Biblioteca** → busca **Gmail API** → **Habilitar**.
3. **Google Auth Platform** (pantalla de consentimiento de OAuth):
   - **Branding**: nombre de la aplicación y correo de asistencia.
   - **Audiencia**:
     - Si el buzón es de **Google Workspace** de tu organización, elige **Interno**. Es lo recomendable: los permisos no caducan.
     - Si es una cuenta **@gmail.com**, elige **Externo**, deja la app **en modo de prueba** y añade el buzón en **Usuarios de prueba**. En modo de prueba, Google **caduca la autorización cada 7 días**; habrá que repetir `npm run auth`.
   - **Acceso a datos**: añade el permiso `https://www.googleapis.com/auth/gmail.readonly`.
4. **Clientes → Crear cliente**: tipo **Aplicación de escritorio**. Descarga el JSON y guárdalo como **`credentials.json`** en la raíz del proyecto (o donde indique `GOOGLE_CREDENTIALS_PATH`).
5. Ejecuta:

   ```powershell
   npm run auth
   ```

   Se abre el navegador. Inicia sesión **con la cuenta del buzón de las cartas** y acepta. El script recibe la autorización en `127.0.0.1` (con PKCE), escribe **`token.json`** y muestra qué buzón ha quedado autorizado.

`credentials.json` y `token.json` están en `.gitignore`: **no los compartas**. El token se renueva solo y se guarda de forma atómica.

### Qué correos son cartas

`GMAIL_QUERY` admite **cualquier búsqueda de Gmail**, la misma que escribirías en el buscador. Las familias solo necesitan **una dirección normal**: no hace falta usar «+», alias ni etiquetas.

- **Recomendado: un buzón dedicado**. Crea una cuenta solo para el retiro, por ejemplo `cartas.retiro.2026@gmail.com`, y pon `GMAIL_QUERY=to:cartas.retiro.2026@gmail.com`. Así se recogen todos los correos que reciba, aunque alguien los archive. Es la opción más sencilla para las familias y la más segura para la privacidad, porque la aplicación no ve otro correo.
- **Desde una fecha, sea quien sea el remitente**: pon `GMAIL_START_DATE=2026-11-01` (formato `AAAA-MM-DD`) y deja `GMAIL_QUERY` vacío. Se leen todos los correos recibidos **desde ese día incluido**, a las 00:00 de tu zona horaria (`TZ`). Es mejor que `after:` dentro de `GMAIL_QUERY`, porque Gmail interpreta esas fechas en hora del Pacífico y podría dejar fuera las cartas de primera hora. Se puede combinar con `GMAIL_QUERY` o `GMAIL_LABEL_ID`.
- **Si comparte buzón con otros correos**, filtra también por contenido. Por ejemplo `GMAIL_QUERY=subject:carta` junto a `GMAIL_START_DATE`, o `GMAIL_QUERY=-category:promotions -category:social` para descartar publicidad y redes sociales.
- **Con etiqueta** (opcional): crea en Gmail un filtro que aplique una etiqueta (por ejemplo `cartas-retiro`) según el destinatario o el asunto, y pon `GMAIL_QUERY=label:cartas-retiro`. También puedes etiquetar a mano.
- **`GMAIL_LABEL_ID`**: el id interno de una etiqueta (`Label_123…`). Si se configura, se ignora `GMAIL_QUERY`.

En cualquier caso se descartan los borradores, el spam, la papelera y los mensajes enviados desde el propio buzón. Comprueba la búsqueda en Gmail antes de sincronizar: lo que devuelva el buscador es lo que se tratará como cartas.

**Al cambiar el filtro** (`GMAIL_QUERY`, `GMAIL_LABEL_ID` o `GMAIL_START_DATE`) basta con reiniciar el panel (`.\start.cmd --restart`). La siguiente sincronización será **completa automáticamente**: recoge los correos antiguos que ahora sí entran y retira del panel los que ya no cumplen el filtro. El aviso lo indica: «Sincronización completa automática: ha cambiado el filtro de Gmail».

## Uso del panel

**Menú**: arriba hay una entrada por módulo, **Cartas** (con el número de cartas por revisar) y **Participantes**. Cada módulo agrupa sus opciones en pestañas: *Cartas* → Panel, Por revisar e Historial; *Participantes* → Participantes, Habitaciones y Mesas.

**Móvil y tablet**: el panel se adapta a móvil, tablet (vertical y horizontal) y escritorio. En tablet vertical el menú sigue visible y «Buscar cartas nuevas» pasa a «Más opciones»; las tablas muestran las columnas principales y la ficha de cada participante tiene todos los datos; en pantallas táctiles los botones, chips y casillas son más grandes.

**Barra superior**

- Estado del correo («Al día», «Buscando…», «Con error») y «Última búsqueda: hace 5 min».
- **Buscar cartas nuevas** trae solo lo nuevo. En **Más opciones**: **Volver a leer todo el buzón…** (sincronización completa, con confirmación) y **Volver a repartir las cartas…** (recalcula los destinatarios con la lista actual de participantes; respeta siempre las asignaciones manuales y normalmente no hace falta, porque se hace solo al cambiar participantes).
- Los botones se desactivan durante una búsqueda y durante la pausa mínima entre búsquedas (`SYNC_MIN_INTERVAL_SECONDS`). Al terminar aparece un aviso: «3 cartas nuevas · 1 actualizada · 0 eliminadas».
- Si la última búsqueda falló, aparece un aviso fijo: *«La última sincronización falló; se muestran los últimos datos guardados»*.

**Panel: tres pasos**. Arriba, lo que hay que hacer y en qué orden:

1. **Recibir**: cartas recibidas, cuándo fue la última búsqueda y el botón **Buscar cartas nuevas**.
2. **Revisar**: cuántas cartas necesitan ayuda (o «Todo revisado») y el acceso a **Por revisar**.
3. **Imprimir**: participantes pendientes y cartas por imprimir, con **Imprimir pendientes** (abre la impresión de todos los pendientes que tienen cartas).

Debajo, una sola línea con quién lleva más cartas, quién no tiene ninguna (en rojo) y las cartas sin ver.

**Cartas por participante**

- Búsqueda por nombre o apodo y filtros de un clic: todos, pendientes de imprimir, impresas, con novedades, sin cartas y con avisos.
- Orden alfabético o por número de cartas, y menú **Seleccionar** (pendientes de imprimir, con cartas, todos o ninguno).
- Insignias: número de cartas, «+N nuevas», avisos y estado de impresión (pulsa para cambiar entre *Pendiente* e *Impresa*).
- Al seleccionar aparece abajo la barra de acciones: **Imprimir** (acción principal), **Exportar** (paquete .html, PDF de adjuntos, .txt, .json) y **Opciones** (incluir adjuntos, formato original del correo).

**Novedades**: lo que el equipo aún no ha visto, agrupado por participante, con «Marcar todas como vistas» o por participante.

**Ficha de participante**: cartas en orden cronológico con remitente, fecha, asunto, cuerpo completo (con párrafos, tildes, ñ y emojis), avisos y adjuntos.

- **Cartas plegadas**: para que la pantalla sea más sencilla, cada carta aparece cerrada, con asunto, remitente, etiquetas y una línea de vista previa. Pulsa el asunto para abrirla o cerrarla, o usa **Abrir todas / Cerrar todas** (también en «Por revisar»). Las imágenes y los PDF solo se cargan al abrir la carta. Lo que abras sigue abierto al recargar la lista, y al imprimir el panel con Ctrl+P se imprimen todas completas.

- Cada carta lleva una etiqueta que dice cómo se asignó: *Asunto*, *Cuerpo*, *Mención* o *Manual*. Al pasar el ratón se ve el texto que coincidió.
- Botones *Imprimir*, *Exportar* y *Reasignar…*.
- Filtro «Mostrar cartas posteriores al día…», exclusivo y en la zona horaria configurada.

**Por revisar**: cartas que no se han podido asignar con seguridad. Muestra la carta, los participantes sugeridos como botones (un clic asigna), **Asignar…** (elegir uno o varios) y **Dejar sin asignar**. Estas cartas no cuentan para nadie hasta que se asignan, y nunca se descartan.

- Debajo, la sección **Sin asignar** reúne las cartas que se dejaron sin asignar, con **Asignar…** y **Volver a automático**. Así se pueden recuperar en cualquier momento.

**Participantes nuevos** (las cartas llegan poco a poco y puede aparecer alguien que no estaba en la lista): en el diálogo **Asignar…**, pulsa **«+ Añadir participante nuevo»**. Si buscas un nombre que no existe, el diálogo también ofrece «Añadir «nombre» como participante».

- Escribe el nombre y el primer apellido (y, si quieres, el segundo y apodos). Queda marcado para esa carta; pulsa **Asignar** para confirmar.
- Es un **alta rápida**: el participante queda como **ficha incompleta** hasta que completes su edad y su contacto de emergencia en **Participantes**.
- Al añadirlo se recalculan las asignaciones: las cartas pendientes que lo nombran se le asignan solas. Las decisiones manuales, incluidas las cartas dejadas sin asignar, no se tocan.
- No se admite un nombre o apodo que ya tenga otro participante (sin distinguir tildes ni mayúsculas).

- Al final de «Por revisar», la sección **Participantes dados de baja** reúne las cartas de quienes ya no están en el retiro.

**Historial de sincronizaciones**: fecha, tipo, resultado, duración, cartas nuevas, actualizadas y eliminadas, y el error si lo hubo.

**Avisos** (solo informan, nunca descartan una carta): *Respuesta automática*, *Envío masivo*, *Error de entrega*, *Solo firma*, *Solo adjuntos*, *Varios destinatarios* y *Con adjuntos*.

## Gestión de participantes

El apartado **Participantes** es la **fuente única** de participantes del retiro: lo usan las cartas y lo usarán los futuros módulos (habitaciones, mesas, cocina, accesibilidad). La lista de `PARTICIPANTS_FILE` solo se importa una vez, cuando el retiro todavía no tiene participantes; después ya no se lee y los cambios se hacen en el panel.

- **Listado** con búsqueda (nombre, apodo, teléfono, correo o número de documento), filtros (activos, fichas incompletas, alimentación, accesibilidad, roncan, dados de baja, sin habitación, sin mesa, asistencia confirmada o no) y filtro por **mesa** (una mesa concreta o «Sin mesa»).
- **Ordenar por columnas**: pulsa la cabecera de Nombre, Asistencia, Edad, Habitación, Mesa o Cartas; otra pulsación invierte el orden (▲/▼). Los vacíos van siempre al final.
- **Exportar a Excel**: descarga un `.xlsx` con los participantes que se ven en ese momento (misma búsqueda, filtro, mesa y orden; sin filtros, todos). Incluye nombre y apellidos, estado, asistencia, edad, nacionalidad, contacto, contacto de emergencia, habitación y cama, mesa, ronca, alimentación, accesibilidad, apoyos, observaciones, cartas y si la ficha está completa, más una hoja «Información» con los criterios usados. **No incluye el documento de identidad.** Se genera al momento y no se guarda en el servidor; trátalo con cuidado porque contiene datos de salud.
- **Ficha** de cada participante y botón **Ver cartas**.
- **Alta y edición**. Son obligatorios el **nombre**, el **primer apellido**, la **edad o la fecha de nacimiento** y **una persona de contacto para emergencias** (nombre y teléfono; se puede añadir una segunda). El resto es opcional: segundo apellido, apodos, teléfono, correo (nunca se usa para las cartas), si ronca, alimentación, accesibilidad, apoyos y observaciones.
- **Nacionalidad** (opcional): el país, elegido de la lista o escrito a mano. Se ve en la ficha, se puede buscar y sale en el Excel.
- **Documento de identidad** (opcional): **DNI**, **NIE** (extranjeros residentes en España), **pasaporte** u **otro documento** (por ejemplo, la cédula de otro país), con su número y, para pasaporte u otro, el país de expedición. El número se guarda en mayúsculas y sin espacios ni guiones; en DNI y NIE se comprueba la letra de control. No puede haber dos participantes con el mismo documento, y se puede buscar por su número. Solo se muestra en la ficha y el formulario (nunca en listados ni exportaciones) y se borra con el retiro.
- **Alimentación**: los 14 alérgenos de declaración obligatoria, intolerancias y dietas, con gravedad (*leve* o *grave, puede requerir medicación de urgencia*) y «otra» con detalle.
- **Accesibilidad**: necesidades **prácticas** (movilidad reducida, habitación accesible, evitar escaleras, ayuda en desplazamientos…) y los apoyos necesarios durante el retiro. **No se piden diagnósticos.**
- **Asistencia**: cada participante está *Sin confirmar* o *Confirmada* (con la fecha). Se cambia en un clic desde la columna «Asistencia» del listado o desde la ficha («Confirmar asistencia»), o en el formulario. Hay filtros «Asistencia confirmada» y «Sin confirmar», y el listado muestra cuántos han confirmado. No se puede confirmar a alguien dado de baja.
- **Dar de baja**: el participante sale del panel y de los lotes de impresión, pero sus cartas se conservan con la marca **«No está en el retiro»** (en «Por revisar» → «Participantes dados de baja»). Se puede reactivar.
- **Eliminar**: solo si no tiene cartas asignadas; si las tiene, dalo de baja.
- **Identificador estable**: si cambias el nombre, el identificador no cambia; cartas, impresión y asignaciones manuales siguen enlazadas.
- Al registrar a alguien o cambiar su nombre o apodos, **se recalculan las asignaciones** (respetando siempre las manuales): las cartas pendientes que lo nombran se le asignan solas.
- **Datos que venían de versiones anteriores**: los participantes guardados solo con «nombre completo» se separan automáticamente en nombre y apellidos. Si el reparto es dudoso (tres o más palabras, como «José Ignacio Sanz»), la ficha lo indica para revisarlo. Mientras tanto, se reconocen solo por el nombre completo, como antes.

### Habitaciones y mesas

En **Participantes → Habitaciones / Mesas** se crean las habitaciones (nombre, camas, planta, accesible, sin escaleras) y las mesas (nombre, plazas, **líder y colíder de mesa**). Con «Crear varias numeradas» se crean de una vez, por ejemplo «Habitación 1» a «Habitación 20».

- **Asignar**: desde la tarjeta de cada habitación o mesa («Añadir a…», con quien aún no tiene), o desde la ficha del participante (sección **Habitación y mesa**, con cama opcional). Cada participante tiene **una habitación y una mesa fija** para todo el retiro.
- **Aforo**: una habitación o mesa completa no admite a nadie más. Una con personas no se puede eliminar.
- **Disponibilidad de habitaciones**: cada tarjeta lleva un color según su estado. Verde es **vacía**, ámbar es **con camas libres** (por ejemplo «1 cama libre» en una doble con una persona), gris es **completa** y rojo es más personas que camas. Arriba hay un resumen con el total de camas libres.
- **Filtros de habitaciones**: por **planta**, por **número de camas** y por disponibilidad (Todas, Vacías, Con camas libres, Completas). Se mantienen al asignar o editar.
- **Avisos** (informan, no bloquean): si comparten habitación quien ronca y quien no, si alguien que necesita habitación accesible o evitar escaleras no la tiene, o si hay más personas que plazas.
- **Líder y colíder de mesa**: son **servidores**, no participantes, así que no ocupan plaza ni salen en las listas de participantes. Se indican con nombre y teléfono opcional al crear o editar la mesa, y la tarjeta los muestra; si falta alguno, la mesa lo avisa. Se borran con el retiro.
- **Cocina**: cada mesa resume las alergias, intolerancias y dietas de quienes se sientan en ella, con las graves en rojo.
- El listado de participantes muestra su habitación y su mesa, con filtros «Sin habitación» y «Sin mesa».
- **Dar de baja o eliminar** a un participante libera su habitación y su mesa. Al cerrar el retiro se borran también habitaciones, mesas y asignaciones.

### Retiro y borrado automático

Todo pertenece a un **retiro** (de momento, uno activo). En **Participantes → Editar datos del retiro** se indican su nombre y su primer y último día.

- **Borrado automático**: `RETREAT_RETENTION_DAYS` días después del último día (30 por defecto), se borran **todos los datos personales** del retiro: participantes (con alergias, necesidades y contactos de emergencia), habitaciones, mesas y asignaciones, cartas, asignaciones, estado de impresión, historial de sincronización, caché de adjuntos y archivos exportados. Del retiro solo quedan su nombre, sus fechas y los totales, y empieza un retiro nuevo vacío.
- Desde que termina el retiro, el panel muestra un **aviso** con la fecha de borrado.
- **Cerrar retiro…** permite borrarlo antes, escribiendo su nombre para confirmar.
- Las cartas recibidas antes del cierre **no se vuelven a importar**.
- **Gmail no se toca** (permiso de solo lectura): borra allí los correos del retiro.

## Cómo se asignan las cartas

Las escriben familiares, así que **el nombre del remitente y la firma nunca indican el destinatario**.

1. Se normaliza el texto (minúsculas, sin tildes) y se quitan las citas de respuestas («El … escribió:», líneas con `>`), las cabeceras de reenvío y las firmas (por ejemplo, «Enviado desde mi iPhone» o lo que va tras «Un beso,»).
2. Se buscan señales:
   - **Asunto** (0,95): «Carta para X», «Para: X», «[Para: X]».
   - **Cuerpo** (0,85), en los primeros `BODY_SCAN_CHARS` caracteres: «Querido/a X», «Hola X», «Mi querida X», «Carta para X», o una línea de saludo que termina en «:» o «,».
   - **Mención** (0,30): el nombre completo o un alias en otra parte del texto.
3. Se compara con los participantes del retiro: nombre completo, apodos, nombre de pila y **variantes** del nombre registrado. Para «José Antonio García López» valen «José García», «José Antonio García», «José A. García» y «José García López» (sin distinguir mayúsculas ni tildes, y con apellidos compuestos o con guion). **Un nombre o una variante que comparten dos o más participantes es ambiguo** y nunca se asigna solo.
   - **Contradicción de apellido**: si tras un nombre aparece un apellido que no es de ese participante («Carta para José Pérez» cuando el único José es José García), la carta va a **Por revisar** con la sugerencia, en vez de asignarse.
   - **Nombres parecidos**: si el nombre escrito tiene una errata («José Garcai», «Luis Perila»), el participante más parecido aparece el primero entre las sugerencias, con la etiqueta *Nombre parecido*. Nunca se asigna solo por parecido.
   - **Destinatario detectado**: en «Por revisar» se muestra el nombre escrito tras «Carta para…», «Querido…» o en el saludo, aunque no coincida con nadie. Si trae nombre y apellido y no existe, el botón **Crear participante «…»** abre el alta rápida ya rellena.
4. Se asigna automáticamente si un único participante supera `ASSIGNMENT_MIN_CONFIDENCE` (0,75) y nadie más queda a menos de 0,15. Si hay varios nombrados explícitamente, la carta es para todos («Varios destinatarios»). En cualquier otro caso va a **Por revisar** con sugerencias ordenadas.
5. Las **asignaciones manuales** siempre ganan: se guardan por mensaje y sobreviven a nuevas sincronizaciones y a «Volver a repartir las cartas».

## Adjuntos

La mayoría de las cartas llegan como texto, pero algunas traen una foto o un escaneo, un PDF o un Word. Los adjuntos **no se descargan al sincronizar**: se guardan solo sus datos (nombre, tipo y tamaño) y el archivo se pide a Gmail **la primera vez que alguien lo abre**. Después queda en caché en `CACHE_DIR/attachments/`. Las cartas nunca se guardan en disco; solo los adjuntos.

| Tipo | Qué se ve en el panel | Al imprimir o exportar en HTML |
|---|---|---|
| Imagen JPEG, PNG, WEBP, GIF o HEIC | Miniatura; al pulsarla, a tamaño completo. Se corrige la orientación EXIF y se eliminan los metadatos (GPS…). | La imagen se incrusta en la carta. |
| Imagen incrustada (`cid:`) | Aparece **dentro del texto**, donde estaba el marcador `[cid:…]`. | Igual, en su sitio. |
| PDF | Tarjeta con **«Abrir PDF»** y **«Vista previa»**. | Nota «PDF adjunto (imprímelo aparte)». |
| Word (`.docx`) | Su **texto se muestra como parte de la carta** (convertido con mammoth, siempre como texto). | El texto se imprime con la carta. |
| Otros (vídeo, zip, `.doc`…) | Tarjeta **«Adjunto no imprimible»** con botón de descarga. | Nota con el nombre. |
| SVG, ejecutables, scripts, HTML, documentos con macros | **Bloqueados**: ni se procesan ni se descargan. | Nota «bloqueado por seguridad». |

- **Seguridad**:
  - Además del tipo declarado se comprueba el contenido real del archivo. Si no coincide (por ejemplo, un `.png` que en realidad es un ejecutable), solo se puede descargar como binario y nunca se procesa.
  - Los adjuntos se sirven con cabeceras que impiden ejecutar nada.
  - No se procesan archivos de más de `MAX_ATTACHMENT_MB` (15 MB por defecto).
- **Exportar con adjuntos**: en la barra de lote y en la ficha del participante hay un interruptor **«Incluir adjuntos»**, activado por defecto. En el `.html` exportado las imágenes van incrustadas, así que el archivo funciona sin conexión.
- **HEIC (fotos de iPhone)**:
  - El `sharp` que se instala con npm no incluye el decodificador HEVC, por motivos de patentes. Las fotos HEIC muestran entonces «No se ha podido mostrar la imagen» con un botón para descargar el original.
  - Para convertirlas hay que instalar libvips con libheif y soporte HEVC y compilar sharp contra ella (consulta la documentación de sharp). Otra opción es pedir a las familias que envíen las fotos en JPEG (en el iPhone: Ajustes → Cámara → Formatos → «Más compatible»).
- **Sin conexión con Gmail**: los adjuntos se listan, pero no se pueden abrir.

## Exportación en lote

1. En el directorio, **selecciona** participantes (por ejemplo, «Seleccionar pendientes de imprimir»).
2. En la barra inferior elige el formato:
   - **Exportar .html**: paquete listo para imprimir. **Cada carta va en su propia hoja** (o grupo de hojas, si es larga), con «Para: Nombre» arriba para poder entregarla suelta. Las cartas se agrupan por participante en orden cronológico, y los estilos van incluidos en el propio archivo.
   - **Exportar .txt**: texto plano UTF-8, con un salto de página (`\f`) entre participantes.
   - **Exportar .json**: datos estructurados (para otros programas).
   - **PDF de adjuntos**: **un solo PDF con todos los PDF adjuntos** de las cartas seleccionadas, en el mismo orden que el paquete (participantes por nombre, cartas por fecha). Así no hay que abrir e imprimir cada PDF por separado. Ver [PDF de adjuntos](#pdf-de-adjuntos).
3. El archivo se descarga y además queda guardado en `EXPORT_DIR` con un nombre generado por el servidor, por ejemplo `cartas_lote-12_20261121-093000.html` o `cartas_maria-garcia_…`.
4. El panel pregunta **«¿Marcar como impresos?»**. Si aceptas, esos participantes pasan a *Impresa* con fecha. Se puede deshacer desde el directorio.

Desde la ficha de un participante, «Exportar» hace lo mismo solo para esa persona. Una carta para varios destinatarios aparece en la sección de cada uno.

### PDF de adjuntos

Las cartas que llegan con un PDF adjunto no se pueden incrustar en el paquete HTML, que solo lo anota como «PDF adjunto (imprímelo aparte)». El botón **«PDF de adjuntos»** (barra inferior, y «Exportar → PDF de adjuntos» en la ficha) los une todos en un único archivo listo para imprimir: `adjuntos_<participante o lote>_<fecha>.pdf`.

- Cada página lleva un pie pequeño: «Para: Nombre · De: Remitente · archivo.pdf (página/total)», para entregar cada hoja a quien corresponde.
- Se respeta el tamaño y la orientación de cada página original.
- Las fotos y los documentos Word no se repiten aquí, porque ya se imprimen dentro de las cartas.
- Si un PDF no se puede unir (protegido con contraseña, dañado o que no es realmente un PDF), en su lugar va una página que lo explica, para que nada se pierda sin aviso.
- Si las cartas seleccionadas no tienen ningún PDF, el panel lo indica y no genera archivo. Esta exportación no pregunta si marcar como impresos.

## Impresión

- **Imprimir lote** (barra inferior) o **Imprimir** (ficha) abre una pestaña con el paquete y lanza el diálogo de impresión del navegador.
- **Cada carta empieza en una hoja nueva** y nunca comparte página con otra; si es larga, ocupa las hojas que necesite. Al imprimir solo salen las cartas: el nombre del participante y el número de cartas se ven en pantalla, pero no en papel (cada carta ya lleva «Para: …»).
- Cada carta lleva arriba «Para: Nombre», así que se puede entregar suelta.
- **Formato original**: si el correo se escribió con colores, fuentes, tamaños, negritas o alineación (por ejemplo, desde Gmail web u Outlook), la carta se imprime **con ese mismo aspecto**, y las imágenes insertadas en el texto salen en su sitio. Si el correo es solo texto (habitual desde el móvil), se imprime con la tipografía del paquete. El interruptor **«Formato original»** (barra de lote y ficha del participante, activado por defecto) permite imprimir o exportar todas con el mismo formato. Afecta a la impresión y al `.html`; el `.txt` y el `.json` llevan siempre el texto.
  - **Seguridad**: el HTML del correo se filtra al sincronizar y otra vez al imprimir, con una lista cerrada de etiquetas y estilos. Solo quedan colores, fuentes, tamaños, énfasis, alineación, sangrías, listas, tablas e imágenes adjuntas (`cid:`). Se eliminan scripts, enlaces, imágenes remotas (que podrían rastrear a quien lee), `url()`, posicionamiento y hojas de estilo. Solo la página de impresión admite atributos `style` en línea; el resto del panel mantiene la política estricta.
  - Las cartas ya descargadas obtienen su formato con **Volver a leer todo el buzón**. Los estilos definidos en hojas de estilo (`<style>`), que usan algunos programas, no se conservan.
- La cabecera de cada carta nunca queda separada de su texto. Se usa tipografía con serifa a 11–12 pt e interlineado amplio, y las imágenes se ajustan al ancho.
- Desactiva en el navegador «Encabezados y pies de página» y usa márgenes predeterminados y papel A4.
- Al imprimir el panel directamente (Ctrl+P), se ocultan la navegación, los botones, las casillas y el widget de sincronización.

## Sincronización incremental

- **Primera vez, o «Sincronización completa»**: se anota el punto actual del buzón (`historyId`) **antes** de listar todos los mensajes de la búsqueda. Así, lo que llegue mientras se descarga se recoge en la siguiente sincronización.
- **Incremental**: se piden a Gmail solo los cambios desde ese punto (`users.history.list`, todas las páginas) y se descargan únicamente los mensajes nuevos.
- **Seguridad del cursor**: el punto guardado **solo avanza cuando las cartas ya están guardadas**. Si algo falla, se conserva el anterior, el estado queda como *Con error* y el panel sigue mostrando los últimos datos buenos. Si Gmail dice que el punto guardado ya no vale, se hace una sincronización completa automáticamente.
- **Cambio de filtro**: el punto guardado recuerda con qué filtro se obtuvo (`GMAIL_QUERY`, `GMAIL_LABEL_ID`, `GMAIL_START_DATE`). Si el filtro ha cambiado, la siguiente sincronización es completa aunque se pida incremental. El resultado lo indica en `fullSyncReason` (`requested`, `first-sync`, `cursor-expired` o `selection-changed`).
- **Sin duplicados**: las cartas se guardan por id de mensaje, así que repetir la misma sincronización no duplica nada. Las cartas borradas en Gmail se marcan como borradas (no se eliminan) y dejan de contar.
- **Novedades**: cada carta guarda cuándo se vio por primera vez y si el equipo ya la ha visto.
- **Nunca se pierden** las asignaciones manuales ni el estado de impresión al sincronizar.
- **Una sola sincronización a la vez**, aunque la lancen el panel y la sincronización automática: hay un bloqueo en la base de datos y una pausa mínima entre sincronizaciones.
- **Sincronización automática**: `SYNC_INTERVAL_MINUTES` > 0. Solo la programa el panel web.
- Reintentos con espera exponencial ante límites de Gmail (429) o errores temporales (5xx), y descargas en paralelo limitadas (`GMAIL_CONCURRENCY`).

## Etiquetas de Gmail

Opcional (`GMAIL_LABELS_ENABLED=true`, desactivado por defecto). La base de datos sigue siendo la fuente de verdad: la aplicación refleja en Gmail a quién pertenece cada correo y si ya se imprimió.

- **Una etiqueta por participante**: por defecto solo el nombre (`María García`). Si quieres agruparlas, pon un prefijo opcional en `GMAIL_LABEL_PREFIX` (con `Retiro` quedan como `Retiro/María García`). Y una etiqueta **`Impreso`** (`GMAIL_PRINTED_LABEL`). Se reutilizan si ya existen (Gmail no distingue mayúsculas) y nunca se duplican, ni siquiera si otro proceso las crea a la vez.
- **Etiqueta padre y subetiquetas**: si pones un prefijo (por ejemplo `Retiro`), la aplicación crea esa etiqueta en Gmail como **etiqueta padre** y cuelga de ella una **subetiqueta** por participante (`Retiro` → `María García`, `Juan Pérez`…). Si cambias o quitas el prefijo, las antiguas se borran y la etiqueta padre vieja también, siempre que se quede vacía.
- **Impreso en verde**: la etiqueta de impresas se crea de color verde en Gmail (y si ya existía con otro color, se pone verde la primera vez que se usa).
- **Renombrar**: si cambias el prefijo o el nombre de la etiqueta de impresas en Configuración, las etiquetas antiguas se quitan de los correos, se ponen las nuevas y las antiguas se **borran de Gmail** cuando ya nadie las usa. Solo se borran etiquetas que la propia aplicación había puesto.
- **Cuándo se aplican**: tras cada sincronización del buzón, al asignar o reasignar una carta, al marcarla o desmarcarla como impresa y al exportar «marcando como impresas». También a mano: `POST /api/mail/labels/sync` (`{ "force": true }` reaplica todo).
- **Idempotente**: se guarda qué etiquetas tiene cada mensaje (`mail_label_states`: etiquetas, impreso, fecha de sincronización, usuario y último error). Una segunda sincronización sin cambios no llama a Gmail; si una carta cambia de participante, se quita la etiqueta anterior y se pone la nueva. Si un mensaje falla, queda el error guardado y se reintenta en la siguiente pasada.
- **Solo cartas asignadas** reciben etiqueta; las que están «Por revisar» esperan a que alguien las asigne. Una carta para varios participantes lleva todas sus etiquetas y `Impreso` cuando está impresa para todos.
- **Auditoría** (`audit_log`, siempre activa): quién (cabecera `X-Actor`, o `staff` si no se envía; `sync` en las automáticas), cuándo y qué cambió en cada carta. Consulta: `GET /api/mail/audit?messageId=…`.
- **Consulta y filtros**: `GET /api/mail?participantId=&label=&sender=&from=YYYY-MM-DD&to=YYYY-MM-DD&printed=true|false&hasAttachments=true|false&limit=&offset=`. Cada mensaje indica sus etiquetas, si Gmail está al día y el último error.
- **Marcar a mano**: `POST /api/mail/:messageId/printed` con `{ "printed": true|false }`; la corrección de participante usa los endpoints de revisión (`/api/review/:messageId/assign`).
- **Errores claros**: credenciales caducadas (`GMAIL_AUTH_ERROR`), permiso insuficiente (`GMAIL_INSUFFICIENT_PERMISSIONS`, repite `npm run auth` con las etiquetas activadas) y red o cuota (`GMAIL_UNAVAILABLE`). Un fallo de etiquetas nunca estropea el cambio guardado en la base de datos.

## Configuración desde el panel

El menú **Configuración** permite cambiar y guardar sin editar `.env`: las etiquetas de Gmail (activar, prefijo opcional, nombre de la etiqueta de impresas), qué correos se leen (búsqueda, día de inicio, id de etiqueta), el ritmo de descarga y el intervalo de la sincronización automática.

- Se guarda en `data/settings.json` y **tiene prioridad sobre `.env`**. Borrar ese archivo devuelve los valores de `.env`.
- Se aplica al guardar, sin reiniciar (no se puede mientras hay una sincronización en curso). El intervalo automático (y todo en modo demostración) se aplica al reiniciar: la pantalla lo avisa con los campos afectados y un botón **Reiniciar ahora**, que solo está disponible si la aplicación se arrancó con `start.cmd` / `start.sh`; si no, hay que pararla y arrancarla a mano.
- Debajo de cada campo se ve su valor por defecto, y el botón **Valores por defecto** rellena el formulario con ellos (no se guardan hasta pulsar Guardar).
- No incluye secretos: el código de acceso, la base de datos y las credenciales de Google siguen en `.env`.
- Si activas las etiquetas y el acceso a Gmail es de solo lectura, el panel avisa de que hay que ejecutar `npm run auth`.

## App de escritorio (servidor)

Para usuarios finales, el servidor se distribuye como una aplicación de Windows (Electron) que arranca el servidor dentro de la propia app: sin Node.js, sin MongoDB y sin terminal. Los demás dispositivos entran con el navegador. Guías: [instalar el servidor](docs/INSTALACION-SERVIDOR.md) y [usuarios](docs/GUIA-USUARIOS.md).

- Datos en `%APPDATA%\Retreat Manager\server` (`RETREAT_HOME`), en archivos JSON por defecto. Un `.env` en esa carpeta tiene prioridad (por ejemplo `PERSISTENCE=mongo` y `MONGODB_URI`, o `PORT`).
- Escucha en la red local con un código de acceso generado la primera vez; la dirección para los demás aparece en el título de la ventana, en una notificación al arrancar y en **Archivo → Cómo entran los demás**.
- **Archivo → Conectar con Gmail** hace lo mismo que `npm run auth`, eligiendo `credentials.json` con un diálogo.
- Registro en `server\logs\servidor.log`.

```powershell
npm run desktop
```

```powershell
npm run dist
```

```bash
./scripts/build-desktop.sh all
```

`npm run desktop` la abre sin empaquetar. `npm run dist` genera en Windows `dist\RetreatManager-Setup-<versión>.exe`, y `npm run dist:linux` en Linux genera el `.deb` y el `.AppImage`. `scripts/build-desktop.sh` genera los de Linux y Windows desde un Linux con Docker, dentro de la imagen oficial `electronuserland/builder:wine`, sin necesitar Node.js, Wine ni 7-Zip en el equipo. Con `RETREAT_DESKTOP_DATA=<carpeta>` usa otra carpeta de datos (para probar sin tocar los datos reales). El paso del instalador usa 7-Zip, que algunas políticas de seguridad corporativas bloquean: en ese caso genera el instalador en un equipo sin esa restricción.

## Panel en la red local

Para usar el panel desde otros dispositivos del retiro (por ejemplo, una tableta en secretaría):

1. En `.env`, pon `HOST=0.0.0.0` y un **`ACCESS_TOKEN`** de al menos 16 caracteres. **Sin él, la aplicación no arranca.**

   ```powershell
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```

2. Al arrancar, el registro muestra las direcciones disponibles (`http://192.168.1.20:3000`, …) y un aviso claro de que el panel está **expuesto en la red local**.
3. En Windows, permite Node.js en el cortafuegos **solo para redes privadas**.
4. Cada persona entra con el código de acceso. La sesión dura 30 días en una cookie protegida que no contiene el código.

El panel usa **HTTP sin cifrar**: úsalo solo en una red de confianza (nunca en una wifi abierta) y vuelve a `HOST=127.0.0.1` al terminar.

## Arquitectura hexagonal

```
             ┌───────────────────────────── infraestructura ─────────────────────────────┐
             │  web (Express + UI)   gmail   persistence (mongo | json)                   │
             │  rendering (html/txt/json)   logging (pino)   maintenance (db:purge)       │
             └───────────────┬───────────────────────────────────────────┬───────────────┘
                             │ usa casos de uso                          │ implementa puertos
             ┌───────────────▼──────────────── aplicación ───────────────▼───────────────┐
             │  casos de uso: SyncMailbox, GetDashboardOverview, ReviewAssignment, …      │
             │  puertos: MailSource, LetterStore, SyncState, Participant, PrintStatus,   │
             │           AssignmentOverride, ExportRenderer, ExportStorage, Logger, Clock│
             └───────────────────────────────┬───────────────────────────────────────────┘
                                             │ usa
             ┌───────────────────────────────▼──────────────── dominio ──────────────────┐
             │  entidades: Participant, Letter, Assignment, SyncState, SyncRun, …         │
             │  servicios puros: assignment, heuristics, counting, grouping, syncDiff, …  │
             └────────────────────────────────────────────────────────────────────────────┘
```

- **Módulos**: el código de cartas sigue en `src/{domain,application,infrastructure}`. Los módulos nuevos van en `src/modules/<módulo>/{domain,application,infrastructure}`: `src/modules/participants` (Retreat, ParticipantRecord, catálogos, casos de uso, repositorios Mongo/JSON y API) y `src/modules/accommodation` (Room, Table y sus asignaciones, que leen los participantes a través de un puerto).
- **Puente entre módulos**: las cartas ven a los participantes a través de su puerto de siempre, `ParticipantRepositoryPort`, que ahora implementa `ParticipantDirectory` (participantes del retiro activo con nombre estructurado y estado). Así los casos de uso de cartas no cambiaron.

- **Regla de dependencias**: infraestructura → aplicación → dominio. El dominio no importa Express, Google, MongoDB ni nada de E/S. Solo usa `Intl` para las zonas horarias.
- **Puertos** (`src/application/ports`): contratos documentados con JSDoc y comprobados al arrancar. Por ejemplo, `MailSourcePort.fetchChanges(cursor)` o `SyncStateRepositoryPort.acquireLock(owner, ttl)`.
- **Adaptadores**: Gmail, demo, MongoDB, JSON, Express, renderizadores…
- **Raíz de composición**: `src/composition/container.js` monta todo a mano (inyección de dependencias manual). El panel (`src/entrypoints/web.js`) construye el contenedor con los casos de uso y la base de datos.
- **Errores**: `AppError(code, httpStatus)`, con código en inglés y mensaje en español. Se traduce en un único middleware de Express. Formato: `{ "code": "PARTICIPANT_NOT_FOUND", "message": "Participante no encontrado." }`.

```
src/
  domain/          entidades y servicios puros
  application/     puertos, casos de uso y servicios de apoyo
  infrastructure/  gmail, persistence/{mongo,json}, rendering, web, logging, maintenance
  composition/     config.js (entorno validado) y container.js
  entrypoints/     web.js, auth.js, purge.js
test/              node:test (dominio, aplicación, adaptadores, web)
```

## Tests

```powershell
npm test
```

Cubren las reglas de dominio (conteo, empates, agrupación cronológica, zona horaria, asignación, avisos y `syncDiff`), los casos de uso con dobles en memoria (idempotencia, seguridad del cursor, respaldo con sincronización completa, bloqueo, pausa mínima, novedades), los adaptadores (JSON, Gmail con una API simulada, renderizadores), la web (seguridad, API, exportación, acceso).

**Integración con MongoDB** (opcional): crea bases de datos temporales y las borra al terminar. Sustituye `usuario` y `clave` por tus credenciales:

```powershell
docker compose up -d
$env:MONGODB_URI_TEST = "mongodb://usuario:clave@127.0.0.1:27017"; npm test
```

Sin `MONGODB_URI_TEST`, esos tests se saltan.

### Cartas de prueba en Gmail

`npm run seed:gmail` crea **directamente en el buzón autorizado** 61 cartas de prueba para un retiro de hombres (de esposas, hijos, padres, hermanos y amigos), sin enviar nada a nadie (`users.messages.insert`). Cubren muchos formatos:

- texto, HTML, texto + HTML, tablas, ISO-8859-1 y emojis;
- 13 cartas ilustradas con mucho formato: fuentes (Georgia, Palatino, Comic Sans, Segoe Script, Courier, Trebuchet), colores, fondos, titulares, citas, listas, tablas y fotos incrustadas;
- todas las formas de saludo y nombres ambiguos;
- respuestas citadas, reenvíos, respuestas automáticas, boletines, rebotes y «solo firma»;
- escaneos con EXIF, WEBP, GIF, imagen `cid:`, PDF, Word, HEIC, vídeo, ZIP, SVG bloqueado y un tipo falso.

Cada carta documenta su resultado esperado, y `test/project/seedCatalog.test.js` lo comprueba.

```powershell
npm run seed:gmail -- --dry-run
```

Genera los `.eml` en `.run/seed/` sin tocar Gmail.

```powershell
npm run seed:gmail -- --write-participants
```

Los inserta en Gmail y escribe los nombres de los 20 participantes de prueba en `data/participants.json`, con copia del anterior. Esa lista solo se importa si el retiro aún no tiene participantes; si ya los tiene, añádelos en **Participantes**.

```powershell
npm run seed:gmail -- --load-participants
```

Los inserta en Gmail y **sustituye** los participantes del retiro activo por los 20 de prueba, con la ficha completa: edad, nacionalidad, teléfono, contacto de emergencia, ronquidos, alimentación (una alergia grave), accesibilidad y asistencia. Los que no estén en la lista de prueba se borran y se liberan su habitación y su mesa; antes se guarda una copia en `.run/participants-backup-*.json`. Con `--dry-run --load-participants` solo carga los participantes, sin tocar Gmail.

```powershell
npm run seed:gmail -- --generated
```

En vez del catálogo fijo, genera unas 100 cartas para los participantes **que ya hay** en el retiro activo, sin cambiarlos. Mezcla texto corto y largo, HTML con formato, cartas ilustradas con fotos, PDF, Word, escaneos, cartas para dos personas y casos para «Por revisar». El reparto es desigual: unos reciben muchas, otros pocas y un par ninguna. Cada carta se comprueba con el motor de reconocimiento antes de insertarla. Con `--generated=150` se cambia la cantidad, y con `--dry-run` solo se generan los `.eml`.

**Preparar una presentación con datos de prueba**

1. En Gmail, busca `from:familias-prueba.example` y **borra las cartas de prueba anteriores**. Hazlo antes de insertar las nuevas: la misma búsqueda las borraría también.
2. Borra las cartas guardadas (los participantes, habitaciones y mesas se conservan):

   ```powershell
   npm run db:purge
   ```

3. Inserta las cartas y carga los participantes (pide escribir SI):

   ```powershell
   npm run seed:gmail -- --load-participants
   ```

4. Reinicia el panel y pulsa **Sincronización completa**.

- Pide un permiso **aparte y solo para insertar** (`gmail.insert`). En la pantalla de Google, marca la casilla «Insertar correo en tu buzón de Gmail». Ese permiso se guarda en `.run/seed-token.json`; la aplicación sigue siendo de solo lectura.
- Comprueba que esa autorización es de la misma cuenta que `token.json` antes de insertar nada.
- Todos los remitentes son `@familias-prueba.example`. Para usarlas, basta con que `GMAIL_START_DATE` sea anterior a su fecha (hasta 6 días antes del día en que se insertaron), o pon `GMAIL_QUERY=from:familias-prueba.example` para ver solo esas. Para borrarlas, busca lo mismo en Gmail y elimina los resultados.
- Si se ejecuta dos veces, las cartas se duplican.

## Privacidad, retención y borrado

Las cartas son **correspondencia personal**, a menudo de familias a **menores de edad**, y pueden contener datos sensibles (salud, creencias, situación familiar). Trátalas conforme al **RGPD** y a la **LOPDGDD** (Ley Orgánica 3/2018).

- **Base legal y finalidad**: informa a las familias de que las cartas se recopilan para entregarlas en el retiro y de quién las gestiona. No uses los datos para nada más.
- **Mínimo acceso**: el panel escucha solo en `127.0.0.1` por defecto. En la red local, exige `ACCESS_TOKEN` y limita quién lo conoce. Gmail se usa en **solo lectura**.
- **Registros**: nunca incluyen el cuerpo de las cartas ni credenciales. Las URI de MongoDB se ocultan.

**Dónde quedan datos**

| Lugar | Contenido | Cómo borrarlo |
|---|---|---|
| MongoDB (`MONGODB_DB`) o `data/db/` | cartas, participantes, asignaciones, impresión, sincronizaciones | `npm run db:purge` (y `docker compose down -v` para eliminar el volumen) |
| `EXPORT_DIR` (`exports/`) | paquetes exportados | `npm run db:purge -- --include-files` o borrar la carpeta |
| `CACHE_DIR` (`cache/`) | caché de adjuntos descargados | `npm run db:purge -- --include-files` o borrar la carpeta |
| `data/participants.json` | lista inicial de participantes (solo se importa una vez) | borrar el archivo |
| `token.json` / `credentials.json` | acceso a Gmail | borrar los archivos y **revocar el acceso** en <https://myaccount.google.com/permissions> |
| Papel impreso | cartas entregadas | según el protocolo del retiro |

**Retención**: el panel borra automáticamente todos los datos personales del retiro `RETREAT_RETENTION_DAYS` días después de su último día (ver [Retiro y borrado automático](#retiro-y-borrado-automático)). También puedes borrarlo todo a mano en cualquier momento:

```powershell
npm run db:purge
```

`db:purge` borra las cartas (también las marcadas como borradas), las asignaciones manuales, el estado de impresión y los datos de sincronización. Pide escribir `PURGE` para confirmar. Opciones:

- `--include-files` borra también `EXPORT_DIR` y `CACHE_DIR`;
- `--include-participants` borra también la lista de participantes guardada;
- `--yes` omite la confirmación (para scripts).

**No toca Gmail.**

## Variables de entorno

Todas están en `.env.example`, comentadas.

| Variable | Por defecto | Descripción |
|---|---|---|
| `HOST` | `127.0.0.1` | Interfaz de escucha. `0.0.0.0` = red local (exige `ACCESS_TOKEN`). |
| `PORT` | `3000` | Puerto del panel. |
| `ACCESS_TOKEN` | — | Código de acceso (≥ 16 caracteres), obligatorio fuera de `127.0.0.1`. |
| `TZ` | `Europe/Madrid` | Zona horaria para fechas, filtros y nombres de archivo. |
| `DEMO_MODE` | `false` | Datos ficticios en memoria. |
| `ASSIGNMENT_MIN_CONFIDENCE` | `0.75` | Confianza mínima para asignar automáticamente. |
| `BODY_SCAN_CHARS` | `600` | Caracteres iniciales del cuerpo donde se buscan saludos. |
| `PARTICIPANTS_FILE` | `./data/participants.json` | Lista inicial de participantes, importada una sola vez en un retiro vacío. |
| `RETREAT_RETENTION_DAYS` | `30` | Días tras el último día del retiro antes de borrar automáticamente sus datos personales. |
| `GMAIL_QUERY` | — | Búsqueda de Gmail que selecciona las cartas. |
| `GMAIL_LABEL_ID` | — | Alternativa: id interno de una etiqueta. |
| `GMAIL_START_DATE` | — | Primer día (`AAAA-MM-DD`, en `TZ`) cuyos correos se leen, de cualquier remitente. |
| `GOOGLE_CREDENTIALS_PATH` | `./credentials.json` | Cliente OAuth (Aplicación de escritorio). |
| `GOOGLE_TOKEN_PATH` | `./token.json` | Token que escribe `npm run auth`. |
| `GMAIL_CONCURRENCY` | `5` | Descargas simultáneas. |
| `GMAIL_MAX_REQUESTS_PER_SECOND` | `10` | Ritmo máximo de descargas (0 = sin límite). Bájalo si Gmail responde «Quota exceeded». |
| `GMAIL_LABELS_ENABLED` | `false` | Activa las etiquetas de Gmail (pide el permiso `gmail.modify`). |
| `GMAIL_LABEL_PREFIX` | vacío | Prefijo opcional de las etiquetas de participante (`Prefijo/Nombre`). Vacío = solo el nombre. |
| `GMAIL_PRINTED_LABEL` | `Impreso` | Etiqueta que se añade a las cartas impresas. |
| `EXPORT_DIR` | `./exports` | Carpeta de exportaciones. |
| `CACHE_DIR` | `./cache` | Caché de adjuntos. |
| `MAX_ATTACHMENT_MB` | `15` | Tamaño máximo de adjunto que se procesa. |
| `PERSISTENCE` | `mongo` | `mongo` o `json`. |
| `DATA_DIR` | `./data` | Ficheros de `PERSISTENCE=json`. |
| `MONGODB_URI` | — | Conexión a MongoDB (con usuario y contraseña). |
| `MONGODB_DB` | `retreat_mail` | Base de datos. |
| `MONGODB_URI_TEST` | — | Activa los tests de integración con MongoDB. |
| `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD` | — | Credenciales del contenedor de `docker-compose.yml`. |
| `MONGO_PORT` | `27017` | Puerto publicado en `127.0.0.1`. |
| `SYNC_INTERVAL_MINUTES` | `0` | Sincronización automática (0 = desactivada). |
| `SYNC_MIN_INTERVAL_SECONDS` | `30` | Pausa mínima entre sincronizaciones. |
| `SYNC_LOCK_TTL_SECONDS` | `300` | Duración del bloqueo de sincronización. |
| `SYNC_RUNS_TTL_DAYS` | `90` | Días que se guarda el historial. |
| `LOG_LEVEL` | `info` | Nivel de registro. |
| `RETREAT_ENV_FILE` | `./.env` | Ruta alternativa del archivo de entorno. |

## Solución de problemas

- **«Falta configurar Gmail» al abrir el panel**: no se encuentran `credentials.json` o `token.json`. Revisa las rutas y ejecuta `npm run auth`. Mientras tanto puedes usar el modo demostración.
- **La sincronización falla con `invalid_grant`**: la autorización ha caducado o se ha revocado. Con una app *Externa* en modo de prueba ocurre cada 7 días. Ejecuta `npm run auth` de nuevo.
- **«Ya hay una sincronización en curso»**: otra sincronización (del panel o la automática) está en marcha; espera a que termine. Si un proceso se cerró a la fuerza, el bloqueo caduca solo tras `SYNC_LOCK_TTL_SECONDS`.
- **«Espera unos segundos antes de volver a sincronizar»**: es la pausa mínima (`SYNC_MIN_INTERVAL_SECONDS`).
- **No conecta con MongoDB**: comprueba `docker compose ps` (estado `healthy`), que `MONGODB_URI` use las mismas credenciales que `MONGO_ROOT_*` y que el puerto coincida con `MONGO_PORT`.
- **Una carta está asignada a quien no es**: ábrela en la ficha y usa «Reasignar…». La decisión manual es definitiva hasta que pulses «Volver a automático».
- **He añadido participantes o apodos**: hazlo en **Participantes**; las cartas pendientes se reasignan solas. `data/participants.json` ya no se vuelve a leer.
- **El panel no se ve desde otro dispositivo**: comprueba `HOST=0.0.0.0`, el cortafuegos de Windows (red privada) y que ambos equipos estén en la misma red.
