-- Estas tablas se crean solas cuando arranca el servidor. Es seguro ejecutarlo muchas veces.
-- Pensado para el plan gratuito de Supabase (PostgreSQL, 500 MB): solo texto y números, sin archivos.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Proveedores (a quién se le compra cada cosa).
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  phone_norm TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Catálogo y stock. Un producto se vende por unidad ('u') o suelto por kilo ('kg'): por eso las cantidades
-- admiten hasta 3 decimales. "cost" es el último precio de compra por unidad (o por kilo): sirve para
-- calcular la ganancia de cada venta.
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  species TEXT,
  unit TEXT NOT NULL DEFAULT 'u' CHECK (unit IN ('u', 'kg')),
  stock NUMERIC(12,3) NOT NULL DEFAULT 0 CONSTRAINT products_stock_nonneg CHECK (stock >= 0),
  min_stock NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  -- Bolsa cerrada que se puede "abrir" para vender suelto: kilos que trae y producto suelto al que pasan.
  pack_kg NUMERIC(8,3) CHECK (pack_kg IS NULL OR pack_kg > 0),
  loose_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  barcode TEXT,
  expires_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_idx ON products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_supplier_idx ON products(supplier_id);

-- Lista de precios de servicios (baño, peluquería). La duración se usa para la agenda.
CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  duration_min INTEGER NOT NULL DEFAULT 60 CHECK (duration_min BETWEEN 5 AND 600)
);

-- Clientes y sus mascotas (sin datos médicos).
CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  phone_norm TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pets (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  species TEXT NOT NULL DEFAULT 'Perro',
  breed TEXT NOT NULL DEFAULT '',
  size TEXT,
  birth DATE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pets_client_idx ON pets(client_id);

-- Libro de caja: todo lo que entra y sale, con su forma de pago.
CREATE TABLE IF NOT EXISTS cash_movements (
  id SERIAL PRIMARY KEY,
  on_date DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('in', 'out')),
  concept TEXT NOT NULL,
  category TEXT NOT NULL,
  method TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_date_idx ON cash_movements(on_date);
CREATE INDEX IF NOT EXISTS cash_supplier_idx ON cash_movements(supplier_id);

-- Ventas (tickets). Una venta tiene una o más líneas (productos y/o servicios). "cost_total" guarda el
-- costo de la mercadería vendida en ese momento, para calcular la ganancia aunque después cambie el costo.
-- Anular una venta no la borra: queda marcada (voided_at), devuelve el stock y quita el ingreso de la caja.
CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  on_date DATE NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  pet_id INTEGER REFERENCES pets(id) ON DELETE SET NULL,
  method TEXT NOT NULL,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  cash_id INTEGER REFERENCES cash_movements(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  void_reason TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_date_idx ON sales(on_date);
CREATE INDEX IF NOT EXISTS sales_client_idx ON sales(client_id);

CREATE TABLE IF NOT EXISTS sale_items (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('product', 'service')),
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'u',
  qty NUMERIC(12,3) NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(12,2) NOT NULL,
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount NUMERIC(12,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS sale_items_sale_idx ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS sale_items_product_idx ON sale_items(product_id);

-- Cada entrada o salida de stock queda registrada (fecha, cantidad, motivo, precio).
CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  on_date DATE NOT NULL,
  qty NUMERIC(12,3) NOT NULL,
  reason TEXT NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  cash_id INTEGER REFERENCES cash_movements(id) ON DELETE SET NULL,
  voided BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_mov_product_idx ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS stock_mov_sale_idx ON stock_movements(sale_id);

-- Agenda de peluquería y baño.
CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  on_date DATE NOT NULL,
  at_time TIME NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 60 CHECK (duration_min BETWEEN 5 AND 600),
  status TEXT NOT NULL DEFAULT 'reservado' CHECK (status IN ('reservado', 'en_curso', 'listo', 'entregado', 'no_vino', 'cancelado')),
  notes TEXT NOT NULL DEFAULT '',
  sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appt_date_idx ON appointments(on_date);
CREATE INDEX IF NOT EXISTS appt_pet_idx ON appointments(pet_id);

-- Cierre de caja diario: lo que debería haber en efectivo, lo que se contó y la diferencia.
CREATE TABLE IF NOT EXISTS cash_closings (
  id SERIAL PRIMARY KEY,
  on_date DATE NOT NULL UNIQUE,
  expected NUMERIC(12,2) NOT NULL,
  counted NUMERIC(12,2) NOT NULL,
  difference NUMERIC(12,2) NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Copias de seguridad comprimidas (una automática por día).
CREATE TABLE IF NOT EXISTS backups (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  label TEXT NOT NULL,
  auto BOOLEAN NOT NULL DEFAULT FALSE,
  counts TEXT NOT NULL DEFAULT '{}',
  data TEXT NOT NULL
);
