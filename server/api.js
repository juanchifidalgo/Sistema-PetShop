'use strict';

const db = require('./db');
const auth = require('./auth');
const backup = require('./backup');
const U = require('./util');
const { HttpError } = U;

const routes = [];

/**
 * Registra una ruta. opts: { public: true } no pide sesión; { admin: true } solo administradores;
 * { limit: bytes } tamaño máximo de los datos que se reciben; { multipart: true } recibe archivos (ctx.raw).
 */
function add(method, pattern, opts, fn) {
  if (typeof opts === 'function') {
    fn = opts;
    opts = {};
  }
  const names = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/:([a-z]+)/g, (m, n) => {
        names.push(n);
        return '([^/]+)';
      }) +
      '$'
  );
  routes.push({ method, re, names, opts, fn });
}

function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try {
    return new URL(o).host === req.headers.host;
  } catch (e) {
    return false;
  }
}

async function dispatch(req, res, url) {
  let route = null;
  let match = null;
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(url.pathname);
    if (m) {
      route = r;
      match = m;
      break;
    }
  }
  if (!route) {
    if (routes.some((r) => r.re.test(url.pathname))) throw new HttpError(405, 'Método no permitido');
    throw new HttpError(404, 'No encontrado');
  }
  const params = {};
  try {
    route.names.forEach((n, i) => {
      params[n] = decodeURIComponent(match[i + 1]);
    });
  } catch (e) {
    throw U.bad('Dirección inválida');
  }
  const writes = req.method !== 'GET' && req.method !== 'HEAD';
  if (writes && !sameOrigin(req)) throw new HttpError(403, 'Origen no permitido');

  let user = null;
  if (!route.opts.public) {
    user = await auth.currentUser(req);
    if (!user) throw new HttpError(401, 'Necesitás iniciar sesión');
    if (route.opts.admin && user.role !== 'admin') throw new HttpError(403, 'No tenés permiso para hacer esto');
  }
  let body = {};
  let raw = null;
  if (writes && route.opts.multipart) {
    raw = await U.readRaw(req, route.opts.limit);
  } else if (writes && req.method !== 'DELETE') {
    const len = Number(req.headers['content-length'] || 0);
    if (len > 0 && !String(req.headers['content-type'] || '').includes('application/json')) {
      throw new HttpError(415, 'Formato no permitido');
    }
    body = await U.readBody(req, route.opts.limit || 1024 * 1024);
  }
  const ctx = { req, res, params, query: url.searchParams, body, user, raw };
  const result = await route.fn(ctx);
  if (result === U.HANDLED) return;
  U.sendJson(res, 200, result === undefined ? { ok: true } : result);
}

/* ============================================================
   Datos comunes
   ============================================================ */
const fullName = (first, last) => (String(first || '') + ' ' + String(last || '')).trim();
const isAdmin = (ctx) => ctx.user.role === 'admin';
/** Cantidad legible: "3", "1,5 kg". */
const fmtQty = (n, unit) => String(Number(n)).replace('.', ',') + (unit === 'kg' ? ' kg' : '');

// El costo (precio de compra) es información del dueño: el ayudante no lo ve.
const mapProduct = (r, admin) => ({
  id: r.id,
  name: r.name,
  brand: r.brand,
  category: r.category,
  species: r.species || '',
  unit: r.unit,
  stock: Number(r.stock),
  min: Number(r.min_stock),
  price: Number(r.price),
  cost: admin ? Number(r.cost) : null,
  packKg: r.pack_kg == null ? null : Number(r.pack_kg),
  looseId: r.loose_id || null,
  supplierId: r.supplier_id || null,
  barcode: r.barcode || '',
  expires: r.expires_on || '',
});
const mapService = (r) => ({ id: r.id, name: r.name, category: r.category, price: Number(r.price), duration: r.duration_min });
const mapSupplier = (r) => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, description: r.description });
const mapClient = (r, pets) => ({
  id: r.id,
  firstName: r.first_name,
  lastName: r.last_name,
  name: fullName(r.first_name, r.last_name),
  phone: r.phone,
  email: r.email,
  address: r.address,
  notes: r.notes,
  pets: pets || [],
});
const mapPet = (r) => ({ id: r.id, clientId: r.client_id, name: r.name, species: r.species, breed: r.breed, size: r.size || '', birth: r.birth || '', notes: r.notes });
const mapCash = (r) => ({
  id: r.id,
  date: r.on_date,
  type: r.kind,
  concept: r.concept,
  category: r.category,
  method: r.method,
  amount: Number(r.amount),
  saleId: r.sale_id || null,
  stockDelta: Number(r.stock_delta || 0),
});

async function listProducts(admin) {
  const r = await db.query('SELECT * FROM products ORDER BY lower(name), id');
  return r.rows.map((x) => mapProduct(x, admin));
}
async function listServices() {
  const r = await db.query('SELECT id, name, category, price, duration_min FROM services ORDER BY lower(name), id');
  return r.rows.map(mapService);
}
async function listClients() {
  const [cl, pt] = await Promise.all([
    db.query('SELECT * FROM clients ORDER BY lower(last_name), lower(first_name), id'),
    db.query('SELECT * FROM pets ORDER BY lower(name), id'),
  ]);
  const by = {};
  pt.rows.forEach((x) => (by[x.client_id] = by[x.client_id] || []).push(mapPet(x)));
  return cl.rows.map((r) => mapClient(r, by[r.id]));
}

/** Efectivo que debería haber en la caja al cierre de `date` (ingresos menos egresos en efectivo). */
async function drawerAt(q, date) {
  const r = await q.query(
    "SELECT COALESCE(SUM(CASE WHEN kind = 'in' THEN amount ELSE -amount END), 0) AS total FROM cash_movements WHERE method = 'Efectivo' AND on_date <= $1",
    [date]
  );
  return U.round2(Number(r.rows[0].total));
}

async function cashSummary() {
  const today = U.todayAR();
  const monthFrom = today.slice(0, 7) + '-01';
  const monthTo = U.monthEnd(today);
  const [rows, drawer] = await Promise.all([
    db.query('SELECT on_date, kind, method, amount FROM cash_movements WHERE on_date >= $1 AND on_date <= $2', [monthFrom, monthTo]),
    drawerAt(db, today),
  ]);
  const m = { in: 0, out: 0, efe: 0, tra: 0, tar: 0, byMethod: {} };
  U.METHODS.forEach((x) => {
    m.byMethod[x] = 0;
  });
  const t = { in: 0, out: 0 };
  rows.rows.forEach((r) => {
    const a = Number(r.amount);
    if (r.kind === 'in') {
      m.in += a;
      m.byMethod[r.method] = (m.byMethod[r.method] || 0) + a;
      if (r.method === 'Efectivo') m.efe += a;
      else if (r.method === 'Transferencia') m.tra += a;
      else m.tar += a;
    } else {
      m.out += a;
    }
    if (r.method === 'Efectivo' && r.on_date === today) {
      if (r.kind === 'in') t.in += a;
      else t.out += a;
    }
  });
  ['in', 'out', 'efe', 'tra', 'tar'].forEach((k) => {
    m[k] = U.round2(m[k]);
  });
  Object.keys(m.byMethod).forEach((k) => {
    m.byMethod[k] = U.round2(m.byMethod[k]);
  });
  return { today, month: m, drawer, todayCash: { in: U.round2(t.in), out: U.round2(t.out) } };
}

async function mustExist(q, table, id, message) {
  const r = await q.query('SELECT id FROM ' + table + ' WHERE id = $1', [id]);
  if (!r.rows[0]) throw new HttpError(404, message);
}

/** Código de barras opcional de un producto: no puede repetirse. `exceptId` = el propio producto al editar. */
async function checkBarcode(q, raw, exceptId) {
  const code = U.optBarcode(raw);
  if (!code) return null;
  const r = await q.query('SELECT name FROM products WHERE barcode = $1 AND id <> $2', [code, exceptId || 0]);
  if (r.rows[0]) throw new HttpError(409, 'Ese código de barras ya pertenece al producto “' + r.rows[0].name + '”.');
  return code;
}
/** Proveedor opcional: si se indica, tiene que existir. */
async function optSupplier(q, v) {
  if (v == null || v === '') return null;
  const id = U.idParam(v);
  await mustExist(q, 'suppliers', id, 'No se encontró el proveedor');
  return id;
}

/**
 * Descuenta stock dentro de una transacción. Si no alcanza, rechaza con
 * "No hay stock suficiente de {producto} (quedan {n})" y no toca nada. Registra el movimiento de stock.
 */
async function deductStock(c, productId, qty, reason, date, userId, o) {
  o = o || {};
  const r = await c.query('UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING name, stock, unit', [qty, productId]);
  if (!r.rows[0]) {
    const e = await c.query('SELECT name, stock, unit FROM products WHERE id = $1', [productId]);
    if (!e.rows[0]) throw new HttpError(404, 'No se encontró el producto');
    throw new HttpError(409, 'No hay stock suficiente de ' + e.rows[0].name + ' (quedan ' + fmtQty(Math.max(0, e.rows[0].stock), e.rows[0].unit) + ')');
  }
  const m = await c.query(
    'INSERT INTO stock_movements (product_id, product_name, on_date, qty, reason, created_by, unit_price, sale_id, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
    [productId, r.rows[0].name, date, -qty, reason, userId, o.unitPrice || 0, o.saleId || null, o.note || '']
  );
  return { movementId: m.rows[0].id, name: r.rows[0].name, stock: Number(r.rows[0].stock) };
}

