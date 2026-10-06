# Sistema de gestión para pet shop — guía para ponerlo en marcha

Sistema pensado para **el dueño del pet shop**: el stock de lo que vendés, las ventas del mostrador, la caja y, sobre todo, **los números** (cuánto vendiste, cuánto ganaste, qué se vende más, qué hay que pedir). También guarda tus clientes con sus mascotas y la agenda de peluquería y baño.

**No trae ningún dato de ejemplo**: arranca vacío para que cargues tus productos, servicios y precios.

## Qué hace

| Pantalla | Para qué sirve | Quién la ve |
|---|---|---|
| **Resumen** | Ventas y ganancia de hoy y del mes, comparación con el mes anterior, efectivo en caja, lo más vendido, poco stock, productos por vencer y turnos del día | Dueño |
| **Vender** | Punto de venta: buscás o escaneás productos, sumás servicios, descuento, cliente (opcional), forma de pago → **Cobrar**. Descuenta el stock, registra el ingreso en caja e imprime un ticket | Todos |
| **Ventas** | Historial de ventas con su ganancia, ticket para reimprimir y **anular venta** (devuelve el stock y saca el ingreso de la caja) | Todos (el empleado solo ve las de hoy, sin ganancias) |
| **Stock** | Catálogo con categorías, marca, código de barras, venta por unidad o **suelto por kilo**, costo, margen, vencimiento, botón **Vender**, "llegó mercadería", ajustes, historial, **abrir bolsa para vender suelto**, **actualizar precios por %** y pestaña **Para pedir** (reposición por proveedor) | Todos (costos y cambios: solo el dueño) |
| **Servicios** | Precios de baño y peluquería (con duración) | Todos (editar: dueño) |
| **Agenda** | Turnos de peluquería por mascota, con estado (reservado, en curso, listo para retirar, entregado, no vino) y botón **Cobrar** | Todos |
| **Clientes** | Contacto, mascotas (especie, raza, tamaño, notas de peluquería), compras y turnos | Todos (borrar: dueño) |
| **Proveedores** | Contacto, productos que te vende y lo que le pagaste | Todos (editar: dueño) |
| **Caja** | Ingresos y egresos con forma de pago, efectivo que debería haber, **cierre de caja diario** y exportación a Excel (CSV) | Dueño |
| **Reportes** | Mes a mes (ventas, costo, ganancia bruta, gastos, resultado), por categoría, por producto (ganancia y cuánto te dura el stock), servicios y ventas por empleado | Dueño |
| **Copias de seguridad** | Copia automática diaria, descarga a tu computadora y espacio usado de la base | Dueño |
| **Usuarios** | Dueño/administrador y empleados | Dueño |

Vas a usar tres servicios gratuitos:

| Servicio | Para qué sirve |
|---|---|
| **Supabase** | Guarda todos los datos (la base de datos) |
| **GitHub** | Guarda estos archivos para que Render los pueda leer |
| **Render** | Hace funcionar el sistema en internet y le pone HTTPS solo |

Tiempo estimado: 30 a 45 minutos.

---

## Paso 1 · Crear la base de datos (Supabase)

