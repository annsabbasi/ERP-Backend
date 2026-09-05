import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MODULE_ACCESS_KEY } from '../decorators/module-access.decorator';

@Injectable()
export class ModuleAccessGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string | string[]>(MODULE_ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) return true;

    // Tolerates both shapes: the decorator now records an array, but a bare
    // string could still reach here from metadata set by hand.
    const slugs = Array.isArray(required) ? required : [required];
    if (!slugs.length) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;
    if (user.isSuperAdmin) return true;

    // Any one of the listed modules is enough.
    const held: string[] = user.enabledModuleSlugs ?? [];
    if (!slugs.some((slug) => held.includes(slug))) {
      throw new ForbiddenException(
        slugs.length === 1
          ? `Module access denied: this route needs the ${slugs[0]} module.`
          : `Module access denied: this route needs one of ${slugs.join(', ')}.`,
      );
    }
    return true;
  }
}
