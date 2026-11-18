// The route census (ADR 0036): every route in the API is public or names a permission, and
// every body goes through a ZodBodyPipe. A route added months from now can't forget either.
import 'reflect-metadata';
import { Body, Controller, Get, Post, type Type } from '@nestjs/common';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { API_CONTROLLERS } from './app.js';
import { Permission, PERMISSION_KEY, Public, PUBLIC_KEY } from './http/permission.decorator.js';
import { ZodBodyPipe } from './http/zod-body.pipe.js';

// Nest's own metadata keys (@nestjs/common/constants) and RouteParamtypes.BODY.
const PATH_METADATA = 'path';
const ROUTE_ARGS_METADATA = '__routeArguments__';
const BODY_PARAM = 3;

interface RouteArgument {
  pipes?: unknown[];
}

function routeProblems(controllers: Type[]): string[] {
  const problems: string[] = [];
  for (const controller of controllers) {
    const prototype = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
      const route = `${controller.name}.${name}`;
      const declared = [PUBLIC_KEY, PERMISSION_KEY].some(
        (key) =>
          Reflect.getMetadata(key, handler) !== undefined ||
          Reflect.getMetadata(key, controller) !== undefined,
      );
      if (!declared) problems.push(`${route}: no @Public() or @Permission()`);
      const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {}) as Record<
        string,
        RouteArgument
      >;
      for (const [key, argument] of Object.entries(args)) {
        if (!key.startsWith(`${String(BODY_PARAM)}:`)) continue;
        if (!(argument.pipes ?? []).some((pipe) => pipe instanceof ZodBodyPipe)) {
          problems.push(`${route}: @Body() without a ZodBodyPipe`);
        }
      }
    }
  }
  return problems;
}

describe('route census', () => {
  it('finds nothing wrong in the API', () => {
    expect(routeProblems(API_CONTROLLERS)).toEqual([]);
  });

  // The census proves itself on deliberately broken controllers.
  it('catches a route with no permission and a body with no schema', () => {
    @Controller('probe')
    class ProbeController {
      @Get('open')
      open() {
        return 1;
      }

      @Permission('settings.manage')
      @Post('raw')
      raw(@Body() body: unknown) {
        return body;
      }

      @Public()
      @Post('checked')
      checked(@Body(new ZodBodyPipe(z.strictObject({}))) body: unknown) {
        return body;
      }
    }
    expect(routeProblems([ProbeController])).toEqual([
      'ProbeController.open: no @Public() or @Permission()',
      'ProbeController.raw: @Body() without a ZodBodyPipe',
    ]);
  });
});