1. Entrá a **supabase.com** y creá una cuenta.
2. Tocá **New project**. Poné el nombre `petshop`.
3. En **Database password** elegí una contraseña **solo con letras y números** (sin símbolos como @ # / %) y **guardala**.
4. En **Region** elegí la más cercana (por ejemplo *South America (São Paulo)*).
5. Esperá unos minutos a que termine de crearse.
6. Tocá el botón **Connect** (arriba, en la barra de tu proyecto) y elegí **Session pooler**. Copiá la dirección: empieza con `postgresql://postgres.` y contiene `pooler.supabase.com`.
   - Si no encontrás *Session pooler*: copiá la de **Transaction pooler** (termina en `:6543/postgres`) y cambiá `6543` por `5432`.
   - No uses la dirección que tiene `db.` seguido de tu código y `.supabase.co`: es la conexión directa y desde Render no funciona.
7. Reemplazá `[YOUR-PASSWORD]` por la contraseña del paso 3 (sin los corchetes).

Esa dirección es tu `DATABASE_URL`. **No hace falta crear tablas**: el sistema las crea solo la primera vez.

## Paso 2 · El código en GitHub

El código ya está en el repositorio `Sistema-PetShop`. Render lee la rama que elijas (`main`, una vez que pases estos cambios a esa rama).

## Paso 3 · Poner el sistema en internet (Render)

1. Entrá a **render.com** y creá una cuenta (podés entrar con tu cuenta de GitHub).
2. Tocá **New +** → **Web Service** y conectá el repositorio `Sistema-PetShop`.
3. Completá:
   - **Language / Runtime:** Node
   - **Root Directory:** dejalo vacío (el sistema está en la raíz del repositorio)
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. En **Environment Variables** agregá:

| Nombre | Qué poner |
|---|---|
| `DATABASE_URL` | La dirección del Paso 1 (con tu contraseña) |
| `SESSION_SECRET` | Un texto largo al azar, de 40 caracteres o más |
| `ADMIN_EMAIL` | Tu email (va a ser tu usuario para ingresar) |
| `ADMIN_PASSWORD` | La contraseña con la que vas a ingresar (mínimo 8 caracteres) |
| `NODE_ENV` | `production` |
| `SHOP_NAME` | (opcional) El nombre de tu negocio: aparece en la pantalla y en los tickets |

5. En **Advanced** poné **Health Check Path:** `/healthz`.
6. Tocá **Create Web Service** y esperá. Cuando diga *Live*, Render te muestra la dirección de tu sistema (algo como `https://petshop.onrender.com`).

> Atajo opcional: el proyecto trae un archivo `render.yaml`. Si en Render elegís **New +** → **Blueprint**, carga esta configuración sola y solo te pide `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `SHOP_NAME`.

## Paso 4 · Primer ingreso y carga inicial

1. Abrí la dirección de tu sistema e ingresá con `ADMIN_EMAIL` y `ADMIN_PASSWORD`.
2. Tocá **Cambiar contraseña** (abajo a la izquierda) y poné una que solo vos sepas.
3. **Proveedores:** cargá a quién le comprás.
4. **Stock → Nuevo producto:** cargá cada producto con su **precio de venta** y su **costo** (lo que te cuesta). Sin el costo, el sistema no puede calcular tu ganancia.
   - **Alimento suelto:** creá un producto "Se vende: suelto, por kilo" (por ejemplo *Alimento perro adulto – suelto*). En la bolsa cerrada, completá *Kilos que trae la bolsa* y elegí ese producto suelto: así, con **Abrir bolsa**, los kilos pasan solos al suelto.
5. **Servicios:** cargá los precios de baño y peluquería (tip: uno por tamaño de perro).
6. **Usuarios:** creá a tus empleados. Pueden vender, cobrar, manejar la agenda y los clientes, pero **no ven costos, ganancias, la caja ni los reportes**, y no pueden cambiar precios ni anular ventas.

> Después de que el sistema crea tu usuario, cambiar `ADMIN_PASSWORD` en Render ya no tiene efecto. Para cambiar la contraseña usá el botón dentro del sistema.

## El día a día

- **Vender:** pantalla *Vender* (o botón *Vender* en cada producto del Stock). Con un **lector de código de barras USB** solo pasás el producto: se suma solo a la venta. Con el celular podés usar **📷 Escanear código** (hace falta abrir el sistema con https, como en Render).
- **Llegó mercadería:** en *Stock*, botón **+** del producto (o *Ingresar con escáner*). Suma el stock, actualiza el costo y registra el gasto en caja.
- **Qué pedir:** *Stock → Para pedir* te arma el pedido por proveedor; con **Copiar pedido** lo pegás en WhatsApp o en un mail.
- **Peluquería:** agendá el turno en *Agenda*; cuando el perro está listo, tocá el turno → **Cobrar**.
- **Fin del día:** *Caja → Cierre de caja*: contás la plata, la escribís y el sistema te dice si hay diferencia.
- **Inflación:** *Stock → % Actualizar precios* sube los precios de una categoría, marca o proveedor de una vez, con redondeo.

## Copias de seguridad (leer con atención)

La base de datos gratuita **no incluye copias de seguridad propias**. Por eso el sistema:

- Hace **una copia automática por día**, guardada dentro de la misma base (se conservan las últimas 7). Sirve si borrás algo sin querer.
- Permite **descargar una copia a un archivo** (*Copias de seguridad → Descargar copia a mi computadora*). Esto es lo que te protege de verdad si se perdiera la base.

**Hábito recomendado: descargá una copia por lo menos una vez por semana.** El sistema te avisa a la izquierda si pasaron más de 7 días.

## Cosas que tenés que saber del plan gratuito

- **Render (gratis):** si nadie usa el sistema durante 15 minutos, se "duerme". La próxima vez que alguien lo abra, tarda cerca de un minuto en despertar. Si te molesta en el mostrador, el plan pago más chico (Starter) lo deja siempre encendido.
- **Supabase (gratis):** el proyecto se pausa si pasa una semana sin usarse (usándolo todos los días no pasa). Si se pausa, los datos siguen ahí y lo reactivás desde el panel de Supabase.
- **Espacio:** 500 MB. El sistema guarda solo texto y números (sin fotos ni archivos), así que alcanza para años de ventas. En *Copias de seguridad* ves cuánto espacio usás.

## Seguridad

- Las contraseñas se guardan cifradas. Las sesiones duran 7 días y se cierran solas si cambiás la contraseña.
- Después de 5 intentos fallidos de ingreso, ese usuario se bloquea 15 minutos.
- Toda la comunicación va por HTTPS.
- El ticket que imprime el sistema es un **comprobante interno, no una factura**: la facturación electrónica (ARCA/AFIP) se sigue haciendo por fuera.
- Guardás nombres y teléfonos de tus clientes: conviene tener en cuenta la ley argentina de protección de datos personales.

## Si algo no anda

- **Render dice "Deploy failed" o la página no abre:** Render → tu servicio → **Logs**. Lo más común: falta `DATABASE_URL` o `SESSION_SECRET` (o es muy corto), la contraseña de la base tiene símbolos, o se usó la conexión directa en vez del *Session pooler*.
- **"Email o contraseña incorrectos" con tu usuario:** revisá `ADMIN_EMAIL` y `ADMIN_PASSWORD` en Render.
- **Te olvidaste la contraseña:** otro administrador puede cambiarla desde **Usuarios**.

## Para quien lo mantenga (técnico)

- Node 18 o superior. Única dependencia: `pg`. Sin frameworks: servidor HTTP propio en `server/`, página estática en `public/`. Ver `CONTEXTO-IA.md`.
- Las tablas están en `db/schema.sql` y se crean solas al iniciar (es seguro correrlo varias veces).
- Probarlo en una computadora: copiar `.env.example` como `.env`, cargar las variables (con `DATABASE_SSL=false` si la base es local) y ejecutar `node --env-file=.env server/index.js` (Node 20.6 o superior).
- El lector de códigos usa la librería ZXing (licencia MIT), guardada en `public/vendor/`.