/**
 * Revierte movimientos de stock (los anula, devuelve o resta las unidades y deja "Anulación de ...").
 * Si restar dejaría el stock en negativo, rechaza todo. Devuelve el neto.
 */
async function revertStockMovements(c, ids, userId) {
  let net = 0;
  for (const mid of ids) {
    const sm = (await c.query('SELECT id, product_id, qty, voided FROM stock_movements WHERE id = $1 FOR UPDATE', [mid])).rows[0];
    if (!sm || sm.voided || !sm.product_id) continue;
    const delta = -Number(sm.qty); // venta (qty < 0): vuelve al stock; compra (qty > 0): se resta
    const u = await c.query('UPDATE products SET stock = stock + $1 WHERE id = $2 AND stock + $1 >= 0 RETURNING name', [delta, sm.product_id]);
    if (!u.rows[0]) {
      const e = (await c.query('SELECT name, stock, unit FROM products WHERE id = $1', [sm.product_id])).rows[0];
      if (!e) continue; // el producto ya no existe
      throw new HttpError(409, 'No se puede deshacer: al restar ' + fmtQty(-delta, e.unit) + ' de ' + e.name + ' el stock quedaría en negativo (hay ' + fmtQty(e.stock, e.unit) + ')');
    }
    await c.query('INSERT INTO stock_movements (product_id, product_name, on_date, qty, reason, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [
      sm.product_id, u.rows[0].name, U.todayAR(), delta, delta > 0 ? 'Anulación de venta' : 'Anulación de compra', userId,
    ]);
    await c.query('UPDATE stock_movements SET voided = TRUE WHERE id = $1', [sm.id]);
    net = U.round3(net + delta);
  }
  return net;
}
/* ============================================================
   Sesión y usuarios
   ============================================================ */
function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 8) throw U.bad('La contraseña debe tener al menos 8 caracteres');
  if (p.length > 200) throw U.bad('La contraseña es demasiado larga');
  return p;
}

add('POST', '/api/login', { public: true }, async (ctx) => {
  const email = U.reqStr(ctx.body.email, 'Email', 200).toLowerCase();
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  const key = U.clientIp(ctx.req) + '|' + email;
  const wait = auth.throttleCheck(key);
  if (wait > 0) throw new HttpError(429, 'Demasiados intentos. Probá de nuevo en ' + Math.ceil(wait / 60) + ' minutos.');
  const r = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  const u = r.rows[0];
  let ok = false;
  if (u) ok = await auth.verifyPassword(password, u.password_hash);
  else await auth.verifyPassword(password, await auth.dummyHash());
  if (!ok || !u.active) {
    auth.throttleFail(key);
    throw new HttpError(401, 'Email o contraseña incorrectos');
  }
  auth.throttleOk(key);
  auth.setSession(ctx.res, u);
  backup.ensureDaily().catch((e) => console.error('Copia diaria:', e.message));
  return { user: { id: u.id, name: u.name, email: u.email, role: u.role } };
});

add('POST', '/api/logout', { public: true }, async (ctx) => {
  auth.clearSession(ctx.res);
});

add('GET', '/api/me', async (ctx) => ({ user: ctx.user }));

add('POST', '/api/me/password', async (ctx) => {
  const r = await db.query('SELECT * FROM users WHERE id = $1', [ctx.user.id]);
  const u = r.rows[0];
  if (!(await auth.verifyPassword(String(ctx.body.current || ''), u.password_hash))) {
    throw U.bad('La contraseña actual no es correcta');
  }
  const hash = await auth.hashPassword(checkPassword(ctx.body.password));
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, u.id]);
  u.password_hash = hash;
  auth.setSession(ctx.res, u);
});

add('GET', '/api/users', { admin: true }, async () => {
  const r = await db.query('SELECT id, email, name, role, active FROM users ORDER BY lower(name), id');
  return { items: r.rows.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: !!u.active })) };
});

add('POST', '/api/users', { admin: true }, async (ctx) => {
  const b = ctx.body;
  const name = U.reqStr(b.name, 'Nombre', 100);
  const email = U.checkEmail(U.reqStr(b.email, 'Email', 150).toLowerCase());
  const pw = checkPassword(b.password);
  const role = U.oneOf(b.role, ['admin', 'staff'], 'Rol');
  try {
    await db.query('INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)', [
      email,
      name,
      await auth.hashPassword(pw),
      role,
    ]);
  } catch (e) {
    if (e.code === '23505' || /UNIQUE/i.test(e.message)) throw new HttpError(409, 'Ya existe un usuario con ese email');
    throw e;
  }
});

