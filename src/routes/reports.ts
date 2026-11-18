// Submitting, changing and listing odor reports.

import type { FastifyInstance } from 'fastify';
import { CreateReportRequest, ReportsQuery, UpdateReportRequest, type PublicReport } from '@odormap/common';
import { v7 as newId } from 'uuid';
import { AREAS, getArea } from '../areas.js';
import { requireUser } from '../auth.js';
import {
  areaDayKey,
  createReport,
  getReport,
  listReportsForAreaDay,
  listUserReports,
  toOdorReport,
  updateReport,
  type ReportRecord,
} from '../db/index.js';
import { HttpError } from '../errors.js';
import { findAreaFor, roundLocation } from '../geo.js';
import { fetchWeather } from '../services/weather.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MAX_REPORTS_PER_HOUR = 10;
const MAX_QUERY_DAYS = 31;

export async function reportRoutes(app: FastifyInstance) {
  app.post('/reports', async (request, reply) => {
    const { userId } = await requireUser(request);
    const body = CreateReportRequest.parse(request.body);
    const now = new Date();

    const area = findAreaFor(body.location, AREAS);
    if (!area) throw new HttpError(400, 'This location is outside the areas OdorMap covers');

    const recent = await listUserReports(userId, MAX_REPORTS_PER_HOUR);
    const sentInLastHour = recent.filter((r) => now.getTime() - Date.parse(r.createdAt) < HOUR).length;
    if (sentInLastHour >= MAX_REPORTS_PER_HOUR) {
      throw new HttpError(429, 'Too many reports in the last hour, please try again later');
    }

    const record: ReportRecord = {
      reportId: newId(),
      userId,
      areaId: area.areaId,
      // Area and day together, e.g. "backa-topola#2026-11-18". The database index uses it
      // to find all reports for one area on one day quickly (see db/reports.ts).
      areaDay: areaDayKey(area.areaId, now.toISOString()),
      createdAt: now.toISOString(),
      // Reports are for odors present right now, so the time noticed is the time sent.
      observedAt: now.toISOString(),
      location: body.location,
      locationAccuracyM: body.locationAccuracyM,
      strength: body.strength,
      odorKind: body.odorKind,
      odorKindOther: body.odorKindOther,
      duration: body.duration,
      comment: body.comment,
      suspectedSourceId: body.suspectedSourceId,
      weather: await fetchWeather(body.location),
    };
    await createReport(record);
    reply.status(201);
    return toOdorReport(record);
  });

  app.patch<{ Params: { id: string } }>('/reports/:id', async (request) => {
    const { userId } = await requireUser(request);
    const changes = UpdateReportRequest.parse(request.body);
    // Looking up by the caller's own userId means people can only change their own reports.
    if (!(await getReport(userId, request.params.id))) throw new HttpError(404, 'Report not found');
    return toOdorReport(await updateReport(userId, request.params.id, changes));
  });

  app.get('/reports/mine', async (request) => {
    const { userId } = await requireUser(request);
    const records = await listUserReports(userId, 50);
    return records.map(toOdorReport);
  });

  app.get('/reports', async (request) => {
    await requireUser(request);
    const query = ReportsQuery.parse(request.query);
    if (!getArea(query.areaId)) throw new HttpError(404, 'Unknown area');

    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to < from) throw new HttpError(400, '"to" must be after "from"');
    if (to.getTime() - from.getTime() > MAX_QUERY_DAYS * DAY) {
      throw new HttpError(400, `At most ${MAX_QUERY_DAYS} days can be listed at once`);
    }

    // Reports are grouped by day, so read each day in the range.
    const records: ReportRecord[] = [];
    for (let day = startOfUtcDay(from); day <= to; day = new Date(day.getTime() + DAY)) {
      const areaDay = areaDayKey(query.areaId, day.toISOString());
      records.push(...(await listReportsForAreaDay(areaDay, from.toISOString(), to.toISOString())));
    }

    return records.filter((r) => isInsideBox(r, query)).map(toPublicReport);
  });
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isInsideBox(record: ReportRecord, box: ReportsQuery): boolean {
  const { lat, lon } = record.location;
  return (
    (box.minLat === undefined || lat >= box.minLat) &&
    (box.maxLat === undefined || lat <= box.maxLat) &&
    (box.minLon === undefined || lon >= box.minLon) &&
    (box.maxLon === undefined || lon <= box.maxLon)
  );
}

/** Anonymous version for other residents: no user, no comment, rounded location. */
function toPublicReport(record: ReportRecord): PublicReport {
  return {
    id: record.reportId,
    areaId: record.areaId,
    observedAt: record.observedAt,
    location: roundLocation(record.location),
    strength: record.strength,
    odorKind: record.odorKind,
    odorKindOther: record.odorKindOther,
    duration: record.duration,
    weather: record.weather,
  };
}
