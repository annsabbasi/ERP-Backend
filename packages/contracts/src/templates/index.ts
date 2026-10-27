import { GENERAL_BUSINESS } from './general-business';
import { RESTAURANT_CAFE } from './restaurant-cafe';
import { SCHOOL_K12 } from './school-k12';

export {
  buildTemplate,
  role,
  SEMVER,
  TEMPLATE_STATUSES,
  TERM_CONCEPTS,
  RoleTemplateSchema,
  TemplateDefinitionSchema,
  templateDiff,
  templateFeatures,
  templateProblems,
  WIZARD_STEPS,
  type GrantSpec,
  type RoleSpec,
  type RoleTemplate,
  type TemplateDefinition,
  type TemplateStatus,
} from './define';

/** The templates shipped with the product (Phase 0 exit criteria, Part 12 §12.9). */
export const SHIPPED_TEMPLATES = [GENERAL_BUSINESS, RESTAURANT_CAFE, SCHOOL_K12] as const;
export { GENERAL_BUSINESS, RESTAURANT_CAFE, SCHOOL_K12 };