add('PATCH', '/api/users/:id', { admin: true }, async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const b = ctx.body;
  const cur = (await db.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
  if (!cur) throw new HttpError(404, 'No se encontró el usuario');
  const name = b.name !== undefined ? U.reqStr(b.name, 'Nombre', 100) : cur.name;
  const role = b.role !== undefined ? U.oneOf(b.role, ['admin', 'staff'], 'Rol') : cur.role;
  const active = b.active !== undefined ? !!b.active : !!cur.active;
  if (id === ctx.user.id && (role !== 'admin' || !active)) {
    throw U.bad('No podés quitarte el rol de administrador ni desactivarte a vos mismo');
  }
  if (cur.role === 'admin' && (role !== 'admin' || !active)) {
    const n = (await db.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = $1 AND id <> $2", [true, id])).rows[0].n;
    if (Number(n) < 1) throw U.bad('Tiene que quedar al menos un administrador activo');
  }
  let hash = cur.password_hash;
  if (b.password !== undefined && b.password !== '') hash = await auth.hashPassword(checkPassword(b.password));
  await db.query('UPDATE users SET name = $1, role = $2, active = $3, password_hash = $4 WHERE id = $5', [name, role, active, hash, id]);
});

/* ============================================================
   Arranque de la pantalla
   ============================================================ */
add('GET', '/api/bootstrap', async (ctx) => {
  const admin = isAdmin(ctx);
  const [products, services, sup, clients] = await Promise.all([
    listProducts(admin),
    listServices(),
    db.query('SELECT id, name, phone, email, description FROM suppliers ORDER BY lower(name), id'),
    listClients(),
  ]);
  const out = { user: ctx.user, shop: process.env.SHOP_NAME || 'Mi Pet Shop', products, services, suppliers: sup.rows.map(mapSupplier), clients };
  if (admin) out.summary = await cashSummary();
  return out;
});

/* ============================================================
   Productos (catálogo y stock)
   ============================================================ */
function productInput(b) {
  const unit = U.oneOf(b.unit || 'u', U.UNITS, 'Unidad de venta');
  const packKg = b.packKg == null || b.packKg === '' ? null : U.reqNum(b.packKg, 'Kilos que trae la bolsa', 0.001, 1000);
  return {
    name: U.reqStr(b.name, 'Nombre', 200),
    brand: U.optStr(b.brand, 100),
    category: U.oneOf(b.category, U.PROD_CATS, 'Categoría'),
    species: U.optOneOf(b.species, U.SPECIES_OPTS, 'Para qué mascota'),
    unit,
    price: U.money(b.price, 'Precio de venta'),
    min: U.qty(b.min == null || b.min === '' ? 0 : b.min, 'Stock mínimo', unit, { allowZero: true }),
    expires: U.optDate(b.expires, 'Vencimiento'),
    packKg: unit === 'u' ? packKg : null,
    looseId: unit === 'u' && b.looseId ? U.idParam(b.looseId) : null,
  };
}
/** La bolsa se abre hacia un producto suelto (por kilo) que no sea ella misma. */
async function checkLoose(q, looseId, selfId) {
  if (!looseId) return null;
  if (looseId === selfId) throw U.bad('El producto suelto tiene que ser otro producto');
  const r = await q.query('SELECT unit FROM products WHERE id = $1', [looseId]);
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró el producto suelto');
  if (r.rows[0].unit !== 'kg') throw U.bad('El producto suelto tiene que venderse por kilo');
  return looseId;
}

add('POST', '/api/products', { admin: true }, async (ctx) => {
  const b = ctx.body;
  const p = productInput(b);
  const supplierId = await optSupplier(db, b.supplierId);
  const barcode = await checkBarcode(db, b.barcode, 0);
  const looseId = await checkLoose(db, p.looseId, 0);
  const stock = U.qty(b.stock == null || b.stock === '' ? 0 : b.stock, 'Stock inicial', p.unit, { allowZero: true });
  const cost = b.cost == null || b.cost === '' ? 0 : U.money(b.cost, 'Costo');
  const total = U.round2(cost * stock);
  const toCash = !!b.cash && total > 0;
  const method = toCash ? U.oneOf(b.method, U.METHODS, 'Forma de pago') : null;
  const today = U.todayAR();
  return db.tx(async (c) => {
    const r = await c.query(
      'INSERT INTO products (name, brand, category, species, unit, stock, min_stock, price, cost, pack_kg, loose_id, supplier_id, barcode, expires_on) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id',
      [p.name, p.brand, p.category, p.species, p.unit, stock, p.min, p.price, cost, p.packKg, looseId, supplierId, barcode, p.expires]
    );
    const id = r.rows[0].id;
    if (stock > 0) {
      let cashId = null;
      if (toCash) {
        const cm = await c.query(
          'INSERT INTO cash_movements (on_date, kind, concept, category, method, amount, created_by, supplier_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
          [today, 'out', 'Compra de mercadería – ' + fmtQty(stock, p.unit) + ' × ' + p.name, 'Compra de mercadería', method, total, ctx.user.id, supplierId]
        );
        cashId = cm.rows[0].id;
      }
      await c.query(
        'INSERT INTO stock_movements (product_id, product_name, on_date, qty, reason, created_by, unit_price, supplier_id, cash_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [id, p.name, today, stock, 'Stock inicial', ctx.user.id, cost, supplierId, cashId]
      );
    }
    return { id };
  });
});

add('PUT', '/api/products/:id', { admin: true }, async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const b = ctx.body;
  const p = productInput(b);
  const supplierId = await optSupplier(db, b.supplierId);
  const barcode = await checkBarcode(db, b.barcode, id);
  const looseId = await checkLoose(db, p.looseId, id);
  const cost = b.cost == null || b.cost === '' ? 0 : U.money(b.cost, 'Costo');
  return db.tx(async (c) => {
    const cur = (await c.query('SELECT stock, unit FROM products WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!cur) throw new HttpError(404, 'No se encontró el producto');
    if (p.unit === 'u' && !Number.isInteger(Number(cur.stock))) throw U.bad('El stock actual tiene decimales: no se puede pasar a venta por unidad. Ajustá el stock primero.');
    if (p.unit === 'u' && cur.unit === 'kg') {
      const n = Number((await c.query('SELECT COUNT(*) AS n FROM products WHERE loose_id = $1', [id])).rows[0].n);
      if (n) throw U.bad('Hay bolsas que se abren hacia este producto suelto: tiene que seguir vendiéndose por kilo.');
    }
    await c.query(
      'UPDATE products SET name = $1, brand = $2, category = $3, species = $4, unit = $5, min_stock = $6, price = $7, cost = $8, pack_kg = $9, loose_id = $10, supplier_id = $11, barcode = $12, expires_on = $13 WHERE id = $14',
      [p.name, p.brand, p.category, p.species, p.unit, p.min, p.price, cost, p.packKg, looseId, supplierId, barcode, p.expires, id]
    );
  });
});

add('DELETE', '/api/products/:id', { admin: true }, async (ctx) => {
  const r = await db.query('DELETE FROM products WHERE id = $1 RETURNING id', [U.idParam(ctx.params.id)]);
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró el producto');
});

// Llegó mercadería: suma al stock, actualiza el costo y, si se indica, registra el egreso en caja.
add('POST', '/api/products/:id/purchase', { admin: true }, async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const b = ctx.body;
  const prod = (await db.query('SELECT unit FROM products WHERE id = $1', [id])).rows[0];
  if (!prod) throw new HttpError(404, 'No se encontró el producto');
  const qty = U.qty(b.qty, 'Cantidad', prod.unit);
  const noPrice = b.unitPrice == null || b.unitPrice === '';
  if (noPrice && b.cash) throw U.bad('Ingresá el precio de compra para registrar el egreso en caja (o destildá “Registrar como egreso en caja”).');
  const unitPrice = noPrice ? 0 : U.moneyPos(b.unitPrice, 'Precio de compra');
  const cost = U.round2(unitPrice * qty);
  const date = U.pastDate(b.date, 'Fecha de compra');
  const toCash = !!b.cash && cost > 0;
  const method = toCash ? U.oneOf(b.method, U.METHODS, 'Forma de pago') : null;
  const supplierId = await optSupplier(db, b.supplierId);
  const expires = U.optDate(b.expires, 'Vencimiento');
  return db.tx(async (c) => {
    const r = await c.query(
      'UPDATE products SET stock = stock + $1, cost = CASE WHEN $3::numeric > 0 THEN $3::numeric ELSE cost END, expires_on = COALESCE($4, expires_on) WHERE id = $2 RETURNING name, stock, unit',
      [qty, id, unitPrice, expires]
    );
    if (!r.rows[0]) throw new HttpError(404, 'No se encontró el producto');
    const p = r.rows[0];
    let cashId = null;
    if (toCash) {
      const cm = await c.query(
        'INSERT INTO cash_movements (on_date, kind, concept, category, method, amount, created_by, supplier_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
        [date, 'out', 'Compra de mercadería – ' + fmtQty(qty, p.unit) + ' × ' + p.name, 'Compra de mercadería', method, cost, ctx.user.id, supplierId]
      );
      cashId = cm.rows[0].id;
    }
    await c.query(
      'INSERT INTO stock_movements (product_id, product_name, on_date, qty, reason, created_by, unit_price, supplier_id, cash_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, p.name, date, qty, 'Compra', ctx.user.id, unitPrice, supplierId, cashId]
    );
    return { ok: true, stock: Number(p.stock), cost };
  });
});

// Corrección de stock (pérdidas, roturas, vencidos, uso en peluquería). No toca la caja.
add('POST', '/api/products/:id/adjust', { admin: true }, async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const prod = (await db.query('SELECT unit FROM products WHERE id = $1', [id])).rows[0];
  if (!prod) throw new HttpError(404, 'No se encontró el producto');
  const delta = U.qty(ctx.body.delta, 'Cantidad', prod.unit, { allowNeg: true });
  const reason = U.oneOf(ctx.body.reason, U.ADJUST_REASONS, 'Motivo');
  const note = U.optStr(ctx.body.note, 200);
  return db.tx(async (c) => {
    const r = await c.query('UPDATE products SET stock = stock + $1 WHERE id = $2 AND stock + $1 >= 0 RETURNING name, stock, unit', [delta, id]);
    if (!r.rows[0]) {
      const e = await c.query('SELECT stock, unit FROM products WHERE id = $1', [id]);
      throw new HttpError(409, 'El stock no puede quedar en negativo (hay ' + fmtQty(e.rows[0].stock, e.rows[0].unit) + ')');
    }
    await c.query('INSERT INTO stock_movements (product_id, product_name, on_date, qty, reason, created_by, note) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
      id, r.rows[0].name, U.todayAR(), delta, 'Ajuste – ' + reason, ctx.user.id, note,
    ]);
    return { ok: true, stock: Number(r.rows[0].stock) };
  });
});

// Abrir bolsas para vender suelto: resta bolsas cerradas y suma sus kilos al producto suelto (que toma el
// costo por kilo de la bolsa, así la ganancia de lo vendido suelto se calcula bien).
add('POST', '/api/products/:id/open-bag', async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const bags = U.qty(ctx.body.bags == null || ctx.body.bags === '' ? 1 : ctx.body.bags, 'Cantidad de bolsas', 'u');
  const today = U.todayAR();
  return db.tx(async (c) => {
    const bag = (await c.query('SELECT name, unit, pack_kg, loose_id, cost FROM products WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!bag) throw new HttpError(404, 'No se encontró el producto');
    if (!bag.pack_kg || !bag.loose_id) throw U.bad('Para abrir bolsas, cargá en “Editar” los kilos que trae y el producto suelto al que pasan.');
    const kg = U.round3(bags * Number(bag.pack_kg));
    const d = await deductStock(c, id, bags, 'Bolsa abierta para suelto', today, ctx.user.id);
    const costKg = Number(bag.cost) > 0 ? U.round2(Number(bag.cost) / Number(bag.pack_kg)) : 0;
    const l = await c.query(
      'UPDATE products SET stock = stock + $1, cost = CASE WHEN $3::numeric > 0 THEN $3::numeric ELSE cost END WHERE id = $2 RETURNING name, stock',
      [kg, bag.loose_id, costKg]
    );
    if (!l.rows[0]) throw new HttpError(404, 'No se encontró el producto suelto');
    await c.query('INSERT INTO stock_movements (product_id, product_name, on_date, qty, reason, created_by, unit_price, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
      bag.loose_id, l.rows[0].name, today, kg, 'Desde bolsa abierta', ctx.user.id, costKg, bags + ' × ' + d.name,
    ]);
    return { ok: true, kg, loose: l.rows[0].name, looseStock: Number(l.rows[0].stock) };
  });
});

// Historial de compras, ventas y ajustes de un producto.
add('GET', '/api/products/:id/movements', { admin: true }, async (ctx) => {
  const id = U.idParam(ctx.params.id);
  await mustExist(db, 'products', id, 'No se encontró el producto');
  const r = await db.query(
    'SELECT id, on_date, qty, reason, unit_price, note, voided, sale_id FROM stock_movements WHERE product_id = $1 ORDER BY on_date DESC, id DESC LIMIT 200',
    [id]
  );
  return {
    items: r.rows.map((x) => ({ id: x.id, date: x.on_date, qty: Number(x.qty), reason: x.reason, unitPrice: Number(x.unit_price), note: x.note || '', voided: !!x.voided, saleId: x.sale_id })),
  };
});

// Actualización masiva de precios: sube (o baja) un porcentaje a todos los productos de una categoría,
// marca o proveedor, con redondeo opcional ($10, $50, $100).
add('POST', '/api/products/bulk-price', { admin: true }, async (ctx) => {
  const b = ctx.body;
  const scope = U.oneOf(b.scope, ['all', 'category', 'brand', 'supplier'], 'A qué productos');
  const pct = U.reqNum(b.percent, 'Porcentaje', -90, 1000);
  if (pct === 0) throw U.bad('El porcentaje no puede ser cero');
  const round = U.oneOf(Number(b.round || 0), [0, 1, 10, 50, 100], 'Redondeo');
  const where = [];
  const params = [1 + pct / 100];
  if (scope === 'category') {
    params.push(U.oneOf(b.value, U.PROD_CATS, 'Categoría'));
    where.push('category = $2');
  } else if (scope === 'brand') {
    params.push(U.reqStr(b.value, 'Marca', 100).toLowerCase());
    where.push('lower(brand) = $2');
  } else if (scope === 'supplier') {
    params.push(U.idParam(b.value));
    where.push('supplier_id = $2');
  }
  const expr = round > 0 ? 'GREATEST(ROUND(price * $1 / ' + round + ') * ' + round + ', 0)' : 'ROUND(price * $1, 2)';
  const r = await db.query('UPDATE products SET price = ' + expr + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' RETURNING id', params);
  return { ok: true, updated: r.rowCount };
});

