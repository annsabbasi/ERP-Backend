import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CATALOGUE, MeAccessSchema, type MeAccess } from '@erp/contracts';
import { ApiZodResponse } from '../../common/openapi';
import { CurrentAccess, SignedIn } from './access.decorators';
import type { MemberAccess } from './compute-access';

type MenuEntry = MeAccess['menu'][number]['entries'][number];

/**
 * The navigation of Part 05 §5.5.1: an entry shows when its feature is effective and the member
 * holds the permission it names; groups without entries are left out; registry order.
 */
export function menuOf(access: MemberAccess): MeAccess['menu'] {
  const groups = new Map<string, MenuEntry[]>();
  for (const module of CATALOGUE.modules) {
    for (const feature of module.features) {
      if (!access.features[feature.key]) continue;
      for (const entry of feature.menu) {
        if (!access.permissions[entry.requires]) continue;
        const list = groups.get(module.group) ?? [];
        if (!list.some((e) => e.path === entry.path)) {
          list.push({
            path: entry.path,
            label: entry.label,
            feature: feature.key,
            requires: entry.requires,
          });
        }
        groups.set(module.group, list);
      }
    }
  }
  return [...groups].map(([group, entries]) => ({ group, entries }));
}

export function toMeAccess(access: MemberAccess): MeAccess {
  return MeAccessSchema.parse({
    tenant: { id: access.tenantId, code: access.tenantCode, status: access.status },
    membership_id: access.membershipId,
    is_owner: access.isOwner,
    pv: access.pv,
    valid_until: access.validUntil,
    features: Object.entries(access.features).map(([key, state]) => ({ key, state })),
    permissions: access.permissions,
    menu: menuOf(access),
    // Role home pages and quick-create items arrive with the role workspaces (Stage 7).
    home: 'home',
    quick_create: [],
  });
}

@ApiTags('me')
@Controller('me')
export class AccessController {
  /** Effective access in the current company (Part 10 §10.7.5): what the client builds menus from. */
  @Get('access')
  @SignedIn()
  @ApiZodResponse(200, MeAccessSchema, 'Features, permissions with scopes, menu and home page')
  get(@CurrentAccess() access: MemberAccess): MeAccess {
    return toMeAccess(access);
  }
}
