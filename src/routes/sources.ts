// Known pollution sources. Anyone logged in can list them; only admins can change them.

import type { FastifyInstance } from 'fastify';
import { CreateSourceRequest, UpdateSourceRequest } from '@odormap/common';
import { v7 as newId } from 'uuid';
import { getArea } from '../areas.js';
import { requireAdmin, requireUser } from '../auth.js';
import { getSource, listSources, saveSource, toPollutionSource } from '../db/index.js';
import { HttpError } from '../errors.js';

export async function sourceRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { areaId?: string } }>('/sources', async (request) => {
    await requireUser(request);
    const sources = await listSources();
    return sources
      .filter((s) => s.active && (!request.query.areaId || s.areaId === request.query.areaId))
      .map(toPollutionSource);
  });

  app.post('/sources', async (request, reply) => {
    await requireAdmin(request);
    const body = CreateSourceRequest.parse(request.body);
    if (!getArea(body.areaId)) throw new HttpError(400, 'Unknown area');
    const record = { sourceId: newId(), ...body, active: true, createdAt: new Date().toISOString() };
    await saveSource(record);
    reply.status(201);
    return toPollutionSource(record);
  });

  app.patch<{ Params: { id: string } }>('/sources/:id', async (request) => {
    await requireAdmin(request);
    const changes = UpdateSourceRequest.parse(request.body);
    const existing = await getSource(request.params.id);
    if (!existing) throw new HttpError(404, 'Source not found');
    if (changes.areaId && !getArea(changes.areaId)) throw new HttpError(400, 'Unknown area');
    const updated = { ...existing, ...changes };
    await saveSource(updated);
    return toPollutionSource(updated);
  });
}