/* ============================================================
   Lista de precios de servicios (baño y peluquería)
   ============================================================ */
function serviceInput(b) {
  return [
    U.reqStr(b.name, 'Servicio', 200),
    U.oneOf(b.category, U.SERV_CATS, 'Categoría'),
    U.money(b.price, 'Precio'),
    U.reqInt(b.duration == null || b.duration === '' ? 60 : b.duration, 'Duración', 5, 600),
  ];
}
add('POST', '/api/services', { admin: true }, async (ctx) => {
  const r = await db.query('INSERT INTO services (name, category, price, duration_min) VALUES ($1, $2, $3, $4) RETURNING id', serviceInput(ctx.body));
  return { id: r.rows[0].id };
});
add('PUT', '/api/services/:id', { admin: true }, async (ctx) => {
  const r = await db.query('UPDATE services SET name = $1, category = $2, price = $3, duration_min = $4 WHERE id = $5 RETURNING id', serviceInput(ctx.body).concat([U.idParam(ctx.params.id)]));
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró el servicio');
});
add('DELETE', '/api/services/:id', { admin: true }, async (ctx) => {
  await db.query('DELETE FROM services WHERE id = $1', [U.idParam(ctx.params.id)]);
});

/* ============================================================
   Ventas
   Una venta (ticket) tiene una o más líneas: productos del stock y/o servicios. Descuenta el stock,
   registra UN ingreso en la caja por el total y guarda el costo de lo vendido para calcular la ganancia.
   Si algo no tiene stock suficiente, no se guarda nada.
   ============================================================ */
add('POST', '/api/sales', async (ctx) => {
  const b = ctx.body;
  const admin = isAdmin(ctx);
  const method = U.oneOf(b.method, U.METHODS, 'Forma de pago');
  // El ayudante vende con fecha de hoy; el dueño puede cargar una venta de un día anterior.
  const date = admin && b.date ? U.pastDate(b.date, 'Fecha de la venta') : U.todayAR();
  const raw = Array.isArray(b.items) ? b.items : [];
  if (!raw.length) throw U.bad('Agregá al menos un producto o servicio');
  if (raw.length > 50) throw U.bad('Hay demasiadas líneas en la venta');
  const disc = b.discount && typeof b.discount === 'object' && b.discount.value !== '' && b.discount.value != null ? b.discount : null;
  const discType = disc ? U.oneOf(disc.type, ['amount', 'percent'], 'Tipo de descuento') : null;
  const discValue = disc ? U.reqNum(disc.value, 'Descuento', 0, 1e9) : 0;
  if (discType === 'percent' && discValue > 100) throw U.bad('El descuento no puede ser mayor a 100%');
  const note = U.optStr(b.note, 300);
  const clientId = b.clientId ? U.idParam(b.clientId) : null;
  const petId = b.petId ? U.idParam(b.petId) : null;
  const apptId = b.appointmentId ? U.idParam(b.appointmentId) : null;
  return db.tx(async (c) => {
    if (clientId) await mustExist(c, 'clients', clientId, 'No se encontró el cliente');
    if (petId) {
      const pt = (await c.query('SELECT client_id FROM pets WHERE id = $1', [petId])).rows[0];
      if (!pt) throw new HttpError(404, 'No se encontró la mascota');
      if (clientId && pt.client_id !== clientId) throw U.bad('La mascota no es de ese cliente');
    }
    const lines = [];
    for (const it of raw) {
      if (!it || typeof it !== 'object') throw U.bad('Hay una línea inválida');
      const type = U.oneOf(it.type, ['product', 'service'], 'Tipo de línea');
      const id = U.idParam(it.id);
      // Cambiar el precio de una línea es cosa del dueño: el ayudante cobra el precio de lista.
      const override = admin && it.price != null && it.price !== '' ? U.money(it.price, 'Precio') : null;
      if (type === 'product') {
        const pr = (await c.query('SELECT name, category, unit, price, cost FROM products WHERE id = $1', [id])).rows[0];
        if (!pr) throw new HttpError(404, 'No se encontró uno de los productos');
        lines.push({
          type, id, name: pr.name, category: pr.category, unit: pr.unit,
          qty: U.qty(it.qty == null || it.qty === '' ? 1 : it.qty, 'Cantidad de ' + pr.name, pr.unit),
          price: override != null ? override : Number(pr.price),
          cost: Number(pr.cost),
        });
      } else {
        const sv = (await c.query('SELECT name, category, price FROM services WHERE id = $1', [id])).rows[0];
        if (!sv) throw new HttpError(404, 'No se encontró uno de los servicios');
        lines.push({
          type, id, name: sv.name, category: sv.category, unit: 'u',
          qty: U.qty(it.qty == null || it.qty === '' ? 1 : it.qty, 'Cantidad de ' + sv.name, 'u'),
          price: override != null ? override : Number(sv.price),
          cost: 0,
        });
      }
    }
    let subtotal = 0;
    let costTotal = 0;
    lines.forEach((ln) => {
      ln.sub = U.round2(ln.price * ln.qty);
      subtotal += ln.sub;
      costTotal += ln.cost * ln.qty;
    });
    subtotal = U.round2(subtotal);
    costTotal = U.round2(costTotal);
    const discount = discType === 'percent' ? U.round2((subtotal * discValue) / 100) : U.round2(discValue);
    if (discount > subtotal) throw U.bad('El descuento no puede ser mayor al subtotal');
    const total = U.round2(subtotal - discount);
    // El descuento se reparte entre las líneas en proporción a su importe (la última absorbe el redondeo),
    // así las líneas suman exactamente el total y los reportes por producto muestran lo realmente cobrado.
    let left = discount;
    lines.forEach((ln, i) => {
      const part = i === lines.length - 1 ? left : subtotal > 0 ? U.round2((discount * ln.sub) / subtotal) : 0;
      ln.amount = U.round2(ln.sub - part);
      left = U.round2(left - part);
    });
    const s = await c.query(
      'INSERT INTO sales (on_date, client_id, pet_id, method, subtotal, discount, total, cost_total, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
      [date, clientId, petId, method, subtotal, discount, total, costTotal, note, ctx.user.id]
    );
    const saleId = s.rows[0].id;
    for (const ln of lines) {
      await c.query(
        'INSERT INTO sale_items (sale_id, kind, product_id, service_id, name, category, unit, qty, unit_price, unit_cost, amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
        [saleId, ln.type, ln.type === 'product' ? ln.id : null, ln.type === 'service' ? ln.id : null, ln.name, ln.category, ln.unit, ln.qty, ln.price, ln.cost, ln.amount]
      );
      if (ln.type === 'product') await deductStock(c, ln.id, ln.qty, 'Venta', date, ctx.user.id, { saleId, unitPrice: ln.price });
    }
    if (total > 0) {
      const label = lines.length === 1 ? (lines[0].qty !== 1 ? fmtQty(lines[0].qty, lines[0].unit) + ' × ' : '') + lines[0].name : lines.length + ' artículos';
      const cm = await c.query(
        'INSERT INTO cash_movements (on_date, kind, concept, category, method, amount, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [date, 'in', 'Venta N° ' + saleId + ' – ' + label, 'Ventas', method, total, ctx.user.id]
      );
      await c.query('UPDATE sales SET cash_id = $1 WHERE id = $2', [cm.rows[0].id, saleId]);
    }
    if (apptId) {
      const a = await c.query("UPDATE appointments SET sale_id = $1, status = 'entregado' WHERE id = $2 RETURNING id", [saleId, apptId]);
      if (!a.rows[0]) throw new HttpError(404, 'No se encontró el turno');
    }
    return { ok: true, id: saleId, total, discount };
  });
});

const SALE_COLS =
  's.id, s.on_date, s.method, s.subtotal, s.discount, s.total, s.cost_total, s.note, s.voided_at, s.void_reason, s.created_at, s.client_id, s.pet_id, ' +
  'c.first_name, c.last_name, pt.name AS pet_name, u.name AS seller';
const SALE_FROM = ' FROM sales s LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN pets pt ON pt.id = s.pet_id LEFT JOIN users u ON u.id = s.created_by';
const mapSale = (r, admin) => ({
  id: r.id,
  date: r.on_date,
  createdAt: r.created_at,
  method: r.method,
  subtotal: Number(r.subtotal),
  discount: Number(r.discount),
  total: Number(r.total),
  profit: admin ? U.round2(Number(r.total) - Number(r.cost_total)) : null,
  note: r.note,
  voided: !!r.voided_at,
  voidReason: r.void_reason,
  clientId: r.client_id || null,
  client: r.first_name != null ? fullName(r.first_name, r.last_name) : '',
  pet: r.pet_name || '',
  seller: r.seller || '',
  summary: r.summary || '',
});

