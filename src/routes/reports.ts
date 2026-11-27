// Submitting, changing and listing odor reports.

import type { FastifyInstance } from 'fastify';
import { CreateReportRequest, ReportsQuery, UpdateReportRequest, findAreaFor, type OdorReport, type PublicReport, type ReportAuthor } from '@odormap/common';
import { v7 as newId } from 'uuid';
import { AREAS, getArea } from '../areas.js';
import { requireUser } from '../auth.js';
import {
  addReports,
  areaDayKey,
  createReport,
  getReport,
  DELETED_USER_ID,
  getUser,
  listReportsForAreaDay,
  listUserReports,
  toOdorReport,
  updateReport,
  type ReportRecord,
} from '../db/index.js';
import { HttpError } from '../errors.js';
import { roundLocation } from '../geo.js';
import { fetchWeather } from '../services/weather.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MAX_REPORTS_PER_HOUR = 10;
const MAX_QUERY_DAYS = 31;
const UNKNOWN_AREA_ID = 'unknown';

export async function reportRoutes(app: FastifyInstance) {
  app.post('/reports', async (request, reply) => {
    const { userId } = await requireUser(request);
    const body = CreateReportRequest.parse(request.body);
    const now = new Date();

    // Reports from outside every area are kept too, under the area id "unknown".
    const areaId = findAreaFor(body.location, AREAS)?.areaId ?? UNKNOWN_AREA_ID;

    if ((await getUser(userId))?.blocked) {
      throw new HttpError(403, 'This account is blocked and cannot send reports');
    }

    const recent = await listUserReports(userId, MAX_REPORTS_PER_HOUR);
    const sentInLastHour = recent.filter((r) => now.getTime() - Date.parse(r.createdAt) < HOUR).length;
    if (sentInLastHour >= MAX_REPORTS_PER_HOUR) {
      throw new HttpError(429, 'Too many reports in the last hour, please try again later');
    }

    const record: ReportRecord = {
      reportId: newId(),
      userId,
      areaId,
      // Area and day together, e.g. "backa-topola#2026-11-18". The database index uses it
      // to find all reports for one area on one day quickly (see db/reports.ts).
      areaDay: areaDayKey(areaId, now.toISOString()),
      createdAt: now.toISOString(),
      // Reports are for odors present right now, so the time noticed is the time sent.
      observedAt: now.toISOString(),
      location: body.location,
      locationAccuracyM: body.locationAccuracyM,
      strength: body.strength,
      odorKind: body.odorKind,
      odorKindOther: body.odorKindOther,
      comment: body.comment,
      suspectedSourceId: body.suspectedSourceId,
      weather: await fetchWeather(body.location),
    };
    await createReport(record);
    // For the admin "Users" screen. The report is saved either way.
    await addReports(userId, 1, record.createdAt).catch((error) => request.log.error(error));
    reply.status(201);
    return toOwnReport(record);
  });

  app.patch<{ Params: { id: string } }>('/reports/:id', async (request) => {
    const { userId } = await requireUser(request);
    const changes = UpdateReportRequest.parse(request.body);
    // Looking up by the caller's own userId means people can only change their own reports.
    if (!(await getReport(userId, request.params.id))) throw new HttpError(404, 'Report not found');
    return toOwnReport(await updateReport(userId, request.params.id, changes));
  });

  app.get('/reports/mine', async (request) => {
    const { userId } = await requireUser(request);
    const records = await listUserReports(userId, 50);
    return records.map(toOwnReport);
  });

  app.get('/reports', async (request) => {
    const user = await requireUser(request);
    const query = ReportsQuery.parse(request.query);
    // Reports from outside every area ("unknown") are listed for everyone, like any area.
    if (query.areaId !== UNKNOWN_AREA_ID && !getArea(query.areaId)) throw new HttpError(404, 'Unknown area');

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

    const found = records.filter((r) => isInsideBox(r, query));
    if (user.role !== 'admin') return found.map((r) => toPublicReport(r, user.userId));

    // Only admins see who sent each report, to check reports and stop misuse.
    const authors = await findAuthors(found.map((r) => r.userId));
    return found.map((r) => ({ ...toPublicReport(r, user.userId), author: authors.get(r.userId) }));
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

/**
 * The person's own report: the location is rounded like everyone else's, without its accuracy.
 * The exact location is only stored, for later analysis.
 */
function toOwnReport(record: ReportRecord): OdorReport {
  const { locationAccuracyM, ...report } = toOdorReport(record);
  return { ...report, location: roundLocation(record.location) };
}

/** A report as everyone sees it: no user id, location rounded. isMine marks the caller's own reports. */
function toPublicReport(record: ReportRecord, callerId: string): PublicReport {
  return {
    id: record.reportId,
    areaId: record.areaId,
    observedAt: record.observedAt,
    location: roundLocation(record.location),
    strength: record.strength,
    odorKind: record.odorKind,
    odorKindOther: record.odorKindOther,
    comment: record.comment,
    weather: record.weather,
    isMine: record.userId === callerId,
  };
}

/** Who sent the reports, by user id. A deleted account keeps only its id. */
async function findAuthors(userIds: string[]): Promise<Map<string, ReportAuthor>> {
  const authors = new Map<string, ReportAuthor>();
  for (const id of new Set(userIds)) {
    const user = id === DELETED_USER_ID ? undefined : await getUser(id);
    authors.set(id, { id, displayName: user?.displayName, email: user?.email });
  }
  return authors;
}
