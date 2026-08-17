export const PLATFORM_RELEASE_KEYS = [
  "billing",
  "usage_governance",
  "incident_operations",
  "feature_rollouts",
  "support_access",
  "portfolio_analytics",
] as const;

export type PlatformReleaseKey = (typeof PLATFORM_RELEASE_KEYS)[number];
export type PlatformReleaseFlags = Readonly<Record<PlatformReleaseKey, boolean>>;

export function parsePlatformReleaseFlags(
  value: string | undefined,
): PlatformReleaseFlags {
  const enabled = new Set(
    (value || "")
      .split(",")
      .map((item) => item.trim())
      .filter((item): item is PlatformReleaseKey =>
        PLATFORM_RELEASE_KEYS.includes(item as PlatformReleaseKey),
      ),
  );
  return Object.freeze(
    Object.fromEntries(
      PLATFORM_RELEASE_KEYS.map((key) => [key, enabled.has(key)]),
    ) as Record<PlatformReleaseKey, boolean>,
  );
}