// Lista de ventas. El ayudante ve solo las de hoy (para reimprimir un ticket); el dueño, cualquier período.
add('GET', '/api/sales', async (ctx) => {
  const admin = isAdmin(ctx);
  const today = U.todayAR();
  let from = today;
  let to = today;
  if (admin && (ctx.query.get('from') || ctx.query.get('to'))) {
    from = U.reqDate(ctx.query.get('from') || '', 'Desde');
    to = U.reqDate(ctx.query.get('to') || '', 'Hasta');
    if (to < from) throw U.bad('El rango de fechas no es válido');
  }
  const r = await db.query(
    'SELECT ' + SALE_COLS + ", (SELECT string_agg(i.name, ', ' ORDER BY i.id) FROM sale_items i WHERE i.sale_id = s.id) AS summary" +
      SALE_FROM + ' WHERE s.on_date BETWEEN $1 AND $2 ORDER BY s.on_date DESC, s.id DESC LIMIT 500',
    [from, to]
  );
  const items = r.rows.map((x) => mapSale(x, admin));
  const ok = items.filter((x) => !x.voided);
  return {
    from, to, items, limited: r.rows.length === 500,
    totals: { count: ok.length, total: U.round2(ok.reduce((n, x) => n + x.total, 0)), profit: admin ? U.round2(ok.reduce((n, x) => n + x.profit, 0)) : null },
  };
});

add('GET', '/api/sales/:id', async (ctx) => {
  const admin = isAdmin(ctx);
  const id = U.idParam(ctx.params.id);
  const r = await db.query('SELECT ' + SALE_COLS + SALE_FROM + ' WHERE s.id = $1', [id]);
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró la venta');
  const it = await db.query('SELECT kind, name, unit, qty, unit_price, unit_cost, amount FROM sale_items WHERE sale_id = $1 ORDER BY id', [id]);
  return Object.assign(mapSale(r.rows[0], admin), {
    items: it.rows.map((x) => ({ kind: x.kind, name: x.name, unit: x.unit, qty: Number(x.qty), price: Number(x.unit_price), cost: admin ? Number(x.unit_cost) : null, amount: Number(x.amount) })),
  });
});

// Anular una venta: devuelve el stock, quita el ingreso de la caja y la deja marcada como anulada (no se borra).
add('POST', '/api/sales/:id/void', { admin: true }, async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const reason = U.optStr(ctx.body.reason, 200);
  return db.tx(async (c) => {
    const s = (await c.query('SELECT cash_id, voided_at FROM sales WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!s) throw new HttpError(404, 'No se encontró la venta');
    if (s.voided_at) throw new HttpError(409, 'Esa venta ya estaba anulada');
    const mv = await c.query('SELECT id FROM stock_movements WHERE sale_id = $1 AND NOT voided ORDER BY id', [id]);
    const stockDelta = await revertStockMovements(c, mv.rows.map((x) => x.id), ctx.user.id);
    await c.query('UPDATE sales SET voided_at = now(), void_reason = $2, cash_id = NULL WHERE id = $1', [id, reason]);
    if (s.cash_id) await c.query('DELETE FROM cash_movements WHERE id = $1', [s.cash_id]);
    // Un turno cobrado con esta venta vuelve a quedar "listo para retirar" (sin cobrar).
    await c.query("UPDATE appointments SET sale_id = NULL, status = 'listo' WHERE sale_id = $1", [id]);
    return { ok: true, stockDelta };
  });
});

/* ============================================================
   Caja (solo el dueño)
   ============================================================ */
// Filtros de la lista de Caja (y de su exportación): períodos fijos o un rango "desde – hasta".
function cashFilter(q) {
  const today = U.todayAR();
  const where = [];
  const params = [];
  const p = (v) => {
    params.push(v);
    return '$' + params.length;
  };
  const period = q.get('period') || 'month';
  if (period === 'today') where.push('c.on_date = ' + p(today));
  else if (period === 'month') {
    where.push('c.on_date >= ' + p(today.slice(0, 7) + '-01'));
    where.push('c.on_date <= ' + p(U.monthEnd(today)));
  } else if (period === 'prev') {
    const prevFrom = U.monthStart(today, 1);
    where.push('c.on_date >= ' + p(prevFrom));
    where.push('c.on_date <= ' + p(U.monthEnd(prevFrom)));
  } else if (period === 'range') {
    const from = U.reqDate(q.get('from') || '', 'Desde');
    const to = U.reqDate(q.get('to') || '', 'Hasta');
    if (to < from) throw U.bad('El rango de fechas no es válido: "Hasta" es anterior a "Desde"');
    where.push('c.on_date >= ' + p(from));
    where.push('c.on_date <= ' + p(to));
  }
  const type = q.get('type');
  if (type === 'in' || type === 'out') where.push('c.kind = ' + p(type));
  const group = q.get('group');
  if (group === 'Efectivo') where.push('c.method = ' + p('Efectivo'));
  else if (group === 'Transferencia') where.push('c.method = ' + p('Transferencia'));
  else if (group === 'Tarjeta') where.push("c.method IN ('Tarjeta de débito', 'Tarjeta de crédito')");
  return { where: where.length ? ' WHERE ' + where.join(' AND ') : '', params };
}
add('GET', '/api/cash', { admin: true }, async (ctx) => {
  const f = cashFilter(ctx.query);
  const r = await db.query(
    'SELECT c.id, c.on_date, c.kind, c.concept, c.category, c.method, c.amount, ' +
      '(SELECT s.id FROM sales s WHERE s.cash_id = c.id LIMIT 1) AS sale_id, ' +
      // Unidades que se restan del stock si se elimina el egreso de una compra.
      'COALESCE((SELECT SUM(-m.qty) FROM stock_movements m WHERE m.cash_id = c.id AND NOT m.voided AND m.product_id IS NOT NULL), 0) AS stock_delta ' +
      'FROM cash_movements c' + f.where + ' ORDER BY c.on_date DESC, c.id DESC LIMIT 500',
    f.params
  );
  return { items: r.rows.map(mapCash), limited: r.rows.length === 500 };
});

// Exportación a CSV (separador ";", UTF-8 con BOM y decimales con coma: se abre bien en Excel en español).
const csvCell = (v) => {
  let t = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // evita que Excel interprete el texto como una fórmula
  return /[;"\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
function sendCsv(ctx, name, header, rows) {
  const body = '﻿' + [header.join(';')].concat(rows.map((r) => r.map(csvCell).join(';'))).join('\r\n') + '\r\n';
  ctx.res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="' + name + '"',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  ctx.res.end(body);
  return U.HANDLED;
}
const fmtD = (d) => String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4);
const num = (n) => String(Number(n)).replace('.', ',');
add('GET', '/api/cash/export', { admin: true }, async (ctx) => {
  const f = cashFilter(ctx.query);
  const r = await db.query(
    'SELECT c.on_date, c.kind, c.concept, c.category, c.method, c.amount, ' +
      "COALESCE(sup.name, (SELECT trim(cl.first_name || ' ' || cl.last_name) FROM sales s JOIN clients cl ON cl.id = s.client_id WHERE s.cash_id = c.id LIMIT 1), '') AS who " +
      'FROM cash_movements c LEFT JOIN suppliers sup ON sup.id = c.supplier_id' + f.where + ' ORDER BY c.on_date, c.id LIMIT 50000',
    f.params
  );
  return sendCsv(
    ctx,
    'movimientos-' + U.todayAR() + '.csv',
    ['Fecha', 'Tipo', 'Concepto', 'Categoría', 'Forma de pago', 'Monto', 'Proveedor / Cliente'],
    r.rows.map((x) => [fmtD(x.on_date), x.kind === 'in' ? 'Ingreso' : 'Egreso', x.concept, x.category, x.method, num(x.amount), x.who])
  );
});

add('GET', '/api/cash/summary', { admin: true }, async () => cashSummary());

add('POST', '/api/cash', { admin: true }, async (ctx) => {
  const b = ctx.body;
  const date = U.reqDate(b.date, 'Fecha');
  // Una fecha futura se permite, pero solo si el usuario la confirmó (el servidor lo exige).
  if (date > U.todayAR() && b.confirmFuture !== true) throw new HttpError(409, 'La fecha es posterior a hoy, ¿es correcto?');
  const kind = U.oneOf(b.type, ['in', 'out'], 'Tipo');
  const supplierId = kind === 'out' ? await optSupplier(db, b.supplierId) : null;
  const r = await db.query(
    'INSERT INTO cash_movements (on_date, kind, concept, category, method, amount, created_by, supplier_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
    [
      date,
      kind,
      U.reqStr(b.concept, 'Concepto', 200),
      U.oneOf(b.category, kind === 'in' ? U.CASH_IN_CATS : U.CASH_OUT_CATS, 'Categoría'),
      U.oneOf(b.method, U.METHODS, 'Forma de pago'),
      U.moneyPos(b.amount, 'Monto'),
      ctx.user.id,
      supplierId,
    ]
  );
  return { id: r.rows[0].id };
});

// Eliminar un egreso de compra de mercadería también resta del stock lo que se había sumado.
// Los ingresos de una venta no se eliminan acá: se anula la venta (así también vuelve el stock).
add('DELETE', '/api/cash/:id', { admin: true }, async (ctx) => {
  const id = U.idParam(ctx.params.id);
  return db.tx(async (c) => {
    const r = await c.query('SELECT id FROM cash_movements WHERE id = $1 FOR UPDATE', [id]);
    if (!r.rows[0]) throw new HttpError(404, 'No se encontró el movimiento');
    const sale = (await c.query('SELECT id FROM sales WHERE cash_id = $1', [id])).rows[0];
    if (sale) throw new HttpError(409, 'Este ingreso es de la venta N° ' + sale.id + ': anulala desde “Ventas” (así también vuelve el stock).');
    const mv = await c.query('SELECT id FROM stock_movements WHERE cash_id = $1 ORDER BY id', [id]);
    const stockDelta = await revertStockMovements(c, mv.rows.map((x) => x.id), ctx.user.id);
    await c.query('DELETE FROM cash_movements WHERE id = $1', [id]);
    return { ok: true, stockDelta };
  });
});

// Cierre de caja: se compara el efectivo que debería haber con el que se contó. Se puede rehacer el mismo día.
add('GET', '/api/cash/closings', { admin: true }, async () => {
  const r = await db.query('SELECT k.id, k.on_date, k.expected, k.counted, k.difference, k.note, u.name AS who FROM cash_closings k LEFT JOIN users u ON u.id = k.created_by ORDER BY k.on_date DESC LIMIT 60');
  return {
    today: U.todayAR(),
    expected: await drawerAt(db, U.todayAR()),
    items: r.rows.map((x) => ({ id: x.id, date: x.on_date, expected: Number(x.expected), counted: Number(x.counted), difference: Number(x.difference), note: x.note, who: x.who || '' })),
  };
});
add('POST', '/api/cash/closings', { admin: true }, async (ctx) => {
  const today = U.todayAR();
  const counted = U.money(ctx.body.counted, 'Efectivo contado');
  const note = U.optStr(ctx.body.note, 300);
  const expected = await drawerAt(db, today);
  const difference = U.round2(counted - expected);
  await db.query(
    'INSERT INTO cash_closings (on_date, expected, counted, difference, note, created_by) VALUES ($1, $2, $3, $4, $5, $6) ' +
      'ON CONFLICT (on_date) DO UPDATE SET expected = EXCLUDED.expected, counted = EXCLUDED.counted, difference = EXCLUDED.difference, note = EXCLUDED.note, created_by = EXCLUDED.created_by, created_at = now()',
    [today, expected, counted, difference, note, ctx.user.id]
  );
  return { ok: true, expected, counted, difference };
});

/* ============================================================
   Resumen (pantalla de inicio del dueño)
   ============================================================ */
async function salesTotals(from, to) {
  const r = await db.query(
    'SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(cost_total), 0) AS cost FROM sales WHERE voided_at IS NULL AND on_date BETWEEN $1 AND $2',
    [from, to]
  );
  const n = Number(r.rows[0].n);
  const total = U.round2(Number(r.rows[0].total));
  const profit = U.round2(total - Number(r.rows[0].cost));
  return { count: n, total, profit, avg: n ? U.round2(total / n) : 0, margin: total > 0 ? Math.round((profit / total) * 1000) / 10 : null };
}
add('GET', '/api/dashboard', { admin: true }, async () => {
  const today = U.todayAR();
  const monthFrom = today.slice(0, 7) + '-01';
  const prevFrom = U.monthStart(today, 1);
  // El mes anterior se compara hasta el mismo día del mes (así la comparación es justa).
  const prevTo = U.addDays(prevFrom, Math.min(Number(today.slice(8, 10)), Number(U.monthEnd(prevFrom).slice(8, 10))) - 1);
  const from14 = U.addDays(today, -13);
  const [t, m, pm, daily, top, outM, appts, byMethod] = await Promise.all([
    salesTotals(today, today),
    salesTotals(monthFrom, today),
    salesTotals(prevFrom, prevTo),
    db.query('SELECT on_date, SUM(total) AS total, SUM(total - cost_total) AS profit FROM sales WHERE voided_at IS NULL AND on_date BETWEEN $1 AND $2 GROUP BY on_date', [from14, today]),
    db.query(
      'SELECT i.name, i.unit, SUM(i.qty) AS qty, SUM(i.amount) AS total, SUM(i.amount - i.qty * i.unit_cost) AS profit FROM sale_items i JOIN sales s ON s.id = i.sale_id ' +
        'WHERE s.voided_at IS NULL AND s.on_date BETWEEN $1 AND $2 GROUP BY i.name, i.unit ORDER BY total DESC LIMIT 5',
      [monthFrom, today]
    ),
    db.query("SELECT COALESCE(SUM(amount), 0) AS total FROM cash_movements WHERE kind = 'out' AND on_date BETWEEN $1 AND $2", [monthFrom, today]),
    db.query("SELECT COUNT(*) AS n FROM appointments WHERE on_date = $1 AND status NOT IN ('cancelado', 'no_vino')", [today]),
    db.query('SELECT method, SUM(total) AS total FROM sales WHERE voided_at IS NULL AND on_date = $1 GROUP BY method', [today]),
  ]);
  const byDay = {};
  daily.rows.forEach((x) => (byDay[x.on_date] = { total: Number(x.total), profit: Number(x.profit) }));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = U.addDays(today, -i);
    days.push({ date: d, total: U.round2((byDay[d] || {}).total || 0), profit: U.round2((byDay[d] || {}).profit || 0) });
  }
  const methods = {};
  byMethod.rows.forEach((x) => (methods[x.method] = U.round2(Number(x.total))));
  return {
    today: Object.assign(t, { byMethod: methods }),
    month: Object.assign(m, { expenses: U.round2(Number(outM.rows[0].total)) }),
    prevMonth: pm,
    days,
    top: top.rows.map((x) => ({ name: x.name, unit: x.unit, qty: Number(x.qty), total: Number(x.total), profit: U.round2(Number(x.profit)) })),
    apptsToday: Number(appts.rows[0].n),
    drawer: await drawerAt(db, today),
  };
});

/* ============================================================
   Reportes (solo el dueño)
   ============================================================ */
// Período de los reportes: un rango "desde – hasta" o los últimos N días.
function reportRange(q) {
  const today = U.todayAR();
  if (q.get('from') || q.get('to')) {
    const from = U.reqDate(q.get('from') || '', 'Desde');
    const to = U.reqDate(q.get('to') || '', 'Hasta');
    if (to < from) throw U.bad('El rango de fechas no es válido: "Hasta" es anterior a "Desde"');
    const days = Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000) + 1;
    return { from, to, days };
  }
  const d = Number(q.get('days'));
  const days = [7, 30, 90, 365].includes(d) ? d : 30;
  return { from: U.addDays(today, -(days - 1)), to: today, days };
}

