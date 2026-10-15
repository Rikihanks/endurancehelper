import express from 'express';
import { appError, toErrorBody } from '../errors.js';

// RaceConfig CRUD (spec section 21). Every query is scoped by req.user.orgId
// obtained from the authenticated session — never from client input.
// Protected at mount time with requireAuth + requireActiveLicense.
export function createRaceConfigsRouter({ repos }) {
  const router = express.Router();

  function handle(res, fn) {
    return fn()
      .then((data) => res.json(data))
      .catch((e) => {
        res.status(e.status || 500).json(toErrorBody(e));
      });
  }

  const present = (c) => ({ id: c.id, name: c.name, payload: c.payloadJson, createdAt: c.createdAt, updatedAt: c.updatedAt });

  router.get('/', (req, res) =>
    handle(res, async () => {
      const configs = await repos.listRaceConfigs(req.user.orgId);
      return { configs: configs.map(present) };
    })
  );

  router.post('/', (req, res) =>
    handle(res, async () => {
      const { name, payload } = req.body || {};
      if (!name || typeof name !== 'string' || !name.trim()) throw appError('VALIDATION_ERROR', 'name is required');
      if (!payload || typeof payload !== 'object') throw appError('VALIDATION_ERROR', 'payload is required');
      const config = await repos.createRaceConfig({ orgId: req.user.orgId, name: name.trim(), payloadJson: payload });
      return { config: present(config) };
    })
  );

  router.get('/:id', (req, res) =>
    handle(res, async () => {
      const config = await repos.getRaceConfig(req.user.orgId, req.params.id);
      if (!config) throw appError('RESOURCE_NOT_FOUND', 'Race config not found');
      return { config: present(config) };
    })
  );

  router.put('/:id', (req, res) =>
    handle(res, async () => {
      const { name, payload } = req.body || {};
      const updates = {};
      if (name !== undefined) updates.name = name;
      if (payload !== undefined) updates.payloadJson = payload;
      if (!Object.keys(updates).length) throw appError('VALIDATION_ERROR', 'nothing to update');
      const config = await repos.updateRaceConfig(req.user.orgId, req.params.id, updates);
      if (!config) throw appError('RESOURCE_NOT_FOUND', 'Race config not found');
      return { config: present(config) };
    })
  );

  router.delete('/:id', (req, res) =>
    handle(res, async () => {
      const config = await repos.deleteRaceConfig(req.user.orgId, req.params.id);
      if (!config) throw appError('RESOURCE_NOT_FOUND', 'Race config not found');
      return { ok: true };
    })
  );

  return router;
}
