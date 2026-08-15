/**
 * 北极星 (Polaris) package root.
 *
 * The root entry is kept for backward compatibility with older bundle patches
 * that referenced `name: dsh-polaris`. New installations use the atomic
 * subpath plugins listed in cordis.patch.yml:
 *
 *   dsh-polaris/discovery  dsh-polaris/audit     dsh-polaris/exec
 *   dsh-polaris/verify     dsh-polaris/retrieve  dsh-polaris/license
 *   dsh-polaris/rules
 */

export { name, inject, apply } from './plugins/discovery.js'