// Últimos 6 meses: ventas, costo de lo vendido, ganancia bruta, gastos (egresos que no son compras de
// mercadería) y resultado. Las compras de mercadería no son "gasto" del mes: se reflejan en el costo de lo vendido.
add('GET', '/api/reports/monthly', { admin: true }, async () => {
  const today = U.todayAR();
  const from = U.monthStart(today, 5);
  const to = U.monthEnd(today);
  const [s, c] = await Promise.all([
    db.query("SELECT to_char(on_date, 'YYYY-MM') AS ym, COUNT(*) AS n, SUM(total) AS total, SUM(cost_total) AS cost FROM sales WHERE voided_at IS NULL AND on_date BETWEEN $1 AND $2 GROUP BY 1", [from, to]),
    db.query(
      "SELECT to_char(on_date, 'YYYY-MM') AS ym, kind, category, SUM(amount) AS total FROM cash_movements WHERE on_date BETWEEN $1 AND $2 GROUP BY 1, 2, 3",
      [from, to]
    ),
  ]);
  const months = [];
  const idx = {};
  for (let i = 5; i >= 0; i--) {
    const m = { ym: U.monthStart(today, i).slice(0, 7), count: 0, sales: 0, cost: 0, profit: 0, purchases: 0, expenses: 0, cashIn: 0, cashOut: 0 };
    months.push(m);
    idx[m.ym] = m;
  }
  s.rows.forEach((x) => {
    const m = idx[x.ym];
    if (!m) return;
    m.count = Number(x.n);
    m.sales = Number(x.total);
    m.cost = Number(x.cost);
  });
  c.rows.forEach((x) => {
    const m = idx[x.ym];
    if (!m) return;
    const a = Number(x.total);
    if (x.kind === 'in') m.cashIn += a;
    else {
      m.cashOut += a;
      if (x.category === 'Compra de mercadería') m.purchases += a;
      else if (x.category !== 'Retiro de caja') m.expenses += a;
    }
  });
  months.forEach((m) => {
    ['sales', 'cost', 'purchases', 'expenses', 'cashIn', 'cashOut'].forEach((k) => (m[k] = U.round2(m[k])));
    m.profit = U.round2(m.sales - m.cost);
    m.result = U.round2(m.profit - m.expenses);
  });
  return { months };
});

// Productos: unidades vendidas, lo cobrado, la ganancia y cuántos días dura el stock al ritmo actual.
add('GET', '/api/reports/products', { admin: true }, async (ctx) => {
  const { from, to, days } = reportRange(ctx.query);
  const r = await db.query(
    'SELECT p.id, p.name, p.brand, p.category, p.unit, p.stock, p.cost, p.price, ' +
      'COALESCE(SUM(i.qty), 0) AS qty, COALESCE(SUM(i.amount), 0) AS total, COALESCE(SUM(i.amount - i.qty * i.unit_cost), 0) AS profit ' +
      'FROM products p LEFT JOIN (SELECT i.* FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.voided_at IS NULL AND s.on_date BETWEEN $1 AND $2) i ON i.product_id = p.id ' +
      'GROUP BY p.id ORDER BY total DESC, lower(p.name)',
    [from, to]
  );
  return {
    from, to, days,
    items: r.rows.map((x) => ({
      id: x.id, name: x.name, brand: x.brand, category: x.category, unit: x.unit, stock: Number(x.stock),
      qty: Number(x.qty), total: U.round2(Number(x.total)), profit: U.round2(Number(x.profit)),
      stockValue: U.round2(Number(x.stock) * Number(x.cost)),
    })),
  };
});

