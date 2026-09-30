import type { PoolClient } from 'pg';
import { query, queryOne } from '../database/pool';
import { badRequest, notFound } from '../utils/http';

/** Cambia el precio de lista de una presentación y guarda el historial. */
export async function changeProductPrice(db: PoolClient, productId: number, newPrice: number, reason: string | null, userId: number | null) {
  if (!Number.isFinite(newPrice) || newPrice <= 0) throw badRequest('El precio debe ser mayor que cero.');
  const product = await queryOne('SELECT id, list_price_pack FROM products WHERE id = $1 FOR UPDATE', [productId], db);
  if (!product) throw notFound('La presentación');
  if (product.list_price_pack === newPrice) return product;
  await query('UPDATE products SET list_price_pack = $1, price_updated_at = now() WHERE id = $2', [newPrice, productId], db);
  await query(
    'INSERT INTO product_price_history (product_id, old_price, new_price, user_id, reason) VALUES ($1,$2,$3,$4,$5)',
    [productId, product.list_price_pack, newPrice, userId, reason],
    db,
  );
  return { ...product, list_price_pack: newPrice };
}
