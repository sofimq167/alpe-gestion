import { Router } from 'express';
import { requireAuth, requireModule } from '../middleware/auth';
import { authRouter } from './auth';
import { clientsRouter, pricingRouter } from './clients';
import { attachmentsRouter, dispatchesRouter } from './dispatches';
import { expensesRouter, paymentsRouter, receivablesRouter, reportsRouter } from './finance';
import { inventoryRouter } from './inventory';
import { maquilaRouter } from './maquila';
import { ordersRouter } from './orders';
import { productionRouter, lotsRouter } from './production';
import { productsRouter } from './products';
import { settingsRouter, usersRouter } from './settings';
import { suppliesRouter } from './supplies';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => res.json({ ok: true }));
apiRouter.use('/auth', authRouter);

// Todo lo siguiente requiere sesión iniciada
apiRouter.use(requireAuth);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/supplies', suppliesRouter);
apiRouter.use('/products', productsRouter);
apiRouter.use('/pricing', pricingRouter);
apiRouter.use('/clients', requireModule('clientes'), clientsRouter);
apiRouter.use('/orders', requireModule('pedidos'), ordersRouter);
apiRouter.use('/dispatches', requireModule('despachos'), dispatchesRouter);
apiRouter.use('/attachments', attachmentsRouter);
apiRouter.use('/inventory', inventoryRouter);
apiRouter.use('/production', productionRouter);
apiRouter.use('/lots', lotsRouter);
apiRouter.use('/maquila', maquilaRouter);
apiRouter.use('/receivables', requireModule('cartera'), receivablesRouter);
apiRouter.use('/payments', requireModule('cartera'), paymentsRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/expenses', requireModule('finanzas'), expensesRouter);