// Ventas y ganancia por categoría (productos y servicios).
add('GET', '/api/reports/categories', { admin: true }, async (ctx) => {
  const { from, to, days } = reportRange(ctx.query);
  const r = await db.query(
    "SELECT i.kind, CASE WHEN i.category = '' THEN 'Sin categoría' ELSE i.category END AS category, SUM(i.amount) AS total, SUM(i.amount - i.qty * i.unit_cost) AS profit, COUNT(DISTINCT s.id) AS n " +
      'FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE s.voided_at IS NULL AND s.on_date BETWEEN $1 AND $2 GROUP BY 1, 2 ORDER BY total DESC',
    [from, to]
  );
  return { from, to, days, items: r.rows.map((x) => ({ kind: x.kind, category: x.category, total: U.round2(Number(x.total)), profit: U.round2(Number(x.profit)), sales: Number(x.n) })) };
});

// Servicios de peluquería y baño más vendidos.
add('GET', '/api/reports/services', { admin: true }, async (ctx) => {
  const { from, to, days } = reportRange(ctx.query);
  const r = await db.query(
    "SELECT i.name, SUM(i.qty) AS n, SUM(i.amount) AS total FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE i.kind = 'service' AND s.voided_at IS NULL AND s.on_date BETWEEN $1 AND $2 GROUP BY i.name ORDER BY n DESC, total DESC",
    [from, to]
  );
  return { from, to, days, items: r.rows.map((x) => ({ name: x.name, n: Number(x.n), total: U.round2(Number(x.total)) })) };
});

// Ventas por empleado (quién cargó cada venta).
add('GET', '/api/reports/staff', { admin: true }, async (ctx) => {
  const { from, to, days } = reportRange(ctx.query);
  const r = await db.query(
    "SELECT COALESCE(u.name, 'Usuario eliminado') AS name, COUNT(*) AS n, SUM(s.total) AS total FROM sales s LEFT JOIN users u ON u.id = s.created_by " +
      'WHERE s.voided_at IS NULL AND s.on_date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY total DESC',
    [from, to]
  );
  return { from, to, days, items: r.rows.map((x) => ({ name: x.name, n: Number(x.n), total: U.round2(Number(x.total)) })) };
});

// Detalle de ventas por línea, para abrir en Excel.
add('GET', '/api/reports/sales-export', { admin: true }, async (ctx) => {
  const { from, to } = reportRange(ctx.query);
  const r = await db.query(
    "SELECT s.id, s.on_date, s.method, trim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS client, u.name AS seller, i.kind, i.name, i.category, i.unit, i.qty, i.unit_price, i.unit_cost, i.amount " +
      'FROM sale_items i JOIN sales s ON s.id = i.sale_id LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN users u ON u.id = s.created_by ' +
      'WHERE s.voided_at IS NULL AND s.on_date BETWEEN $1 AND $2 ORDER BY s.on_date, s.id, i.id LIMIT 100000',
    [from, to]
  );
  return sendCsv(
    ctx,
    'ventas-' + from + '_a_' + to + '.csv',
    ['Fecha', 'Venta N°', 'Tipo', 'Artículo', 'Categoría', 'Cantidad', 'Unidad', 'Precio unitario', 'Costo unitario', 'Cobrado', 'Ganancia', 'Forma de pago', 'Cliente', 'Vendió'],
    r.rows.map((x) => [
      fmtD(x.on_date), x.id, x.kind === 'product' ? 'Producto' : 'Servicio', x.name, x.category, num(x.qty), x.unit === 'kg' ? 'kg' : 'unidad',
      num(x.unit_price), num(x.unit_cost), num(x.amount), num(U.round2(Number(x.amount) - Number(x.qty) * Number(x.unit_cost))), x.method, x.client, x.seller || '',
    ])
  );
});

/* ============================================================
   Copias de seguridad (solo el dueño)
   ============================================================ */
add('GET', '/api/backups', { admin: true }, async () => ({ items: await backup.list(), usage: await backup.usage() }));

add('POST', '/api/backups', { admin: true }, async () => {
  await backup.snapshot('Copia manual', false);
});

add('DELETE', '/api/backups/:id', { admin: true }, async (ctx) => {
  await backup.remove(U.idParam(ctx.params.id));
});

// Cantidad de registros que hay hoy, para la confirmación reforzada al restaurar.
add('GET', '/api/backups/current', { admin: true }, async () => ({ counts: await backup.currentCounts() }));

add('POST', '/api/backups/:id/restore', { admin: true, limit: 1024 }, async (ctx) => {
  await backup.restore(await backup.load(U.idParam(ctx.params.id)), { confirmEmpty: ctx.body.confirmEmpty === true });
});

add('GET', '/api/backup/export', { admin: true }, async (ctx) => {
  const body = JSON.stringify(await backup.exportAll());
  ctx.res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': 'attachment; filename="copia-petshop-' + U.todayAR() + '.json"',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  ctx.res.end(body);
  return U.HANDLED;
});

add('POST', '/api/restore', { admin: true, limit: 25 * 1024 * 1024 }, async (ctx) => {
  await backup.restore(ctx.body.data, { confirmEmpty: ctx.body.confirmEmpty === true });
});

/* ============================================================
   Proveedores
   Cualquier usuario puede consultarlos; solo el dueño los da de alta, edita o elimina.
   ============================================================ */
function supplierInput(b) {
  const ph = U.optPhone(b.phone);
  return [U.reqStr(b.name, 'Nombre', 200), ph.phone, U.checkEmail(U.optStr(b.email, 150)), U.optStr(b.description, 1000), ph.norm];
}
add('GET', '/api/suppliers', async () => {
  const r = await db.query(
    'SELECT s.id, s.name, s.phone, s.email, s.description, ' +
      '(SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id) AS products, ' +
      "(SELECT COUNT(*) FROM cash_movements c WHERE c.supplier_id = s.id AND c.kind = 'out') AS purchases " +
      'FROM suppliers s ORDER BY lower(s.name), s.id'
  );
  return { items: r.rows.map((x) => Object.assign(mapSupplier(x), { productCount: Number(x.products), purchaseCount: Number(x.purchases) })) };
});
// Ficha de un proveedor: sus productos y su historial de compras con el total gastado (son montos: solo el dueño).
add('GET', '/api/suppliers/:id/detail', { admin: true }, async (ctx) => {
  const id = U.idParam(ctx.params.id);
  const sup = (await db.query('SELECT id, name, phone, email, description FROM suppliers WHERE id = $1', [id])).rows[0];
  if (!sup) throw new HttpError(404, 'No se encontró el proveedor');
  const [prods, buys] = await Promise.all([
    db.query('SELECT id, name, category, unit, stock, min_stock FROM products WHERE supplier_id = $1 ORDER BY lower(name)', [id]),
    db.query("SELECT on_date, concept, amount FROM cash_movements WHERE supplier_id = $1 AND kind = 'out' ORDER BY on_date DESC, id DESC LIMIT 300", [id]),
  ]);
  const purchases = buys.rows.map((x) => ({ date: x.on_date, concept: x.concept, total: Number(x.amount) }));
  return {
    supplier: mapSupplier(sup),
    products: prods.rows.map((x) => ({ id: x.id, name: x.name, category: x.category, unit: x.unit, stock: Number(x.stock), min: Number(x.min_stock) })),
    purchases,
    totalSpent: U.round2(purchases.reduce((n, x) => n + x.total, 0)),
  };
});
add('POST', '/api/suppliers', { admin: true }, async (ctx) => {
  const r = await db.query('INSERT INTO suppliers (name, phone, email, description, phone_norm) VALUES ($1, $2, $3, $4, $5) RETURNING id', supplierInput(ctx.body));
  return { id: r.rows[0].id };
});
add('PUT', '/api/suppliers/:id', { admin: true }, async (ctx) => {
  const r = await db.query(
    'UPDATE suppliers SET name = $1, phone = $2, email = $3, description = $4, phone_norm = $5 WHERE id = $6 RETURNING id',
    supplierInput(ctx.body).concat([U.idParam(ctx.params.id)])
  );
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró el proveedor');
});
add('DELETE', '/api/suppliers/:id', { admin: true }, async (ctx) => {
  await db.query('DELETE FROM suppliers WHERE id = $1', [U.idParam(ctx.params.id)]);
});

/* ============================================================
   Clientes y sus mascotas (solo datos de contacto y de peluquería, nada médico)
   ============================================================ */
function clientInput(b) {
  const ph = U.optPhone(b.phone);
  return {
    first: U.reqStr(b.firstName, 'Nombre', 100),
    last: U.optStr(b.lastName, 100),
    phone: ph.phone,
    norm: ph.norm,
    email: U.checkEmail(U.optStr(b.email, 150)),
    address: U.optStr(b.address, 200),
    notes: U.optStr(b.notes, 1000),
  };
}
function petInput(b) {
  return {
    name: U.reqStr(b.name, 'Nombre de la mascota', 100),
    species: U.oneOf(b.species || 'Perro', U.PET_SPECIES, 'Especie'),
    breed: U.optStr(b.breed, 100),
    size: U.optOneOf(b.size, U.PET_SIZES, 'Tamaño'),
    birth: U.optPastDate(b.birth, 'Fecha de nacimiento'),
    notes: U.optStr(b.notes, 1000),
  };
}
add('GET', '/api/clients', async () => ({ items: await listClients() }));

