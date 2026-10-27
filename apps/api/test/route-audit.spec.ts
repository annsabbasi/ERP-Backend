import 'reflect-metadata';
import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../src/app.module';
import { ACCESS_META } from '../src/modules/access/access.decorators';
import { PUBLIC } from '../src/modules/auth/auth.guard';

// Route audit (Part 10 §10.7.4): every route of the API says who may call it — @Public(),
// @SignedIn() (own account), @RequirePermission(key) or @StaffPermission(key). A route without
// a rule fails this test, and so the build. Read from Nest's metadata, without starting the app.

type ModuleRef = Type | { module: Type; imports?: unknown[]; controllers?: Type[] };

function controllersOf(root: Type): Type[] {
  const seen = new Set<unknown>();
  const found = new Set<Type>();
  const visit = (ref: unknown) => {
    if (!ref || seen.has(ref)) return;
    seen.add(ref);
    const dynamic = typeof ref === 'object' && 'module' in (ref as object);
    const cls = (dynamic ? (ref as { module: Type }).module : ref) as Type;
    const imports = [
      ...((Reflect.getMetadata(MODULE_METADATA.IMPORTS, cls) as unknown[]) ?? []),
      ...((dynamic ? (ref as { imports?: unknown[] }).imports : []) ?? []),
    ];
    const controllers = [
      ...((Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, cls) as Type[]) ?? []),
      ...((dynamic ? (ref as { controllers?: Type[] }).controllers : []) ?? []),
    ];
    controllers.forEach((c) => found.add(c));
    imports.forEach(visit);
  };
  visit(root as ModuleRef);
  return [...found];
}

type Route = { route: string; rule: string | null };

function routesOf(controller: Type): Route[] {
  const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
  const proto = controller.prototype as Record<string, unknown>;
  const ruleOf = (target: object): string | null => {
    if (Reflect.getMetadata(PUBLIC, target)) return 'public';
    if (Reflect.getMetadata(ACCESS_META.signedIn, target)) return 'signed in';
    const permission = Reflect.getMetadata(ACCESS_META.permission, target) as string | undefined;
    if (permission) return `permission ${permission}`;
    const staff = Reflect.getMetadata(ACCESS_META.staff, target) as string | undefined;
    return staff ? `staff ${staff}` : null;
  };
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
    .filter((name) => Reflect.getMetadata(PATH_METADATA, proto[name] as object) !== undefined)
    .map((name) => {
      const handler = proto[name] as object;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
      const path = String(Reflect.getMetadata(PATH_METADATA, handler));
      return {
        route: `${method} /${[base, path].filter((p) => p && p !== '/').join('/')}`,
        rule: ruleOf(handler) ?? ruleOf(controller),
      };
    });
}

describe('route audit', () => {
  const routes = controllersOf(AppModule).flatMap(routesOf);

  it('finds the API’s routes', () => {
    expect(routes.length).toBeGreaterThan(30);
  });

  it('gives every route an access rule', () => {
    const missing = routes.filter((r) => r.rule === null).map((r) => r.route);
    expect(missing).toEqual([]);
  });
});
