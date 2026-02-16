export type LocationResolution = {
  label: string | null;
  permission: "granted" | "denied" | "prompt" | "unavailable";
};

type ResolveLocationOptions = {
  /**
   * When false, skip any action that would trigger a browser permission prompt.
   * Location is only fetched if permission is already granted.
   */
  requestPermission?: boolean;
};

function mapPermissionState(state?: PermissionState | null): LocationResolution["permission"] {
  if (state === "granted") return "granted";
  if (state === "denied") return "denied";
  if (state === "prompt") return "prompt";
  return "prompt";
}

export async function resolveLocationLabel(
  opts?: ResolveLocationOptions,
): Promise<LocationResolution> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { label: null, permission: "unavailable" };
  }

  const requestPermission = opts?.requestPermission !== false;
  let permission: LocationResolution["permission"] = "prompt";

  try {
    if (navigator.permissions?.query) {
      const result = await navigator.permissions.query({
        // PermissionName is a DOM lib union that includes "geolocation"
        name: "geolocation" as PermissionName,
      });
      permission = mapPermissionState(result.state);
    }
  } catch {
    // Ignore permission API failures; fallback to geolocation response
  }

  // If we shouldn't trigger a browser prompt, bail unless already granted.
  if (!requestPermission && permission !== "granted") {
    return { label: null, permission };
  }

  let denied = false;
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  }).catch((err: any) => {
    const code = typeof err?.code === "number" ? err.code : null;
    // 1 === PERMISSION_DENIED per spec
    if (code === 1) {
      denied = true;
    }
    return null;
  });

  if (!position) {
    if (denied) permission = "denied";
    else if (permission === "prompt") permission = "unavailable";
    return { label: null, permission };
  }

  permission = "granted";

  const { latitude, longitude } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { label: null, permission };
  }

  const coordsLabel = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`.slice(
    0,
    140
  );

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", latitude.toString());
    url.searchParams.set("lon", longitude.toString());
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "en");

    const resp = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
      },
    });
    if (!resp.ok) throw new Error("Failed to resolve location");
    const data: any = await resp.json();

    type Candidate = {
      value: string;
      rank: number;
    };

    const seen = new Map<string, Candidate>();
    const candidates: Candidate[] = [];
    const registerCandidate = (value?: string | null, rank = 0) => {
      if (!value) return;
      const trimmed = value.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      const existing = seen.get(key);
      if (existing) {
        if (rank < existing.rank) {
          existing.rank = rank;
        }
        return;
      }
      const candidate: Candidate = { value: trimmed, rank };
      seen.set(key, candidate);
      candidates.push(candidate);
    };

    const address = data?.address || {};
    const registerAddressValues = (keys: string[], rank: number) => {
      for (const key of keys) {
        if (typeof address[key] === "string") {
          registerCandidate(address[key], rank);
        }
      }
    };

    registerCandidate(data.name, 0);

    if (typeof data.display_name === "string") {
      const parts = data.display_name
        .split(",")
        .map((part: string) => part.trim())
        .filter(Boolean);
      parts.slice(0, 4).forEach((part: string, index: number) => {
        registerCandidate(part, Math.min(index, 3));
      });
    }

    registerAddressValues(
      [
        "quarter",
        "neighbourhood",
        "neighborhood",
        "suburb",
        "hamlet",
        "croft",
        "township",
        "isolated_dwelling",
        "residential",
        "housing_estate",
        "village",
      ],
      0
    );

    registerAddressValues(
      [
        "town",
        "city",
        "municipality",
        "city_district",
        "district",
        "state_district",
      ],
      1
    );

    registerAddressValues(
      ["county", "region", "province", "borough"],
      2
    );

    registerAddressValues(
      ["state", "state_code", "archipelago"],
      3
    );

    registerAddressValues(["country", "country_code"], 4);

    candidates.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.value.length - b.value.length;
    });

    const label = candidates
      .slice(0, 3)
      .map((candidate) => candidate.value)
      .join(", ");
    const finalLabel = label ? label.slice(0, 140) : coordsLabel;
    return { label: finalLabel, permission };
  } catch (err) {
    console.warn("Failed to fetch location label", err);
    return { label: coordsLabel, permission };
  }
}