// Ficha del cliente: contacto, mascotas, compras y turnos.
add('GET', '/api/clients/:id', async (ctx) => {
  const admin = isAdmin(ctx);
  const id = U.idParam(ctx.params.id);
  const r = await db.query('SELECT * FROM clients WHERE id = $1', [id]);
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró el cliente');
  const [pets, sales, appts] = await Promise.all([
    db.query('SELECT * FROM pets WHERE client_id = $1 ORDER BY lower(name), id', [id]),
    db.query(
      'SELECT ' + SALE_COLS + ", (SELECT string_agg(i.name, ', ' ORDER BY i.id) FROM sale_items i WHERE i.sale_id = s.id) AS summary" +
        SALE_FROM + ' WHERE s.client_id = $1 ORDER BY s.on_date DESC, s.id DESC LIMIT 300',
      [id]
    ),
    db.query(
      'SELECT a.id, a.on_date, a.at_time, a.status, pt.name AS pet, sv.name AS service FROM appointments a JOIN pets pt ON pt.id = a.pet_id LEFT JOIN services sv ON sv.id = a.service_id ' +
        'WHERE pt.client_id = $1 ORDER BY a.on_date DESC, a.at_time DESC LIMIT 100',
      [id]
    ),
  ]);
  const list = sales.rows.map((x) => mapSale(x, admin));
  const ok = list.filter((x) => !x.voided);
  return Object.assign(mapClient(r.rows[0], pets.rows.map(mapPet)), {
    sales: list,
    totalSpent: U.round2(ok.reduce((n, x) => n + x.total, 0)),
    lastPurchase: ok.length ? ok[0].date : '',
    appointments: appts.rows.map((x) => ({ id: x.id, date: x.on_date, time: String(x.at_time).slice(0, 5), status: x.status, pet: x.pet, service: x.service || '' })),
  });
});
// Alta de cliente; puede venir con su primera mascota.
add('POST', '/api/clients', async (ctx) => {
  const ci = clientInput(ctx.body);
  const pet = ctx.body.pet && typeof ctx.body.pet === 'object' && ctx.body.pet.name ? petInput(ctx.body.pet) : null;
  return db.tx(async (c) => {
    const r = await c.query('INSERT INTO clients (first_name, last_name, phone, phone_norm, email, address, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id', [
      ci.first, ci.last, ci.phone, ci.norm, ci.email, ci.address, ci.notes,
    ]);
    const id = r.rows[0].id;
    let petId = null;
    if (pet) {
      petId = (await c.query('INSERT INTO pets (client_id, name, species, breed, size, birth, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id', [
        id, pet.name, pet.species, pet.breed, pet.size, pet.birth, pet.notes,
      ])).rows[0].id;
    }
    return { id, petId };
  });
});
add('PUT', '/api/clients/:id', async (ctx) => {
  const ci = clientInput(ctx.body);
  const r = await db.query('UPDATE clients SET first_name = $1, last_name = $2, phone = $3, phone_norm = $4, email = $5, address = $6, notes = $7 WHERE id = $8 RETURNING id', [
    ci.first, ci.last, ci.phone, ci.norm, ci.email, ci.address, ci.notes, U.idParam(ctx.params.id),
  ]);
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró el cliente');
});
// Eliminar un cliente borra también sus mascotas y sus turnos. Sus compras quedan (sin cliente asignado).
add('DELETE', '/api/clients/:id', { admin: true }, async (ctx) => {
  const r = await db.query('DELETE FROM clients WHERE id = $1 RETURNING id', [U.idParam(ctx.params.id)]);
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró el cliente');
});

add('POST', '/api/clients/:id/pets', async (ctx) => {
  const clientId = U.idParam(ctx.params.id);
  const p = petInput(ctx.body);
  await mustExist(db, 'clients', clientId, 'No se encontró el cliente');
  const r = await db.query('INSERT INTO pets (client_id, name, species, breed, size, birth, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id', [
    clientId, p.name, p.species, p.breed, p.size, p.birth, p.notes,
  ]);
  return { id: r.rows[0].id };
});
add('PUT', '/api/pets/:id', async (ctx) => {
  const p = petInput(ctx.body);
  const clientId = U.idParam(ctx.body.clientId);
  await mustExist(db, 'clients', clientId, 'No se encontró el cliente');
  const r = await db.query('UPDATE pets SET client_id = $1, name = $2, species = $3, breed = $4, size = $5, birth = $6, notes = $7 WHERE id = $8 RETURNING id', [
    clientId, p.name, p.species, p.breed, p.size, p.birth, p.notes, U.idParam(ctx.params.id),
  ]);
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró la mascota');
});
add('DELETE', '/api/pets/:id', { admin: true }, async (ctx) => {
  const r = await db.query('DELETE FROM pets WHERE id = $1 RETURNING id', [U.idParam(ctx.params.id)]);
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró la mascota');
});

/* ============================================================
   Agenda de peluquería y baño (la usan el dueño y los ayudantes)
   ============================================================ */
const APPT_COLS =
  'a.id, a.pet_id, a.service_id, a.on_date, a.at_time, a.duration_min, a.status, a.notes, a.sale_id, ' +
  'pt.name AS pet_name, pt.species, pt.breed, pt.size, pt.notes AS pet_notes, pt.client_id, cl.first_name, cl.last_name, cl.phone, sv.name AS service_name, sv.price AS service_price';
const APPT_FROM = ' FROM appointments a JOIN pets pt ON pt.id = a.pet_id JOIN clients cl ON cl.id = pt.client_id LEFT JOIN services sv ON sv.id = a.service_id';
function addMinutes(hhmm, min) {
  const t = (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) + min) % 1440;
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}
const mapAppt = (r) => {
  const time = String(r.at_time).slice(0, 5);
  return {
    id: r.id,
    petId: r.pet_id,
    serviceId: r.service_id || null,
    date: r.on_date,
    time,
    duration: r.duration_min,
    endTime: addMinutes(time, r.duration_min),
    status: r.status,
    notes: r.notes,
    saleId: r.sale_id || null,
    pet: r.pet_name,
    species: r.species,
    breed: r.breed,
    size: r.size || '',
    petNotes: r.pet_notes,
    clientId: r.client_id,
    client: fullName(r.first_name, r.last_name),
    clientLast: r.last_name || r.first_name,
    phone: r.phone,
    service: r.service_name || '',
    servicePrice: r.service_price == null ? null : Number(r.service_price),
  };
};
function apptInput(b) {
  return {
    petId: U.idParam(b.petId),
    serviceId: b.serviceId ? U.idParam(b.serviceId) : null,
    date: U.reqDate(b.date, 'Fecha'),
    time: U.reqTime(b.time, 'Hora'),
    duration: U.reqInt(b.duration == null || b.duration === '' ? 60 : b.duration, 'Duración', 5, 600),
    status: U.oneOf(b.status || 'reservado', U.APPT_STATUS, 'Estado'),
    notes: U.optStr(b.notes, 1000),
  };
}
add('GET', '/api/appointments', async (ctx) => {
  const from = U.reqDate(ctx.query.get('from') || '', 'Desde');
  const to = U.reqDate(ctx.query.get('to') || '', 'Hasta');
  if (to < from) throw U.bad('El rango de fechas no es válido');
  const r = await db.query('SELECT ' + APPT_COLS + APPT_FROM + ' WHERE a.on_date BETWEEN $1 AND $2 ORDER BY a.on_date, a.at_time, a.id', [from, to]);
  return { items: r.rows.map(mapAppt) };
});
add('POST', '/api/appointments', async (ctx) => {
  const a = apptInput(ctx.body);
  await mustExist(db, 'pets', a.petId, 'No se encontró la mascota');
  if (a.serviceId) await mustExist(db, 'services', a.serviceId, 'No se encontró el servicio');
  const r = await db.query(
    'INSERT INTO appointments (pet_id, service_id, on_date, at_time, duration_min, status, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [a.petId, a.serviceId, a.date, a.time, a.duration, a.status, a.notes]
  );
  return { id: r.rows[0].id };
});
add('PUT', '/api/appointments/:id', async (ctx) => {
  const a = apptInput(ctx.body);
  await mustExist(db, 'pets', a.petId, 'No se encontró la mascota');
  if (a.serviceId) await mustExist(db, 'services', a.serviceId, 'No se encontró el servicio');
  const r = await db.query(
    'UPDATE appointments SET pet_id = $1, service_id = $2, on_date = $3, at_time = $4, duration_min = $5, status = $6, notes = $7 WHERE id = $8 RETURNING id',
    [a.petId, a.serviceId, a.date, a.time, a.duration, a.status, a.notes, U.idParam(ctx.params.id)]
  );
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró el turno');
});
// Cambio rápido de estado (en curso, listo para retirar, no vino...).
add('POST', '/api/appointments/:id/status', async (ctx) => {
  const status = U.oneOf(ctx.body.status, U.APPT_STATUS, 'Estado');
  const r = await db.query('UPDATE appointments SET status = $1 WHERE id = $2 RETURNING id', [status, U.idParam(ctx.params.id)]);
  if (!r.rows[0]) throw new HttpError(404, 'No se encontró el turno');
});
add('DELETE', '/api/appointments/:id', async (ctx) => {
  await db.query('DELETE FROM appointments WHERE id = $1', [U.idParam(ctx.params.id)]);
});

module.exports = { dispatch };
