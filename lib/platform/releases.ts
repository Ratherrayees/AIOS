import "server-only";

import {
  parsePlatformReleaseFlags,
  type PlatformReleaseKey,
} from "./release-contracts";

/**
 * Server authority for unreleased platform modules. Client presentation must
 * never be treated as the release control.
 */
export function platformReleaseEnabled(key: PlatformReleaseKey) {
  return parsePlatformReleaseFlags(process.env.PLATFORM_RELEASES)[key];
}
