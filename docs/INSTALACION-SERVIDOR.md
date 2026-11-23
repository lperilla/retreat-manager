# Instalar el servidor de «Gestión del retiro»

Esta guía es para la persona que va a preparar el ordenador **servidor**. No hace falta saber programar. Se hace **una sola vez**, en **un solo ordenador**. Calcula unos 30 minutos la primera vez, casi todos en el paso 1 (Google).

Los demás (otros ordenadores, tablets y móviles) no instalan nada: entran con el navegador. Eso se explica en la [guía para usuarios](GUIA-USUARIOS.md).

## Índice

1. [Cómo funciona](#cómo-funciona)
2. [Qué necesitas](#qué-necesitas)
3. [Paso 1. Preparar el acceso a Gmail en Google Cloud](#paso-1-preparar-el-acceso-a-gmail-en-google-cloud)
4. [Paso 2. Instalar la aplicación](#paso-2-instalar-la-aplicación)
5. [Paso 3. Primer arranque y conexión con Gmail](#paso-3-primer-arranque-y-conexión-con-gmail)
6. [Paso 4. Dar acceso a los demás](#paso-4-dar-acceso-a-los-demás)
7. [Paso 5. Preparar el retiro](#paso-5-preparar-el-retiro)
8. [Que la dirección no cambie](#que-la-dirección-no-cambie)
9. [Uso diario](#uso-diario)
10. [Dónde se guardan los datos y copias de seguridad](#dónde-se-guardan-los-datos-y-copias-de-seguridad)
11. [Actualizar y desinstalar](#actualizar-y-desinstalar)
12. [Opcional: usar MongoDB](#opcional-usar-mongodb)
13. [Solución de problemas](#solución-de-problemas)
14. [Privacidad](#privacidad)

---

## Cómo funciona

```
          Gmail (buzón de las cartas)
                    │  solo lectura
                    ▼
   ┌──────────────────────────────────┐
   │  ORDENADOR SERVIDOR              │
   │  App «Gestión del retiro»        │   guarda las cartas, los participantes,
   │  (siempre abierta en el retiro)  │   las asignaciones y lo impreso
   └──────────────────────────────────┘
          ▲            ▲            ▲
          │  misma red (Wi‑Fi o cable)
   navegador       navegador      navegador
   otro PC          tablet          móvil
```

- El **servidor** es un ordenador con Windows donde se instala la aplicación. Lee las cartas del buzón de Gmail y guarda los datos.
- Los **demás dispositivos** abren un navegador (Chrome, Edge, Safari…) y escriben la dirección que muestra el servidor, por ejemplo `http://192.168.1.20:3000`.
- Todos deben estar en la **misma red**. No se abre nada a internet.
- Hay un **código de acceso** para que nadie más de la red pueda ver las cartas.

## Qué necesitas

- **Un ordenador con Windows 10 u 11 (64 bits), o con Linux (Ubuntu, Debian, Linux Mint… de 64 bits)**, que esté encendido mientras se trabaje con las cartas. Sirve uno normal, no tiene que ser potente. Mejor si tiene usuario con contraseña: guarda cartas personales.
- **La cuenta de Gmail** donde llegan las cartas, y su contraseña. Lo recomendable es una cuenta solo para el retiro, por ejemplo `cartas.retiro.2026@gmail.com`.
- **Conexión a internet** en el servidor (para leer Gmail).
- **Una red local** (Wi‑Fi o cable) a la que se conecten también los demás dispositivos.
- **El instalador**:
  - Windows: `Gestion-del-retiro-Instalador-<versión>.exe`.
  - Linux (Ubuntu, Debian, Mint): `Gestion-del-retiro-<versión>-linux-x64.deb`.
  - Otras distribuciones de Linux: `Gestion-del-retiro-<versión>-linux-x64.AppImage`.

## Paso 1. Preparar el acceso a Gmail en Google Cloud

Google exige registrar la aplicación antes de dejarle leer un buzón. Se hace una vez y obtienes un archivo llamado **`credentials.json`**. Es gratis.

> Hazlo con la **cuenta del buzón de las cartas** (o con una cuenta de tu organización que pueda administrar proyectos). Los nombres de los menús de Google cambian a veces: si alguno no coincide, busca el más parecido.

### 1.1 Crear el proyecto

1. Entra en <https://console.cloud.google.com/>.
2. Arriba, junto al logotipo, pulsa el selector de proyecto → **Proyecto nuevo**.
3. Nombre: `Cartas retiro` (o el que quieras) → **Crear**. Espera unos segundos y asegúrate de que el proyecto nuevo queda seleccionado arriba.

### 1.2 Activar la API de Gmail

1. Menú ☰ → **APIs y servicios** → **Biblioteca**.
2. Busca **Gmail API**, ábrela y pulsa **Habilitar**.

### 1.3 Pantalla de consentimiento

1. Menú ☰ → **Google Auth Platform** (o **APIs y servicios → Pantalla de consentimiento de OAuth**) → **Comenzar**.
2. **Información de la aplicación**: nombre `Gestión del retiro` y tu correo de asistencia → **Siguiente**.
3. **Audiencia**:
   - Si el buzón es de **Google Workspace** (correo de tu organización), elige **Interno**. Es lo mejor: el permiso no caduca.
   - Si es una cuenta **@gmail.com**, elige **Externo**.
4. **Información de contacto**: tu correo → **Siguiente** → acepta las condiciones → **Crear**.
5. Solo si elegiste **Externo**: entra en **Audiencia** → **Usuarios de prueba** → **Add users** y añade la dirección del buzón de las cartas. Deja la aplicación **en modo de prueba**.

> **Importante con @gmail.com (Externo):** en modo de prueba, Google **caduca la autorización cada 7 días**. Cuando pase, la aplicación avisará de que Gmail rechaza la autenticación, y basta con repetir el [paso 3.2](#32-conectar-gmail) (Archivo → Conectar con Gmail). Con Google Workspace (Interno) no caduca.

### 1.4 Permisos (acceso a datos)

1. **Google Auth Platform** → **Acceso a datos** → **Añadir o quitar permisos**.
2. Busca y marca **`https://www.googleapis.com/auth/gmail.readonly`** (ver correo, solo lectura) → **Actualizar** → **Guardar**.
3. Solo si vas a usar las **etiquetas de Gmail** (opcional, la aplicación pone en Gmail una etiqueta por participante y otra «Impreso»): marca también **`https://www.googleapis.com/auth/gmail.modify`**.

Con `gmail.readonly` la aplicación **no puede enviar, borrar ni cambiar** ningún correo.

### 1.5 Crear el cliente y descargar `credentials.json`

1. **Google Auth Platform** → **Clientes** → **Crear cliente**.
2. **Tipo de aplicación: Aplicación de escritorio**. Nombre: `Gestión del retiro` → **Crear**.
3. En la ventana que aparece pulsa **Descargar JSON**.
4. Guarda ese archivo en un sitio que encuentres (por ejemplo, el Escritorio). Puedes renombrarlo a `credentials.json`, aunque no es obligatorio.

> Trata este archivo como una contraseña: no lo envíes por correo ni lo subas a internet.

## Paso 2. Instalar la aplicación

### En Windows

1. Haz doble clic en **`Gestion-del-retiro-Instalador-<versión>.exe`**.
2. Si Windows muestra **«Windows protegió su PC»**, pulsa **Más información** → **Ejecutar de todas formas**. Aparece porque el instalador no está firmado con un certificado comercial; no es un virus.
3. Sigue el asistente: **Siguiente** → elige la carpeta (la propuesta vale) → **Instalar** → **Finalizar**.
4. Quedan accesos directos en el **Escritorio** y en el **menú Inicio**: «Gestión del retiro».

### En Linux (Ubuntu, Debian, Linux Mint)

1. Haz doble clic en **`Gestion-del-retiro-<versión>-linux-x64.deb`**. Se abre el Centro de aplicaciones (o el instalador de paquetes): pulsa **Instalar** e introduce tu contraseña.
   - Si no se abre, en una terminal, desde la carpeta donde esté el archivo: `sudo apt install ./Gestion-del-retiro-<versión>-linux-x64.deb`.
2. Ábrela desde el menú de aplicaciones: «Gestión del retiro».

### En otras distribuciones de Linux (AppImage)

1. Botón derecho sobre **`Gestion-del-retiro-<versión>-linux-x64.AppImage`** → **Propiedades** → **Permisos** → marca **Permitir ejecutar el archivo como programa** (o en una terminal: `chmod +x Gestion-del-retiro-*.AppImage`).
2. Doble clic para abrirla.
3. Si no arranca y menciona **FUSE**, instala `libfuse2` (en Ubuntu reciente: `sudo apt install libfuse2t64`).

No necesitas instalar nada más (ni Node.js, ni bases de datos, ni Docker).

## Paso 3. Primer arranque y conexión con Gmail

### 3.1 Abrir la aplicación

Abre **Gestión del retiro** desde el Escritorio.

### 3.2 Conectar Gmail

1. Aparece «Conectar con el buzón de Gmail». Pulsa **Elegir credentials.json** y selecciona el archivo del paso 1.5.
   - Si aún no lo tienes, pulsa **Más tarde**: la aplicación se abre y podrás probarla con **datos de demostración**. Después conectas Gmail desde **Archivo → Conectar con Gmail…**.
2. Pulsa **Continuar**: se abre el navegador.
3. Inicia sesión con la **cuenta del buzón de las cartas**.
4. Si aparece **«Google no ha verificado esta aplicación»**, pulsa **Avanzado** → **Ir a Gestión del retiro (no seguro)**. Es normal: la «aplicación» es la tuya, creada en el paso 1, y Google solo verifica las que se publican para todo el mundo.
5. Marca los permisos que pide y pulsa **Continuar**.
6. El navegador dice «Autorización completada». Vuelve a la aplicación: verás **«Gmail conectado»**.

### 3.3 Permitir el acceso desde la red (cortafuegos de Windows)

La primera vez, Windows puede preguntar si permites que la aplicación se comunique en la red:

- Marca **Redes privadas** (casa, oficina, la red del retiro).
- **No marques** «Redes públicas» (cafeterías, aeropuertos).
- Pulsa **Permitir acceso**. Si te pide contraseña de administrador, introdúcela.

Si no aparece la pregunta y los demás no pueden entrar, consulta [Los demás no pueden entrar](#los-demás-no-pueden-entrar).

**En Linux** no aparece ninguna pregunta. En Ubuntu el cortafuegos (`ufw`) viene desactivado y no hay que hacer nada. Si lo tienes activado, permite el puerto con `sudo ufw allow 3000/tcp`.

Además, la red Wi‑Fi del servidor debe estar marcada como **privada**: Configuración → Red e Internet → Wi‑Fi (o Ethernet) → tu red → **Tipo de perfil de red: Privada**.

## Paso 4. Dar acceso a los demás

El servidor **anuncia siempre la dirección** a la que se conectan los demás:

- En el **título de la ventana**: «Gestión del retiro — los demás entran en http://192.168.1.20:3000».
- En una **notificación** de Windows cada vez que se abre la aplicación.
- En **Archivo → Cómo entran los demás (dirección y código)**, con botones para **copiar la dirección** y **copiar el código de acceso**.

Pasa a cada usuario:

1. la **dirección** (por ejemplo `http://192.168.1.20:3000`);
2. el **código de acceso** (32 caracteres; cópialo con el botón y envíalo por un canal privado);
3. la [guía para usuarios](GUIA-USUARIOS.md).

Cada dispositivo pide el código una vez y lo recuerda **30 días**.

> En el propio servidor no se pide el código: la aplicación entra directamente.

## Paso 5. Preparar el retiro

Todo esto se hace en el panel, desde el servidor o desde cualquier navegador:

1. **Participantes**: añádelos a mano o impórtalos desde Excel.
2. **Configuración** (menú superior):
   - **Qué correos se leen**: si el buzón es solo para el retiro, déjalo vacío. Si es compartido, pon una búsqueda de Gmail (por ejemplo `to:cartas.retiro.2026@gmail.com`) o el día desde el que leer.
   - **Etiquetas de Gmail** (opcional): ver [paso 1.4](#14-permisos-acceso-a-datos). Al activarlas, repite **Archivo → Conectar con Gmail…** para dar el permiso nuevo.
   - **Buscar cartas nuevas cada (minutos)**: por ejemplo `15` para que se recojan solas.
   - Cada campo tiene un botón ⓘ que explica qué hace.
3. Pulsa **Buscar cartas nuevas** arriba a la derecha.

## Que la dirección no cambie

La dirección usa la **IP** del servidor, que el router asigna y **puede cambiar** si el servidor se apaga o pasa tiempo desconectado. Si cambia, los favoritos de los demás dejan de funcionar. Hay dos soluciones:

- **Recomendada: reservar la IP en el router.** Entra en la página de configuración del router (suele ser `http://192.168.1.1`, la contraseña viene en una pegatina del router) y busca **DHCP → Reserva de direcciones / IP estática / Static lease**. Elige el servidor de la lista y guarda. Cada router es distinto: si no sabes, pide ayuda a quien gestione la red.
- **Usar el nombre del ordenador.** «Cómo entran los demás» muestra también una dirección con el nombre del equipo, por ejemplo `http://pc-secretaria:3000`. No cambia nunca, y funciona en la mayoría de redes con ordenadores Windows. En algunos móviles y tablets puede no funcionar: entonces usa la IP.

## Uso diario

- **La aplicación del servidor debe estar abierta** para que los demás puedan entrar. Si la cierras, los demás verán un error hasta que la vuelvas a abrir.
- **Evita que el servidor se duerma** durante el retiro: en Windows, Configuración → Sistema → Energía → **Suspender: Nunca** (al menos enchufado). En Ubuntu, Configuración → Energía → **Suspender automáticamente: desactivado**.
- Al cerrar la ventana, la aplicación se detiene ordenadamente y guarda todo.
- Solo puede haber una aplicación abierta a la vez en el servidor: si la abres otra vez, se muestra la que ya estaba abierta.

## Dónde se guardan los datos y copias de seguridad

Todo está en la carpeta de datos del usuario que usa la aplicación:

- **Windows:** `C:\Users\<tu usuario>\AppData\Roaming\Gestión del retiro`
- **Linux:** `~/.config/Gestión del retiro` (carpeta oculta dentro de tu carpeta personal)

```
Gestión del retiro\
├── desktop.json         código de acceso
└── server\
    ├── credentials.json  cliente de Google (paso 1)
    ├── token.json        permiso de Gmail (no lo compartas)
    ├── data\             participantes, cartas, asignaciones, impresión, configuración
    ├── cache\            adjuntos descargados (fotos, PDF…)
    ├── exports\          archivos exportados e impresos
    └── logs\             registro (servidor.log), útil si algo falla
```

Ábrela con **Archivo → Abrir carpeta de datos**.

**Copia de seguridad:** cierra la aplicación y copia la carpeta `Gestión del retiro` entera a un USB o a otro disco. Para recuperarla, cierra la aplicación y pon la copia en el mismo sitio.

**Cerrar el retiro:** desde el panel, al cerrar el retiro se borran los datos personales (cartas, participantes, adjuntos y exportaciones). También se borran solos pasados los días de retención configurados. Los correos originales siguen en Gmail: bórralos allí si ya no los necesitas.

## Actualizar y desinstalar

- **Actualizar:** ejecuta el instalador de la versión nueva con la aplicación cerrada. Los datos se conservan.
- **Desinstalar:** en Windows, Configuración → Aplicaciones → «Gestión del retiro» → Desinstalar. En Linux, desde el Centro de aplicaciones o con `sudo apt remove retreat-manager`; con AppImage basta con borrar el archivo. **Los datos no se borran** (por si reinstalas). Para borrarlos, elimina la carpeta de datos (ver [dónde se guardan](#dónde-se-guardan-los-datos-y-copias-de-seguridad)).
- **Cambiar de ordenador servidor:** instala la aplicación en el nuevo, ábrela una vez y ciérrala, y copia encima la carpeta `Gestión del retiro` del antiguo (con la aplicación cerrada en los dos). La dirección cambiará: avisa a los demás.

## Opcional: usar MongoDB

Por defecto los datos se guardan en archivos dentro de `server\data` y **no hace falta ninguna base de datos**. Es lo recomendable para un retiro.

Si ya tienes un servidor MongoDB y prefieres usarlo:

1. Cierra la aplicación.
2. En la carpeta `server` (Archivo → Abrir carpeta de datos) crea un archivo de texto llamado **`.env`** (sin nombre delante, solo `.env`) con:

   ```
   PERSISTENCE=mongo
   MONGODB_URI=mongodb://usuario:contraseña@127.0.0.1:27017
   MONGODB_DB=retreat_mail
   ```

   Si la contraseña tiene caracteres especiales (`@`, `:`, `/`), escríbelos codificados (`@` → `%40`).
3. Abre la aplicación. Las colecciones y los índices se crean solos.

En ese mismo `.env` puedes cambiar otras opciones avanzadas, como `PORT=3001` si el puerto 3000 está ocupado. Los datos que ya tenías en archivos no se pasan a MongoDB.

## Solución de problemas

### Los demás no pueden entrar

1. Comprueba que **la aplicación del servidor está abierta**.
2. Comprueba que el dispositivo está en la **misma red** (misma Wi‑Fi). Las redes de **invitados** suelen aislar los dispositivos entre sí: usa la red principal.
3. Mira la dirección actual en el título de la ventana del servidor: puede que la IP haya cambiado (ver [Que la dirección no cambie](#que-la-dirección-no-cambie)).
4. Prueba la dirección **desde el propio servidor**, en su navegador. Si allí funciona y fuera no, es el **cortafuegos**: Configuración → Privacidad y seguridad → Seguridad de Windows → **Firewall y protección de red** → **Permitir una aplicación a través del firewall** → **Cambiar la configuración** → marca «Gestión del retiro» en **Privada**. Si no está en la lista, **Permitir otra aplicación** y busca `Gestión del retiro.exe` en la carpeta de instalación.
5. Comprueba que la red del servidor es **Privada** ([paso 3.3](#33-permitir-el-acceso-desde-la-red-cortafuegos-de-windows)).

### «El puerto 3000 ya está en uso»

Otro programa usa ese puerto, o la aplicación ya está abierta (mira la barra de tareas). Si es otro programa, cambia el puerto con un `.env` (ver [Opcional: usar MongoDB](#opcional-usar-mongodb), línea `PORT=3001`) y la dirección pasará a terminar en `:3001`.

### Gmail rechaza la autenticación / dejan de llegar cartas

Con cuentas @gmail.com en modo de prueba, el permiso caduca cada 7 días ([paso 1.3](#13-pantalla-de-consentimiento)). Ve a **Archivo → Conectar con Gmail…** y repite la autorización. Si sigue fallando, en <https://myaccount.google.com/permissions> quita el acceso de «Gestión del retiro» y vuelve a conectar.

### «Quota exceeded» al buscar cartas

Gmail limita las descargas por minuto. Espera un par de minutos y vuelve a buscar. Si pasa a menudo, en **Configuración → Descargas por segundo** pon `5`.

### «El permiso concedido no permite modificar etiquetas»

Activaste las etiquetas de Gmail pero el permiso es de solo lectura. Añade `gmail.modify` en Google Cloud ([paso 1.4](#14-permisos-acceso-a-datos)) y repite **Archivo → Conectar con Gmail…**.

### Otro error

Abre **Archivo → Abrir carpeta de datos** → `logs\servidor.log` y envía las últimas líneas a quien te dé soporte. El registro no contiene el texto de las cartas ni contraseñas.

## Privacidad

- La aplicación lee el buzón **solo en modo lectura** (salvo que actives las etiquetas, que solo añaden y quitan etiquetas).
- Las cartas se guardan **en el servidor**, sin cifrar, en la carpeta de datos del usuario de Windows: protege ese usuario con contraseña y no compartas la carpeta.
- Nada se publica en internet: los demás dispositivos entran por la red local y con el código de acceso. La conexión es `http://` (sin cifrar), así que usa solo redes de confianza, nunca una Wi‑Fi abierta.
- Al cerrar el retiro se borran los datos personales del servidor.
