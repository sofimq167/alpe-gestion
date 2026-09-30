# ALPE Gestión

Aplicación web B2B para una empresa colombiana de producción, embotellado, comercialización y maquila de agua.
Reemplaza hojas de Excel para: costos y precios, precios por cliente, pedidos, despachos, inventario, producción por lote, maquila, cartera y finanzas.

Todo está en español, los valores en pesos colombianos (COP) y los datos se guardan en PostgreSQL.

---

## Contenido

1. [Arquitectura](#1-arquitectura)
2. [Estructura de archivos](#2-estructura-de-archivos)
3. [Modelo de base de datos](#3-modelo-de-base-de-datos)
4. [Fórmulas principales](#4-fórmulas-principales)
5. [Administrador inicial](#5-administrador-inicial)
6. [Ejecutar localmente](#6-ejecutar-localmente)
7. [Desplegar gratis en Render + Supabase (paso a paso)](#7-desplegar-gratis-en-render--supabase-paso-a-paso)
8. [Variables de entorno](#8-variables-de-entorno)
9. [Funcionalidades implementadas](#9-funcionalidades-implementadas)
10. [Funcionalidades que quedaron fuera](#10-funcionalidades-que-quedaron-fuera-a-propósito)
11. [Limitaciones de los planes gratuitos](#11-limitaciones-de-los-planes-gratuitos)
12. [Guía corta de uso para la empresa](#12-guía-corta-de-uso-para-la-empresa)

---

## 1. Arquitectura

| Capa | Tecnología | Por qué |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + componentes estilo shadcn/ui (Radix) + Lucide + Recharts | Moderno, rápido y fácil de mantener |
| Backend | Node.js 20 + Express + TypeScript | Sencillo, un solo proceso |
| Base de datos | PostgreSQL (Supabase, plan gratuito) | No expira; 500 MB |
| Autenticación | Propia: contraseñas con bcrypt + sesión JWT en cookie `httpOnly` | Sin servicios externos; roles preparados |
| Lógica de negocio | Paquete `shared` (TypeScript) usado por servidor y frontend | Las fórmulas existen en un solo lugar y tienen pruebas |
| Despliegue | **Un solo servicio web gratuito en Render** que sirve la API (`/api`) y la aplicación compilada | Sin CORS, un solo despliegue |

**Decisiones tomadas para mantener costo $0 (verificadas en septiembre de 2026):**

- **La base de datos PostgreSQL gratuita de Render expira a los 30 días** de creada. Por eso se usa **Supabase PostgreSQL (plan gratuito)**, que no expira (se pausa tras 7 días sin uso y se reactiva desde el panel).
- **El plan gratuito de Render no tiene consola (Shell)**. Por eso, al arrancar, la aplicación **aplica las migraciones automáticamente**, **crea el administrador inicial** (si no hay usuarios) y opcionalmente **carga los datos de demostración**.
- Supabase ofrece conexión directa solo por IPv6; Render usa IPv4. Por eso se usa la cadena **"Session pooler"** de Supabase (IPv4, compatible).
- Los adjuntos de remisión (foto/PDF, máx. 2 MB) se guardan en la misma base de datos: no requiere otro servicio. Ver sección 11 si en el futuro prefiere Supabase Storage.
- No se usa WhatsApp, Twilio, OCR, IA ni ninguna API de pago.

Flujo de una petición: navegador → Render (Express) → `/api/...` → servicios de negocio → PostgreSQL (Supabase). Las páginas se sirven desde `client/dist`.

---

## 2. Estructura de archivos

```
alpe/
├── package.json            # Workspaces: shared, server, client. Scripts de build y arranque
├── render.yaml             # Configuración del servicio en Render (Blueprint)
├── .env.example            # Plantilla de variables de entorno (sin secretos)
├── shared/                 # LÓGICA DE NEGOCIO CENTRALIZADA (usada por servidor y frontend)
│   ├── src/
│   │   ├── costing.ts      # Costo por botella/paca/estiba, soplado, gasto administrativo
│   │   ├── pricing.ts      # Margen sobre ventas, precio objetivo, estados de margen
│   │   ├── discounts.ts    # Precio especial, perfil, descuentos por volumen, totales, flete
│   │   ├── maquila.ts      # Costo y margen del servicio de maquila
│   │   ├── inventory.ts    # Movimientos, conteos físicos, valor, asignación de lotes FIFO
│   │   ├── receivables.ts  # Pagos, saldos y estados de cartera
│   │   ├── production.ts   # Rendimiento, desperdicio, costo real, consumo teórico
│   │   ├── format.ts       # Formato COP, %, fechas (zona horaria Bogotá)
│   │   └── constants.ts    # Roles, permisos, catálogos y etiquetas en español
│   └── test/business.test.ts   # Pruebas de los cálculos críticos
├── server/
│   └── src/
│       ├── index.ts        # Arranque: migraciones + admin + (demo) + servidor
│       ├── cli.ts          # Comandos: migrate | seed | create-admin
│       ├── app.ts          # Express, seguridad (helmet), estáticos del frontend
│       ├── config/env.ts   # Variables de entorno
│       ├── database/       # pool.ts, migrate.ts, migrations/, bootstrap.ts, seed.ts
│       ├── middleware/     # auth.ts (sesión, roles), errors.ts (mensajes claros)
│       ├── services/       # costService, pricingService, inventoryService, productionService,
│       │                   # orderService, dispatchService, receivableService, maquilaService, reportService…
│       ├── routes/         # Endpoints REST por módulo
│       └── utils/          # Validaciones y utilidades HTTP
└── client/
    └── src/
        ├── components/ui/      # Botones, formularios, diálogos, tabs, badges (estilo shadcn)
        ├── components/common/  # Tabla con búsqueda/orden/paginación/CSV, gráficas, estados
        ├── components/layout/  # Sidebar, header
        ├── pages/              # Una carpeta por módulo (pricing, clients, orders, dispatches…)
        ├── hooks/              # useAuth, useData, useSubmit (advertencias con confirmación)
        ├── services/api.ts     # Cliente HTTP
        ├── config/navigation.ts
        ├── types/ utils/ lib/
```

---

## 3. Modelo de base de datos

Migración: `server/src/database/migrations/001_init.ts` (se aplica sola al arrancar; queda registrada en `schema_migrations`).

| Área | Tablas |
|---|---|
| Usuarios y configuración | `users` (rol: admin, ventas, produccion, despachos, administracion), `settings` (JSON por clave: empresa, gastos administrativos, producción, precios, operación) |
| Insumos | `supplies` (costo actual, proveedor, existencia, mínimo), `supply_cost_history` (valor anterior, nuevo, fecha, usuario) |
| Presentaciones | `products` (volumen, und/paca, pacas/estiba, peso, márgenes, precio de lista, existencia), `product_components` (receta/estructura de costos), `blow_configs` (escenario de soplado), `product_price_history` |
| Clientes y precios | `client_profiles`, `clients`, `client_special_prices` (con vigencia), `profile_prices` (lista de precios fija por perfil), `volume_discounts` (por pacas o estibas) |
| Pedidos | `orders`, `order_items` (precio, descuentos, costo y margen congelados al crear) |
| Producción | `lots`, `production_runs` (turno, mano de obra, energía, rendimiento, costo real), `production_consumptions` |
| Inventario | `supply_movements`, `product_movements` (con saldo después de cada movimiento), `physical_counts` |
| Despachos | `dispatches`, `dispatch_items`, `dispatch_item_lots` (trazabilidad), `attachments` |
| Maquila | `maquila_services`, `maquila_service_items` (quién aporta cada material) |
| Cartera y finanzas | `receivables`, `payments`, `admin_expenses` |

Relaciones clave:

- Producción → crea `lots` → aumenta `products.stock_packs` (movimiento) → descuenta `supplies.stock` (movimientos de consumo).
- Despacho → descuenta existencias y lotes (FIFO o lote elegido) → actualiza `order_items.packs_dispatched` y estado del pedido → crea `receivables`.
- Pago → reduce `receivables.balance`.
- Cambio de costo de insumo → historial → todos los costos y márgenes se recalculan al consultarlos (nunca se guardan costos "viejos" en las presentaciones).
- Los registros con historia no se borran: se **anulan** (despachos, producción) o **cancelan** (pedidos), revirtiendo inventario y cartera. Insumos y presentaciones con movimientos solo se pueden desactivar.

---

## 4. Fórmulas principales

Todas están en `shared/src` y tienen pruebas en `shared/test`.

| Concepto | Fórmula |
|---|---|
| Costo de un componente por botella | cantidad × costo del insumo ÷ botellas que cubre la base (1 si es por botella, und/paca si es por paca, und/paca × pacas/estiba si es por estiba) |
| Costo por botella | Σ componentes + energía por botella + mano de obra por botella (+ gasto administrativo por botella si está configurado) |
| Costo por paca / estiba | costo por botella × botellas por paca / × botellas por estiba |
| Mano de obra por botella | Σ costo de mano de obra de los turnos ÷ Σ botellas producidas (últimos N días, configurable). Ej.: $400.000 ÷ 20.000 = $20. Si no hay producción reciente se usa el valor estándar de la presentación |
| Energía por botella | Σ costo de energía ÷ Σ botellas producidas (misma lógica) |
| Envase soplado | preforma ÷ (1 − % desperdicio) + energía + mano de obra + depreciación/costo operativo |
| Ahorro por soplado | (costo con envase comprado − costo con soplado) × botellas por paca × pacas vendidas en los últimos 30 días |
| **Margen sobre ventas** (métrica principal) | (precio − costo) ÷ precio (− % administrativo si se configuró como % de ventas) |
| **Precio para un margen** | costo ÷ (1 − margen). Ej.: $10.000 ÷ 0,80 = $12.500 (no $12.000, que sería markup) |
| Markup (solo referencia) | (precio − costo) ÷ costo |
| Precio sugerido | costo ÷ (1 − margen objetivo), redondeado hacia arriba al múltiplo configurado ($100) |
| Precio del cliente | 1) precio especial vigente; si no, 2) precio fijo de la lista del perfil; si no, 3) precio de lista × (1 − descuento del perfil). Luego × (1 − descuento por volumen) |
| Descuento por volumen | el mayor rango que aplique a la línea (por pacas o por estibas completas) |
| Flete | incluido: la empresa lo asume (se suma al costo). No incluido: se cobra al cliente (pacas × valor por paca) |
| Maquila | costo = materiales que aporta la empresa + agua + energía + mano de obra + otros. Lo que aporta el cliente no es costo |
| Producción | rendimiento = buenas ÷ totales; desperdicio = defectuosas ÷ totales; costo real = (materiales + mano de obra + energía) ÷ botellas buenas |
| Conteo físico | diferencia = físico − sistema; valor = diferencia × costo unitario |
| Cartera | saldo = valor − pagos; vencida si hoy > vencimiento; "por vencer" si vence en los próximos N días |
| Margen operativo estimado | (ventas − costo de ventas − gastos administrativos registrados) ÷ ventas |

---

## 5. Administrador inicial

El administrador se crea **automáticamente al arrancar** si la tabla de usuarios está vacía, usando las variables `ADMIN_EMAIL`, `ADMIN_PASSWORD` (mínimo 8 caracteres) y `ADMIN_NAME`.

- Después del primer ingreso, cámbiela en el menú del usuario → **Cambiar contraseña**.
- Si olvida la contraseña del administrador, desde su computador (ver sección 6, con `DATABASE_URL` apuntando a Supabase) ejecute:
  `npm run create-admin -- correo@empresa.com NuevaClaveSegura "Nombre"`

Local de demostración (archivo `.env` de ejemplo): `admin@alpe.com.co` / la contraseña que ponga en `ADMIN_PASSWORD`.

---

## 6. Ejecutar localmente

Requisitos: Node.js 20 o superior y una base PostgreSQL (local, Docker o la misma de Supabase).

```bash
# 1. Instalar dependencias
npm install

# 2. Crear el archivo de configuración
cp .env.example .env        # en Windows: copy .env.example .env
#    y edite DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD

# 3. (Opcional) Base local con Docker
docker run -d --name alpe-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=alpe -p 5432:5432 postgres:16

# 4. Crear tablas y cargar datos de demostración
npm run db:seed             # o solo tablas: npm run db:migrate

# 5. Iniciar en modo desarrollo (API en :3001, aplicación en http://localhost:5173)
npm run dev
```

Otros comandos:

| Comando | Qué hace |
|---|---|
| `npm test` | Pruebas de los cálculos de negocio |
| `npm run typecheck` | Revisa tipos de TypeScript en los tres paquetes |
| `npm run build` | Compila la aplicación y el servidor para producción |
| `npm start` | Arranca en modo producción (sirve API + aplicación en `PORT`) |
| `npm run db:migrate` | Aplica migraciones pendientes |
| `npm run db:seed` | Carga datos de demostración (solo si la base está vacía) |
| `npm run create-admin -- email clave "Nombre"` | Crea o restablece un administrador |

---

## 7. Desplegar gratis en Render + Supabase (paso a paso)

### Paso 1 — Crear la base de datos en Supabase (gratis)

1. Entre a <https://supabase.com> → **Start your project** → regístrese con GitHub o correo (el plan Free no pide tarjeta).
2. **New project**: nombre `alpe`, escriba una **Database Password** segura y **guárdela**; región: la más cercana (ej. *East US*). Plan **Free**.
3. Espere 1–2 minutos a que se cree.
4. Arriba, botón **Connect** (o *Project Settings → Database → Connection string*).
5. Elija **Session pooler** (NO "Direct connection", que no funciona desde Render por IPv6). Copie la cadena, por ejemplo:
   `postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres`
6. Reemplace `[YOUR-PASSWORD]` por la contraseña del paso 2. Si la contraseña tiene caracteres como `@ # / ?`, cámbiela por una solo con letras y números (o codifíquelos). **Esta cadena es su `DATABASE_URL`.**

No necesita crear tablas: la aplicación las crea sola.

### Paso 2 — Subir el código a GitHub

1. Cree una cuenta en <https://github.com> si no tiene.
2. Cree un repositorio **privado** llamado `alpe-gestion` (sin README).
3. Suba **esta carpeta completa** (la que contiene `package.json`, `render.yaml`, `shared/`, `server/`, `client/`). El archivo `.gitignore` ya excluye `node_modules`, `dist` y **`.env`** (nunca suba el `.env`).
   ```bash
   git init
   git add .
   git commit -m "ALPE Gestión"
   git branch -M main
   git remote add origin https://github.com/SU_USUARIO/alpe-gestion.git
   git push -u origin main
   ```
   (También puede usar GitHub Desktop: *File → Add local repository → Publish repository*.)

### Paso 3 — Crear la cuenta en Render y conectar GitHub

1. Entre a <https://render.com> → **Get Started** → regístrese **con GitHub** (así queda conectado).
2. Si se registró con correo: *Account Settings → Git Providers → Connect GitHub* y autorice el repositorio `alpe-gestion`.

### Paso 4 — Crear el servicio

**Opción A (recomendada): Blueprint**

1. En Render: **New + → Blueprint** → elija el repositorio `alpe-gestion`.
2. Render lee `render.yaml` y propone un **Web Service** llamado `alpe-gestion` en plan **Free**.
3. Le pedirá los valores marcados como secretos: `DATABASE_URL` (la de Supabase), `ADMIN_EMAIL` y `ADMIN_PASSWORD`. `JWT_SECRET` se genera solo.
4. **Apply**.

**Opción B: manual**

1. **New + → Web Service** → repositorio `alpe-gestion`.
2. Configure:
   - **Runtime / Language**: Node
   - **Branch**: `main`
   - **Root Directory**: (vacío)
   - **Build Command**: `npm ci --include=dev && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**
   - **Health Check Path** (en *Advanced*): `/api/health`
3. Agregue las variables de entorno del paso 5 y presione **Create Web Service**.

### Paso 5 — Variables de entorno (Environment)

| Variable | Valor |
|---|---|
| `DATABASE_URL` | Cadena **Session pooler** de Supabase (paso 1) |
| `DATABASE_SSL` | `true` |
| `JWT_SECRET` | Texto aleatorio de 32+ caracteres (Render: botón *Generate*) |
| `ADMIN_EMAIL` | Correo del administrador inicial |
| `ADMIN_PASSWORD` | Contraseña inicial (8+ caracteres) |
| `ADMIN_NAME` | Nombre visible, ej. `Administrador` |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `20` |
| `APP_TIMEZONE` | `America/Bogota` |
| `SEED_DEMO_DATA` | `true` solo si quiere datos de prueba en el primer arranque; si no, `false` |

`PORT` **no** se configura: Render lo asigna y la aplicación lo lee.

### Paso 6 — Migraciones, datos iniciales y administrador

No hay que ejecutar nada a mano:

- **Migraciones**: se aplican automáticamente en cada arranque (es seguro repetirlas).
- **Administrador inicial**: se crea en el primer arranque con `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- **Datos de demostración**: si `SEED_DEMO_DATA=true` y la base está vacía, se cargan en segundo plano justo después del primer arranque (contra Supabase tarda 1–3 minutos; espere el mensaje "Datos de demostración cargados" antes de revisar). Luego cambie la variable a `false` (aunque quede en `true`, nunca vuelve a cargar si la base tiene datos). No reinicie el servicio mientras se cargan.

En **Logs** de Render debe ver:

```
[db] Migración aplicada: 001_init
[inicio] Administrador inicial creado: admin@...
[inicio] ALPE Gestión escuchando en el puerto 10000 (producción)
[inicio] Cargando datos de demostración en segundo plano...   (solo con SEED_DEMO_DATA=true)
[inicio] Datos de demostración cargados.
```

Alternativa desde su computador (útil para cargar la demo o restablecer la clave): ponga la `DATABASE_URL` de Supabase y `DATABASE_SSL=true` en su `.env` local y ejecute `npm run db:migrate`, `npm run db:seed` o `npm run create-admin -- ...`.

### Paso 7 — Ingresar

Abra la URL que muestra Render (ej. `https://alpe-gestion.onrender.com`) e inicie sesión con el administrador. Cambie la contraseña desde el menú del usuario.

**Empezar con datos reales (sin demo):** en *Configuración* complete la empresa y variables; en *Precios → Insumos y costos* cree sus insumos; en *Presentaciones* cree cada presentación con su estructura de costos y precio; en *Clientes* revise los perfiles y cree clientes. Registre las existencias iniciales con *Inventario → Registrar movimiento* o *Conteo físico*.

---

## 8. Variables de entorno

Ver `.env.example`. Resumen:

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | Sí | Conexión PostgreSQL |
| `DATABASE_SSL` | Sí en Supabase | `true` para conexiones con SSL |
| `JWT_SECRET` | Sí | Firma de las sesiones (32+ caracteres en producción) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Primer arranque | Administrador inicial |
| `SEED_DEMO_DATA` | No | `true` para cargar demo si la base está vacía |
| `PORT` | No | Puerto (Render lo define) |
| `NODE_ENV` | Recomendada | `production` en Render (activa cookies seguras) |
| `APP_TIMEZONE` | No | Zona horaria del negocio (por defecto `America/Bogota`) |

---

## 9. Funcionalidades implementadas

- **Autenticación**: inicio de sesión, cookies `httpOnly`, contraseñas con bcrypt, límite de intentos, rutas protegidas, cambio de contraseña, usuarios y roles (admin completo; ventas, producción, despachos y administración con permisos por módulo ya definidos).
- **Insumos y costos**: CRUD, historial de costos, uso por presentación, **cambio de costo con vista previa** ("El cambio afecta N presentaciones", costo/margen anterior y nuevo, precio actual y sugerido) y opción de aplicar el precio sugerido al confirmar.
- **Presentaciones**: datos, márgenes objetivo/mínimo, estructura de costos editable, escenario de soplado, precio de lista con historial, **Recalcular precios**, alertas de margen bajo.
- **Calculador de precios**: desglose del costo por componente (botella, paca, estiba), precio y margen por botella y por paca, markup de referencia, precio de prueba, precio sugerido y mínimo, gastos administrativos visibles, **interruptor de envase soplado** con comparación inmediata y ahorro mensual.
- **Listas de precios**: matriz presentación × perfil con margen, precios fijos por perfil, descuentos por volumen (pacas/estibas) editables con validación de rangos.
- **Simulador de costos**: escenarios hipotéticos sin guardar (insumos, mano de obra, energía, soplado).
- **Clientes**: ficha completa, perfiles editables, precios especiales con vigencia (vuelven a la regla normal al vencer), precios vigentes, pedidos, despachos y cartera del cliente, límite de crédito.
- **Pedidos**: cotización en vivo con perfil, precio especial, volumen, flete; margen esperado vs. real; advertencias (margen bajo mínimo, pedido mínimo, cupo de crédito) que se confirman antes de guardar; cancelación controlada.
- **Producción**: por lote y turno, consumo teórico editable, mano de obra y energía sugeridas con las variables maestras, rendimiento, desperdicio, costo real por botella/paca; aumenta producto terminado y descuenta insumos; anulación con reversión.
- **Lotes y trazabilidad**: búsqueda; fecha, producto, cantidad, insumos, despachos y clientes que recibieron el lote.
- **Despachos**: desde pedido o directos, lote automático FIFO o elegido, remisión automática o manual, vehículo, conductor, destino, adjunto (foto/PDF), contado o crédito; descuenta inventario, actualiza pedido, genera cartera; historial con filtros; anulación con reversión; impresión.
- **Inventario**: producto terminado (teórico, conteo físico, diferencia y su valor, resaltado), insumos (cobertura en días), movimientos (entrada, consumo, ajuste, pérdida, inventario físico), conteos físicos.
- **Maquila**: servicios por cliente, quién aporta cada material, precio por botella o paca, costo y margen propios; producción y despacho separados; genera cartera.
- **Cartera**: estados (al día, por vencer, vencida, pagada), días vencidos, pagos parciales/totales con validación, historial y pagos recibidos.
- **Finanzas**: ventas, costo, margen bruto y operativo, ventas y margen por producto y cliente, evolución mensual, gastos administrativos (CRUD).
- **Dashboard**: indicadores del mes, alertas de margen, producción y despachos de hoy, pedidos pendientes, inventario bajo, insumos por agotarse, cartera vencida, ventas de 6 meses, presentaciones con menor margen.
- **Configuración**: empresa, gastos administrativos (no incluidos / % ventas / por botella / mensual distribuido), redondeo y márgenes por defecto, variables de producción (costo hora, tarifa kWh, turnos, vida útil), cartera e inventario, perfiles, usuarios.
- **Tablas**: búsqueda, filtros, orden, paginación y **exportación CSV** (compatible con Excel en español) en ventas, clientes, inventario, producción, despachos, cartera y más.
- **Pruebas**: 27 pruebas de cálculos críticos (`npm test`).

---

## 10. Funcionalidades que quedaron fuera (a propósito)

WhatsApp, OCR, IA generativa, facturación electrónica DIAN, integración bancaria, integración contable, GPS y rastreo de vehículos, aplicación móvil nativa, y cualquier servicio pago.

La arquitectura permite agregarlas: cada módulo tiene su servicio en `server/src/services` (por ejemplo, un futuro `notificationService` o `invoiceService` se conectaría a los eventos de despacho en `dispatchService.ts`), y los adjuntos se pueden mover a un almacenamiento externo cambiando solo `routes/dispatches.ts`.

---

## 11. Limitaciones de los planes gratuitos

**Render (web service Free):**

- Se **"duerme" tras 15 minutos sin visitas**; la primera visita después tarda ~1 minuto en responder. Es normal.
- 750 horas gratis al mes por cuenta (suficiente para un servicio).
- Sin consola (por eso todo se prepara solo al arrancar) y el disco es temporal (por eso los datos y adjuntos van a la base de datos).

**Supabase (Free):**

- 500 MB de base de datos (años de operación para una empresa pequeña; los adjuntos de 2 MB son lo que más ocupa: si sube muchos, prefiera fotos comprimidas o use Supabase Storage, 1 GB gratis).
- El proyecto **se pausa tras 7 días sin actividad**. Si se usa a diario no pasa; si ocurre, entre a Supabase y presione **Restore project** (los datos se conservan).
- Máximo 2 proyectos activos gratis. Sin copias de seguridad automáticas descargables: **exporte periódicamente** los CSV importantes o un respaldo con `pg_dump` usando la `DATABASE_URL`.

---

## 12. Guía corta de uso para la empresa

**Todos los días**

1. **Producción** → *Registrar producción*: presentación, turno, pacas buenas, defectuosas, trabajadores, horas, kWh. Revise el consumo sugerido y presione *Finalizar*. El inventario sube y los insumos bajan solos.
2. **Pedidos** → *Nuevo pedido*: elija el cliente; el sistema aplica su precio, descuentos, plazo y flete. Si el margen es bajo, le avisará antes de guardar.
3. **Despachos** → *Registrar despacho*: elija el pedido, verifique pacas, vehículo y conductor, adjunte la remisión si quiere. Al confirmar se descuenta el inventario y se crea la cuenta por cobrar.
4. **Cartera** → *Registrar pago* cuando el cliente pague (puede ser parcial).
5. Revise el **Dashboard**: alertas de margen, inventario bajo, insumos por agotarse y cartera vencida.

**Cuando cambie un precio de proveedor**

- **Precios → Insumos y costos** → *Cambiar costo*: verá qué presentaciones se afectan y cómo cambian costos y márgenes. Confirme y, si quiere, aplique el precio sugerido.

**Cada mes**

- **Inventario** → *Conteo físico* de producto terminado e insumos.
- **Finanzas** → registre los *gastos administrativos* y revise margen por producto y por cliente.
- Revise **Presentaciones** y use *Recalcular precios* si algún margen quedó bajo.

**Conceptos clave**

- **Margen sobre ventas** = qué parte del precio es ganancia. Un margen de 25% en una paca de $12.000 significa $3.000 de ganancia.
- **Margen mínimo**: por debajo, el sistema alerta. **Margen objetivo**: con él se calcula el precio sugerido.
- **Costo real**: se calcula con los costos actuales de los insumos y la mano de obra y energía de los turnos reales.
