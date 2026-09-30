import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../config/env';
import { query, queryOne } from '../database/pool';
import { requireModule } from '../middleware/auth';
import { annulDispatch, createMaquilaDispatch, createSaleDispatch } from '../services/dispatchService';
import { badRequest, h, idParam, notFound } from '../utils/http';
import { isoDate, optText, posInt } from '../utils/validators';

export const dispatchesRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.maxUploadBytes } });
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

dispatchesRouter.get(
  '/',
  h(async (req, res) => {
    const f = z
      .object({
        from: isoDate.optional(),
        to: isoDate.optional(),
        clientId: z.coerce.number().optional(),
        productId: z.coerce.number().optional(),
        kind: z.enum(['venta', 'maquila']).optional(),
        q: z.string().trim().optional(),
      })
      .parse(req.query);
    const params: unknown[] = [];
    const where: string[] = [];
    if (f.from) where.push(`d.dispatch_date >= $${params.push(f.from)}`);
    if (f.to) where.push(`d.dispatch_date <= $${params.push(f.to)}`);
    if (f.clientId) where.push(`d.client_id = $${params.push(f.clientId)}`);
    if (f.kind) where.push(`d.kind = $${params.push(f.kind)}`);
    if (f.productId) where.push(`EXISTS (SELECT 1 FROM dispatch_items di WHERE di.dispatch_id = d.id AND di.product_id = $${params.push(f.productId)})`);
    res.json(
      await query(
        `SELECT d.*, c.name AS client_name, o.number AS order_number, u.name AS created_by_name,
           (SELECT string_agg(description || ' × ' || packs, ', ') FROM dispatch_items WHERE dispatch_id = d.id) AS summary,
           (SELECT COUNT(*)::int FROM attachments a WHERE a.dispatch_id = d.id) AS attachments
         FROM dispatches d JOIN clients c ON c.id = d.client_id LEFT JOIN orders o ON o.id = d.order_id
         LEFT JOIN users u ON u.id = d.created_by
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY d.dispatch_date DESC, d.id DESC LIMIT 2000`,
        params,
      ),
    );
  }),
);

dispatchesRouter.get(
  '/:id',
  h(async (req, res) => {
    const id = idParam(req);
    const d = await queryOne(
      `SELECT d.*, c.name AS client_name, c.document AS client_document, c.address AS client_address, c.city AS client_city,
         o.number AS order_number, u.name AS created_by_name, ms.name AS maquila_service_name
       FROM dispatches d JOIN clients c ON c.id = d.client_id LEFT JOIN orders o ON o.id = d.order_id
       LEFT JOIN users u ON u.id = d.created_by LEFT JOIN maquila_services ms ON ms.id = d.maquila_service_id WHERE d.id = $1`,
      [id],
    );
    if (!d) throw notFound('El despacho');
    const [items, lots, attachments, receivable] = await Promise.all([
      query('SELECT * FROM dispatch_items WHERE dispatch_id = $1 ORDER BY id', [id]),
      query(
        `SELECT dil.*, l.code, l.production_date, di.id AS item_id FROM dispatch_item_lots dil
         JOIN lots l ON l.id = dil.lot_id JOIN dispatch_items di ON di.id = dil.dispatch_item_id WHERE di.dispatch_id = $1`,
        [id],
      ),
      query('SELECT id, filename, mime_type, size_bytes, created_at FROM attachments WHERE dispatch_id = $1 ORDER BY id', [id]),
      queryOne('SELECT * FROM receivables WHERE dispatch_id = $1', [id]),
    ]);
    res.json({
      ...d,
      items: items.map((i) => ({ ...i, lots: lots.filter((l) => l.item_id === i.id) })),
      attachments,
      receivable,
    });
  }),
);

const common = {
  date: isoDate,
  destination: optText,
  vehicle: optText,
  driver: optText,
  remissionNumber: optText,
  notes: optText,
  paymentMode: z.enum(['credito', 'contado']).default('credito'),
  paymentMethod: z.string().optional(),
  confirmWarnings: z.boolean().default(false),
};

dispatchesRouter.post(
  '/',
  requireModule('despachos'),
  h(async (req, res) => {
    const d = z
      .object({
        ...common,
        orderId: z.coerce.number().int().positive().optional().nullable(),
        clientId: z.coerce.number().int().positive().optional().nullable(),
        items: z
          .array(z.object({ productId: posInt, packs: z.coerce.number().int('debe ser entero').min(0), lotId: z.coerce.number().int().positive().optional().nullable() }))
          .min(1),
      })
      .parse(req.body);
    res.status(201).json(await createSaleDispatch(d, req.user!.id));
  }),
);

dispatchesRouter.post(
  '/maquila',
  requireModule('maquila'),
  h(async (req, res) => {
    const d = z
      .object({ ...common, maquilaServiceId: posInt, packs: posInt, lotId: z.coerce.number().int().positive().optional().nullable() })
      .parse(req.body);
    res.status(201).json(await createMaquilaDispatch(d, req.user!.id));
  }),
);

dispatchesRouter.post(
  '/:id/annul',
  requireModule('despachos'),
  h(async (req, res) => {
    const { reason } = z.object({ reason: optText }).parse(req.body ?? {});
    res.json(await annulDispatch(idParam(req), req.user!.id, reason));
  }),
);

dispatchesRouter.post(
  '/:id/attachments',
  requireModule('despachos'),
  upload.single('file'),
  h(async (req, res) => {
    const id = idParam(req);
    const file = req.file;
    if (!file) throw badRequest('Seleccione un archivo.');
    if (!ALLOWED_MIME.includes(file.mimetype)) throw badRequest('Solo se permiten imágenes (JPG, PNG, WEBP) o PDF.');
    const exists = await queryOne('SELECT id FROM dispatches WHERE id = $1', [id]);
    if (!exists) throw notFound('El despacho');
    const row = await queryOne(
      `INSERT INTO attachments (dispatch_id, filename, mime_type, size_bytes, data, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, filename, mime_type, size_bytes, created_at`,
      [id, file.originalname.slice(0, 200), file.mimetype, file.size, file.buffer, req.user!.id],
    );
    res.status(201).json(row);
  }),
);

export const attachmentsRouter = Router();

attachmentsRouter.get(
  '/:id',
  h(async (req, res) => {
    const row = await queryOne('SELECT filename, mime_type, data FROM attachments WHERE id = $1', [idParam(req)]);
    if (!row) throw notFound('El archivo');
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.filename)}"`);
    res.send(row.data);
  }),
);

attachmentsRouter.delete(
  '/:id',
  requireModule('despachos'),
  h(async (req, res) => {
    await query('DELETE FROM attachments WHERE id = $1', [idParam(req)]);
    res.json({ ok: true });
  }),
);
