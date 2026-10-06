# Contexto técnico del proyecto (para quien programe o para otra IA)

Sistema de gestión para **el dueño de un pet shop** en Argentina (vende alimento, accesorios, juguetes, higiene, y ofrece baño y peluquería). Nació como **SYSVET/VETFLOW**, un sistema para veterinarias, y se reconvirtió: se quitó todo lo médico y se agregaron ventas con ganancia, punto de venta, agenda de peluquería y números para el dueño. El dueño no es programador: los mensajes de cara al usuario van en español simple, sin tecnicismos.

## Arquitectura

```
Navegador (HTML + CSS + JS plano, sin build)   public/index.html, styles.css, app.js
        │  fetch() a /api/... (JSON, cookie de sesión)
        ▼
Node.js (http nativo, sin framework)
  server/index.js  → arranque, cabeceras de seguridad (CSP), estáticos, HTTPS forzado, /healthz
  server/api.js    → router propio y TODAS las rutas /api/*
  server/auth.js   → scrypt, cookie firmada HMAC "petshop_session", rate limit de login, primer admin
  server/db.js     → pool "pg" (max 5), parseo NUMERIC→number y DATE→'AAAA-MM-DD', tx(), migrate()
  server/backup.js → copias gzip+base64 dentro de la base (7 automáticas, 10 manuales), export/restore
  server/util.js   → validaciones (reqStr, money, qty, oneOf...), listas fijas (categorías, formas de pago)
        │
        ▼
PostgreSQL en Supabase (plan gratuito, "Session pooler" :5432). db/schema.sql se ejecuta en cada arranque.
```

Hosting: Render Web Service plan Free (`render.yaml`), sin Docker ni CI. Única dependencia: `pg`. No se usa Supabase Storage ni Auth.

## Modelo de datos (db/schema.sql)

- `users` (admin = dueño, staff = empleado).
- `suppliers`, `products` (unit `u`|`kg`, stock/min NUMERIC(12,3), price, **cost** = último costo de compra, pack_kg + loose_id para "abrir bolsa", barcode único opcional, expires_on), `services` (precio + duración).
- `clients` y `pets` (especie, raza, tamaño, nacimiento, notas de peluquería; nada médico).
- `sales` + `sale_items`: cada venta guarda `cost_total` y cada línea `unit_cost` **del momento**, para que la ganancia histórica no cambie si después cambia el costo. Anular = `voided_at` (no se borra), devuelve stock y borra el ingreso de caja.
- `cash_movements` (libro de caja), `stock_movements` (todo movimiento de stock, con `sale_id` / `cash_id` para poder revertir), `appointments` (agenda con estado y `sale_id` al cobrarse), `cash_closings` (arqueo diario), `backups`.

Reglas: el stock nunca queda negativo (lo valida el servidor y un CHECK). Una venta registra UN ingreso en caja por el total. El ingreso de una venta no se borra desde Caja: se anula la venta. Borrar el egreso de una compra resta del stock lo comprado.

## Permisos

Cada ruta declara `{ admin: true }` si es solo del dueño, y `public/app.js` oculta lo mismo (se mantienen sincronizados a mano). El empleado: vende (a precio de lista), ve el stock sin costos, abre bolsas, maneja agenda y clientes, ve las ventas de hoy. No ve costos, ganancias, caja, reportes, copias ni usuarios; no cambia precios ni anula ventas.

## API (resumen)

`/login`, `/logout`, `/me`, `/me/password`, `/users` · `/bootstrap` · `/products` (+ `/purchase`, `/adjust`, `/open-bag`, `/movements`, `/bulk-price`) · `/services` · `/sales` (GET lista, POST venta, GET `/:id`, POST `/:id/void`) · `/cash` (+ `/summary`, `/export`, `/closings`) · `/dashboard` · `/reports/monthly|products|categories|services|staff|sales-export` · `/backups`, `/backup/export`, `/restore` · `/suppliers` · `/clients` (+ `/:id/pets`), `/pets/:id` · `/appointments` (+ `/:id/status`).

## Si se modifica

- Tabla o columna nueva: agregarla a `db/schema.sql` con `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, y si es de negocio, a `TABLES` en `server/backup.js`.
- Listas fijas (categorías, formas de pago): cambiarlas en `server/util.js` **y** en `public/app.js`.
- Variables de entorno nuevas: `.env.example`, `render.yaml` y, si son obligatorias, `checkEnv()` en `server/index.js`.
- No hay suite de pruebas en el repositorio. La reconversión se verificó con chequeo de sintaxis y de referencias cruzadas (rutas, acciones, constantes), **no** contra una base real: el primer despliegue en Render + Supabase es el paso a mirar con atención (Logs de Render).
