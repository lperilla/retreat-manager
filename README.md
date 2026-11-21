# retreat-mail-mcp · Cartas del retiro

Panel web, exportador por lotes, sistema de impresión y servidor MCP para gestionar las **cartas que las familias envían a los participantes de un retiro** a un buzón compartido de Gmail.

- Descarga las cartas de Gmail (solo lectura) y las guarda en una base de datos local con **sincronización incremental**.
- Decide **para quién es cada carta** a partir del asunto y del cuerpo (nunca del remitente ni de la firma) y deja en «Por revisar» las dudosas.
- Muestra cuántas cartas tiene cada participante, quién lleva más y quién menos (con empates) y qué ha llegado desde la última sincronización.
- Exporta e **imprime por lotes**: una página por participante, cartas en orden cronológico, tipografía cuidada.
- Expone los mismos datos a asistentes de IA mediante un **servidor MCP**.

El panel y el MCP **nunca leen Gmail directamente**: todo se lee de la base de datos local. Gmail solo se consulta al sincronizar, y solo para lo que ha cambiado.

---

## Índice

1. [Requisitos](#requisitos)
2. [Prueba rápida (modo demostración)](#prueba-rápida-modo-demostración)
3. [Arrancar, parar y reiniciar](#arrancar-parar-y-reiniciar)
4. [Instalación paso a paso](#instalación-paso-a-paso)
5. [MongoDB con Docker](#mongodb-con-docker)
6. [Configuración OAuth2 en Google Cloud](#configuración-oauth2-en-google-cloud)
7. [Uso del panel](#uso-del-panel)
8. [Cómo se asignan las cartas](#cómo-se-asignan-las-cartas)
9. [Adjuntos](#adjuntos)
10. [Exportación en lote](#exportación-en-lote)
11. [Impresión](#impresión)
12. [Sincronización incremental](#sincronización-incremental)
13. [Panel en la red local](#panel-en-la-red-local)
14. [Servidor MCP](#servidor-mcp)
15. [Arquitectura hexagonal](#arquitectura-hexagonal)
16. [Tests](#tests)
17. [Privacidad, retención y borrado](#privacidad-retención-y-borrado)
18. [Variables de entorno](#variables-de-entorno)
19. [Solución de problemas](#solución-de-problemas)

---

## Requisitos

- **Node.js 22 o superior.**
- **MongoDB 7** (recomendado). La forma más sencilla es Docker o Podman con el `docker-compose.yml` incluido. Alternativa sin base de datos: `PERSISTENCE=json`.
- Una **cuenta de Gmail o Google Workspace** con el buzón que recibe las cartas, y acceso a Google Cloud Console para crear las credenciales OAuth.
- Un navegador moderno. Bootstrap va incluido en el proyecto (`vendor/`), así que **el panel funciona sin internet**; solo la sincronización necesita conexión.

## Prueba rápida (modo demostración)

Sin Gmail ni base de datos: cartas ficticias en memoria que llegan en tres oleadas. La primera vez instala las dependencias sola.

```powershell
.\start.cmd --demo
```

En Linux, macOS o Git Bash: `./start.sh --demo`. Se abre <http://localhost:3000>. La primera oleada (23 cartas, 18 participantes) se carga al arrancar. Cada «Sincronizar ahora» trae la siguiente: +4 cartas, y después +3 y una borrada. La demo incluye empates, participantes sin cartas, una carta para varios destinatarios, una respuesta automática, una carta ambigua («Querida María:» con dos Marías), cartas con adjuntos y una carta cuyo remitente se llama como un participante.

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

3. **Participantes**: edita `data/participants.json` (la carpeta `data/` no se sube al repositorio). `--install` lo crea a partir de `participants.example.json`:

   ```json
   [
     { "displayName": "María García", "aliases": ["Mari"] },
     { "displayName": "Juan Martínez", "aliases": ["Juanito"] },
     { "id": "alvaro-herrera", "displayName": "Álvaro Herrera" }
   ]
   ```

   - `id` es opcional; si falta se genera a partir del nombre (`maria-garcia`).
   - Los **alias** (apodos, diminutivos) también sirven para reconocer al destinatario.
   - La lista se carga al arrancar. Si la cambias, reinicia y pulsa **«Reasignar cartas»**.

4. **Base de datos**: [MongoDB con Docker](#mongodb-con-docker), o `PERSISTENCE=json` para usar ficheros en `data/db/`.

5. **Gmail**: [crea las credenciales OAuth](#configuración-oauth2-en-google-cloud) y autoriza el acceso:

   ```powershell
   .\start.cmd --auth
   ```

6. **Arranca el panel** y pulsa «Sincronizar ahora»:

   ```powershell
   .\start.cmd
   ```

| Script | Para qué sirve |
|---|---|
| `.\start.cmd` · `./start.sh` | Arrancar, parar, reiniciar, estado, registro, instalar ([ver tabla](#arrancar-parar-y-reiniciar)). |
| `npm start` | Panel web y API en primer plano. |
| `npm run dev` | Igual, reiniciando al cambiar el código. |
| `npm run mcp` | Servidor MCP por stdio. |
| `npm run auth` | Autoriza el acceso de solo lectura a Gmail y escribe `token.json`. |
| `npm test` | Tests unitarios, de aplicación y de adaptadores. |
| `npm run db:purge` | Borra las cartas y los datos de sincronización (pide confirmación). |
| `npm run demo:walkthrough` | Recorre la demo por consola, sin servidor. |
| `node scripts/generate-demo-assets.js` | Regenera los adjuntos ficticios de la demo (ya incluidos en el repositorio). |

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

**Alternativa sin MongoDB**: `PERSISTENCE=json` guarda ficheros en `data/db/`. Sirve para un solo proceso: si el panel y el MCP se ejecutan a la vez, usa MongoDB, porque el bloqueo de sincronización solo funciona entre procesos con Mongo.

## Configuración OAuth2 en Google Cloud

La aplicación pide **un único permiso: `gmail.readonly`** (lectura). No puede enviar, borrar ni modificar correo.

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
- **Si comparte buzón con otros correos**, filtra por contenido o por fecha. Por ejemplo `subject:carta after:2026/11/01`, o `{subject:carta subject:"para"} after:2026/11/01`.
- **Con etiqueta** (opcional): crea en Gmail un filtro que aplique una etiqueta (por ejemplo `cartas-retiro`) según el destinatario o el asunto, y pon `GMAIL_QUERY=label:cartas-retiro`. También puedes etiquetar a mano.
- **`GMAIL_LABEL_ID`**: el id interno de una etiqueta (`Label_123…`). Si se configura, se ignora `GMAIL_QUERY`.

En cualquier caso se descartan los borradores, el spam, la papelera y los mensajes enviados desde el propio buzón. Comprueba la búsqueda en Gmail antes de sincronizar: lo que devuelva el buscador es lo que se tratará como cartas.

## Uso del panel

**Cabecera (widget de sincronización)**

- «Última sincronización: hace 5 min» y su estado: *Sincronizando…*, *Correcta* o *Con error*.
- **Sincronizar ahora** trae solo lo nuevo. En el menú, **Sincronización completa** (con confirmación) vuelve a recorrer toda la búsqueda.
- Los botones se desactivan durante una sincronización y durante la pausa mínima entre sincronizaciones (`SYNC_MIN_INTERVAL_SECONDS`). Al terminar aparece un aviso: «3 cartas nuevas · 1 actualizada · 0 eliminadas».
- **Reasignar cartas** recalcula los destinatarios con la lista actual de participantes y muestra un resumen de los cambios. Respeta siempre las asignaciones manuales.
- Si la última sincronización falló, aparece un aviso fijo: *«La última sincronización falló; se muestran los últimos datos guardados»*.

**Indicadores**: total de cartas, participantes con cartas, quién lleva más y quién menos (todos los empatados; los que tienen 0 cartas en rojo), cartas por revisar y cartas nuevas.

**Directorio de participantes**

- Búsqueda por nombre o alias.
- Filtros: con cartas, sin cartas, pendiente de imprimir, impresa, con avisos, con novedades.
- Orden alfabético o por número de cartas.
- Insignias: número de cartas, «+N nuevas», avisos y estado de impresión (pulsa para cambiar entre *Pendiente* e *Impresa*).
- Selección: casillas, «Seleccionar todos», «Deseleccionar todos», «Seleccionar con cartas» y «Seleccionar pendientes de imprimir».

**Novedades desde la última sincronización**: lo que el equipo aún no ha visto, agrupado por participante, con **«Marcar como vistas»** global o por participante.

**Ficha de participante**: cartas en orden cronológico con remitente, fecha, asunto, cuerpo completo (con párrafos, tildes, ñ y emojis), avisos y adjuntos.

- Cada carta lleva una etiqueta que dice cómo se asignó: *Asunto*, *Cuerpo*, *Mención* o *Manual*. Al pasar el ratón se ve el texto que coincidió.
- Botones *Imprimir*, *Exportar* y *Reasignar…*.
- Filtro «Mostrar cartas posteriores al día…», exclusivo y en la zona horaria configurada.

**Por revisar**: cartas que no se han podido asignar con seguridad. Muestra la carta, los participantes sugeridos como botones (un clic asigna), **Asignar…** (elegir uno o varios) y **Dejar sin asignar**. Estas cartas no cuentan para nadie hasta que se asignan, y nunca se descartan.

**Historial de sincronizaciones**: fecha, tipo, resultado, duración, cartas nuevas, actualizadas y eliminadas, y el error si lo hubo.

**Avisos** (solo informan, nunca descartan una carta): *Respuesta automática*, *Envío masivo*, *Error de entrega*, *Solo firma*, *Solo adjuntos*, *Varios destinatarios* y *Con adjuntos*.

## Cómo se asignan las cartas

Las escriben familiares, así que **el nombre del remitente y la firma nunca indican el destinatario**.

1. Se normaliza el texto (minúsculas, sin tildes) y se quitan las citas de respuestas («El … escribió:», líneas con `>`), las cabeceras de reenvío y las firmas (por ejemplo, «Enviado desde mi iPhone» o lo que va tras «Un beso,»).
2. Se buscan señales:
   - **Asunto** (0,95): «Carta para X», «Para: X», «[Para: X]».
   - **Cuerpo** (0,85), en los primeros `BODY_SCAN_CHARS` caracteres: «Querido/a X», «Hola X», «Mi querida X», «Carta para X», o una línea de saludo que termina en «:» o «,».
   - **Mención** (0,30): el nombre completo o un alias en otra parte del texto.
3. Se compara con el nombre y los alias de cada participante. **Un nombre de pila que comparten dos o más participantes es ambiguo** y nunca se asigna solo.
4. Se asigna automáticamente si un único participante supera `ASSIGNMENT_MIN_CONFIDENCE` (0,75) y nadie más queda a menos de 0,15. Si hay varios nombrados explícitamente, la carta es para todos («Varios destinatarios»). En cualquier otro caso va a **Por revisar** con sugerencias ordenadas.
5. Las **asignaciones manuales** siempre ganan: se guardan por mensaje y sobreviven a nuevas sincronizaciones y a «Reasignar cartas».

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
- **Sin conexión con Gmail** (por ejemplo, un MCP en otra máquina): los adjuntos se listan, pero no se pueden abrir.

## Exportación en lote

1. En el directorio, **selecciona** participantes (por ejemplo, «Seleccionar pendientes de imprimir»).
2. En la barra inferior elige el formato:
   - **Exportar .html**: paquete listo para imprimir, **una página por participante**, cartas en orden cronológico y estilos incluidos en el propio archivo.
   - **Exportar .txt**: texto plano UTF-8, con un salto de página (`\f`) entre participantes.
   - **Exportar .json**: datos estructurados (para otros programas).
3. El archivo se descarga y además queda guardado en `EXPORT_DIR` con un nombre generado por el servidor, por ejemplo `cartas_lote-12_20261121-093000.html` o `cartas_maria-garcia_…`.
4. El panel pregunta **«¿Marcar como impresos?»**. Si aceptas, esos participantes pasan a *Impresa* con fecha. Se puede deshacer desde el directorio.

Desde la ficha de un participante, «Exportar» hace lo mismo solo para esa persona. Una carta para varios destinatarios aparece en la sección de cada uno.

## Impresión

- **Imprimir lote** (barra inferior) o **Imprimir** (ficha) abre una pestaña con el paquete y lanza el diálogo de impresión del navegador.
- Cada participante empieza en una **página nueva**. La cabecera de cada carta nunca queda separada de su texto, se usa tipografía con serifa a 11–12 pt e interlineado amplio, y las imágenes se ajustan al ancho.
- Desactiva en el navegador «Encabezados y pies de página» y usa márgenes predeterminados y papel A4.
- Al imprimir el panel directamente (Ctrl+P), se ocultan la navegación, los botones, las casillas y el widget de sincronización.

## Sincronización incremental

- **Primera vez, o «Sincronización completa»**: se anota el punto actual del buzón (`historyId`) **antes** de listar todos los mensajes de la búsqueda. Así, lo que llegue mientras se descarga se recoge en la siguiente sincronización.
- **Incremental**: se piden a Gmail solo los cambios desde ese punto (`users.history.list`, todas las páginas) y se descargan únicamente los mensajes nuevos.
- **Seguridad del cursor**: el punto guardado **solo avanza cuando las cartas ya están guardadas**. Si algo falla, se conserva el anterior, el estado queda como *Con error* y el panel sigue mostrando los últimos datos buenos. Si Gmail dice que el punto guardado ya no vale, se hace una sincronización completa automáticamente.
- **Sin duplicados**: las cartas se guardan por id de mensaje, así que repetir la misma sincronización no duplica nada. Las cartas borradas en Gmail se marcan como borradas (no se eliminan) y dejan de contar.
- **Novedades**: cada carta guarda cuándo se vio por primera vez y si el equipo ya la ha visto.
- **Nunca se pierden** las asignaciones manuales ni el estado de impresión al sincronizar.
- **Una sola sincronización a la vez**, aunque la lancen el panel, la sincronización automática y el MCP: hay un bloqueo en la base de datos y una pausa mínima entre sincronizaciones.
- **Sincronización automática**: `SYNC_INTERVAL_MINUTES` > 0. Solo la programa el panel web.
- Reintentos con espera exponencial ante límites de Gmail (429) o errores temporales (5xx), y descargas en paralelo limitadas (`GMAIL_CONCURRENCY`).

## Panel en la red local

Para usar el panel desde otros dispositivos del retiro (por ejemplo, una tableta en secretaría):

1. En `.env`, pon `HOST=0.0.0.0` y un **`ACCESS_TOKEN`** de al menos 16 caracteres. **Sin él, la aplicación no arranca.**

   ```powershell
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```

2. Al arrancar, el registro muestra las direcciones disponibles (`http://192.168.1.20:3000`, …) y un aviso claro de que el panel está **expuesto en la red local**.
3. En Windows, permite Node.js en el cortafuegos **solo para redes privadas**.
4. Cada persona entra con el código de acceso. La sesión dura 12 horas en una cookie protegida que no contiene el código.

El panel usa **HTTP sin cifrar**: úsalo solo en una red de confianza (nunca en una wifi abierta) y vuelve a `HOST=127.0.0.1` al terminar.

## Servidor MCP

Permite a un asistente compatible con MCP (Claude Desktop, Claude Code…) consultar las cartas. Usa la misma base de datos que el panel. Habla por **stdio**: por la salida estándar solo viajan los mensajes del protocolo, y todos los registros van a la salida de errores.

```powershell
npm run mcp
```

**Herramientas**

| Herramienta | Qué hace |
|---|---|
| `list_retreat_summary` | Totales, quién tiene más y menos cartas (con empates), participantes sin cartas, cola de revisión, cartas nuevas y estado de la sincronización. |
| `group_participant_letters` | Cartas de un participante en orden cronológico (`participantId`, `afterDate` opcional y exclusivo). |
| `search_raw_letters` | Búsqueda sin tildes en asunto, remitente y cuerpo, incluidas las no asignadas (`query`, `limit` ≤ 50). |
| `list_new_letters` | Cartas aún no vistas por el equipo, agrupadas por participante. |
| `sync_mailbox` | Sincroniza con Gmail (`incremental` o `full`). No es de solo lectura, pero no destruye datos. |
| `export_batch_letters` | Escribe un archivo en `EXPORT_DIR` (`html`, `txt` o `json`) y devuelve su ruta. |

**Recursos**: `retreat://summary`, `retreat://participants`, `retreat://participants/{id}/letters` y `retreat://sync-status`.

Si en esa máquina no está configurado Gmail, las consultas funcionan igual (leen la base de datos) y `sync_mailbox` responde con un error explicativo.

### Claude Desktop

Edita `claude_desktop_config.json`:

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "cartas-retiro": {
      "command": "node",
      "args": ["C:\\ruta\\a\\retreat-mail-mcp\\src\\entrypoints\\mcp.js"]
    }
  }
}
```

El servidor lee el `.env` de la carpeta del proyecto aunque Claude lo arranque desde otra carpeta. Para usar otro archivo, añade `"env": { "RETREAT_ENV_FILE": "C:\\ruta\\otro.env" }`. Reinicia Claude Desktop después de editar.

### Claude Code

```powershell
claude mcp add cartas-retiro -- node C:\ruta\a\retreat-mail-mcp\src\entrypoints\mcp.js
```

## Arquitectura hexagonal

```
             ┌───────────────────────────── infraestructura ─────────────────────────────┐
             │  web (Express + UI)   mcp (stdio)   gmail   persistence (mongo | json)     │
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

- **Regla de dependencias**: infraestructura → aplicación → dominio. El dominio no importa Express, Google, MongoDB ni nada de E/S. Solo usa `Intl` para las zonas horarias.
- **Puertos** (`src/application/ports`): contratos documentados con JSDoc y comprobados al arrancar. Por ejemplo, `MailSourcePort.fetchChanges(cursor)` o `SyncStateRepositoryPort.acquireLock(owner, ttl)`.
- **Adaptadores**: Gmail, demo, MongoDB, JSON, Express, MCP, renderizadores…
- **Raíz de composición**: `src/composition/container.js` monta todo a mano (inyección de dependencias manual). El panel (`src/entrypoints/web.js`) y el MCP (`src/entrypoints/mcp.js`) comparten el mismo contenedor, casos de uso y base de datos.
- **Errores**: `AppError(code, httpStatus)`, con código en inglés y mensaje en español. Se traduce en un único middleware de Express y en el manejador de herramientas del MCP. Formato: `{ "code": "PARTICIPANT_NOT_FOUND", "message": "Participante no encontrado." }`.

```
src/
  domain/          entidades y servicios puros
  application/     puertos, casos de uso y servicios de apoyo
  infrastructure/  gmail, persistence/{mongo,json}, rendering, web, mcp, logging, maintenance
  composition/     config.js (entorno validado) y container.js
  entrypoints/     web.js, mcp.js, auth.js, purge.js
test/              node:test (dominio, aplicación, adaptadores, web, MCP)
```

## Tests

```powershell
npm test
```

Cubren las reglas de dominio (conteo, empates, agrupación cronológica, zona horaria, asignación, avisos y `syncDiff`), los casos de uso con dobles en memoria (idempotencia, seguridad del cursor, respaldo con sincronización completa, bloqueo, pausa mínima, novedades), los adaptadores (JSON, Gmail con una API simulada, renderizadores), la web (seguridad, API, exportación, acceso) y el MCP (incluida una prueba real por stdio).

**Integración con MongoDB** (opcional): crea bases de datos temporales y las borra al terminar. Sustituye `usuario` y `clave` por tus credenciales:

```powershell
docker compose up -d
$env:MONGODB_URI_TEST = "mongodb://usuario:clave@127.0.0.1:27017"; npm test
```

Sin `MONGODB_URI_TEST`, esos tests se saltan.

## Privacidad, retención y borrado

Las cartas son **correspondencia personal**, a menudo de familias a **menores de edad**, y pueden contener datos sensibles (salud, creencias, situación familiar). Trátalas conforme al **RGPD** y a la **LOPDGDD** (Ley Orgánica 3/2018).

- **Base legal y finalidad**: informa a las familias de que las cartas se recopilan para entregarlas en el retiro y de quién las gestiona. No uses los datos para nada más.
- **Mínimo acceso**: el panel escucha solo en `127.0.0.1` por defecto. En la red local, exige `ACCESS_TOKEN` y limita quién lo conoce. Gmail se usa en **solo lectura**.
- **Asistentes de IA**: al conectar el MCP a un asistente, el contenido de las cartas consultadas se envía a ese asistente. Valora si es aceptable y comparte solo lo necesario.
- **Registros**: nunca incluyen el cuerpo de las cartas ni credenciales. Las URI de MongoDB se ocultan.

**Dónde quedan datos**

| Lugar | Contenido | Cómo borrarlo |
|---|---|---|
| MongoDB (`MONGODB_DB`) o `data/db/` | cartas, participantes, asignaciones, impresión, sincronizaciones | `npm run db:purge` (y `docker compose down -v` para eliminar el volumen) |
| `EXPORT_DIR` (`exports/`) | paquetes exportados | `npm run db:purge -- --include-files` o borrar la carpeta |
| `CACHE_DIR` (`cache/`) | caché de adjuntos descargados | `npm run db:purge -- --include-files` o borrar la carpeta |
| `data/participants.json` | lista de participantes | borrar el archivo |
| `token.json` / `credentials.json` | acceso a Gmail | borrar los archivos y **revocar el acceso** en <https://myaccount.google.com/permissions> |
| Papel impreso | cartas entregadas | según el protocolo del retiro |

**Retención recomendada**: borra todo cuando termine el retiro y se hayan entregado las cartas.

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
| `PARTICIPANTS_FILE` | `./data/participants.json` | Lista de participantes. |
| `GMAIL_QUERY` | — | Búsqueda de Gmail que selecciona las cartas. |
| `GMAIL_LABEL_ID` | — | Alternativa: id interno de una etiqueta. |
| `GOOGLE_CREDENTIALS_PATH` | `./credentials.json` | Cliente OAuth (Aplicación de escritorio). |
| `GOOGLE_TOKEN_PATH` | `./token.json` | Token que escribe `npm run auth`. |
| `GMAIL_CONCURRENCY` | `5` | Descargas simultáneas. |
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
| `RETREAT_ENV_FILE` | `./.env` | Ruta alternativa del archivo de entorno (útil para el MCP). |

## Solución de problemas

- **«Falta configurar Gmail» al abrir el panel**: no se encuentran `credentials.json` o `token.json`. Revisa las rutas y ejecuta `npm run auth`. Mientras tanto puedes usar el modo demostración.
- **La sincronización falla con `invalid_grant`**: la autorización ha caducado o se ha revocado. Con una app *Externa* en modo de prueba ocurre cada 7 días. Ejecuta `npm run auth` de nuevo.
- **«Ya hay una sincronización en curso»**: otra sincronización (del panel, la automática o el MCP) está en marcha; espera a que termine. Si un proceso se cerró a la fuerza, el bloqueo caduca solo tras `SYNC_LOCK_TTL_SECONDS`.
- **«Espera unos segundos antes de volver a sincronizar»**: es la pausa mínima (`SYNC_MIN_INTERVAL_SECONDS`).
- **No conecta con MongoDB**: comprueba `docker compose ps` (estado `healthy`), que `MONGODB_URI` use las mismas credenciales que `MONGO_ROOT_*` y que el puerto coincida con `MONGO_PORT`.
- **Una carta está asignada a quien no es**: ábrela en la ficha y usa «Reasignar…». La decisión manual es definitiva hasta que pulses «Volver a automático».
- **He añadido participantes o alias**: actualiza `data/participants.json`, reinicia y pulsa «Reasignar cartas».
- **El panel no se ve desde otro dispositivo**: comprueba `HOST=0.0.0.0`, el cortafuegos de Windows (red privada) y que ambos equipos estén en la misma red.
