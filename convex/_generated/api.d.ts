/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as backup from "../backup.js";
import type * as calendar from "../calendar.js";
import type * as calendarPull from "../calendarPull.js";
import type * as calendarSync from "../calendarSync.js";
import type * as crons from "../crons.js";
import type * as devAuth from "../devAuth.js";
import type * as googleCalendar from "../googleCalendar.js";
import type * as http from "../http.js";
import type * as migrations from "../migrations.js";
import type * as recurrence from "../recurrence.js";
import type * as release from "../release.js";
import type * as settings from "../settings.js";
import type * as spaces from "../spaces.js";
import type * as taskModel from "../taskModel.js";
import type * as tracker from "../tracker.js";
import type * as zonedTime from "../zonedTime.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  backup: typeof backup;
  calendar: typeof calendar;
  calendarPull: typeof calendarPull;
  calendarSync: typeof calendarSync;
  crons: typeof crons;
  devAuth: typeof devAuth;
  googleCalendar: typeof googleCalendar;
  http: typeof http;
  migrations: typeof migrations;
  recurrence: typeof recurrence;
  release: typeof release;
  settings: typeof settings;
  spaces: typeof spaces;
  taskModel: typeof taskModel;
  tracker: typeof tracker;
  zonedTime: typeof zonedTime;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
